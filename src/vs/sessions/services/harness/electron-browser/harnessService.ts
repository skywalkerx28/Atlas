/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns -- Electron-only bridge reads the daemon token and fallback DB metadata from disk.
import * as fs from 'fs/promises';
import { join } from '../../../../base/common/path.js';
import { env } from '../../../../base/common/process.js';
import { constObservable, IObservable, observableValue } from '../../../../base/common/observable.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { INativeWorkbenchEnvironmentService } from '../../../../workbench/services/environment/electron-browser/environmentService.js';
import { HarnessDaemonClient } from './harnessDaemonClient.js';
import {
	applyDaemonFleetDelta,
	createEmptyFleetSnapshotState,
	EMPTY_COST_STATE,
	EMPTY_FLEET_STATE,
	EMPTY_HEALTH_STATE,
	toPresentationFleet,
	toPresentationHealth,
	snapshotStateFromDaemonSnapshot,
} from './harnessMapper.js';
import { HarnessSqlitePoller } from './harnessSqlitePoller.js';
import { HarnessConnectionState, IHarnessConnectionInfo, IHarnessService } from '../common/harnessService.js';
import { HARNESS_PROTOCOL_VERSION, type IHarnessDaemonNotification } from '../common/harnessProtocol.js';
import type { IFleetDeltaNotification } from '../common/harnessTypes.js';

const DAEMON_REQUIRED_ERROR = 'Harness daemon required; Atlas is in read-only mode.';
const FRONTIER_ENV_FILE_PATH = '/etc/syntropic/frontier-runner.env';
const ACTIVE_VALIDATION_RECENCY_MS = 900_000;
const EMPTY_TRANSCRIPTS = constObservable(Object.freeze([]) as readonly AtlasModel.ITranscriptEntry[]);

export class HarnessService extends Disposable implements IHarnessService {

	declare readonly _serviceBrand: undefined;

	readonly connectionState = observableValue<IHarnessConnectionInfo>(this, disconnectedConnectionState());
	readonly objectives = observableValue<readonly AtlasModel.IObjectiveState[]>(this, Object.freeze([]) as readonly AtlasModel.IObjectiveState[]);
	readonly swarms = observableValue<readonly AtlasModel.ISwarmState[]>(this, Object.freeze([]) as readonly AtlasModel.ISwarmState[]);
	readonly tasks = observableValue<readonly AtlasModel.ITaskState[]>(this, Object.freeze([]) as readonly AtlasModel.ITaskState[]);
	readonly fleet = observableValue<AtlasModel.IFleetState>(this, EMPTY_FLEET_STATE);
	readonly health = observableValue<AtlasModel.IHealthState>(this, EMPTY_HEALTH_STATE);
	readonly cost = observableValue<AtlasModel.ICostState>(this, EMPTY_COST_STATE);
	readonly advisoryReviewQueue = observableValue<readonly AtlasModel.IAdvisoryReviewEntry[]>(this, Object.freeze([]) as readonly AtlasModel.IAdvisoryReviewEntry[]);
	readonly reviewGates = observableValue<readonly AtlasModel.IReviewGateState[]>(this, Object.freeze([]) as readonly AtlasModel.IReviewGateState[]);
	readonly mergeQueue = observableValue<readonly AtlasModel.IMergeEntry[]>(this, Object.freeze([]) as readonly AtlasModel.IMergeEntry[]);

	private readonly _onDidDisconnect = this._register(new Emitter<void>());
	readonly onDidDisconnect: Event<void> = this._onDidDisconnect.event;

	private daemonClient: HarnessDaemonClient | undefined;
	private sqlitePoller: HarnessSqlitePoller | undefined;
	private fleetSnapshotState = createEmptyFleetSnapshotState();
	private currentFleetSubscriptionId: string | undefined;
	private disconnectRequested = false;

	constructor(
		@INativeWorkbenchEnvironmentService private readonly environmentService: INativeWorkbenchEnvironmentService,
		@ILogService private readonly logService: ILogService,
		@IProductService private readonly productService: IProductService,
	) {
		super();
	}

	async connect(workspaceRoot: URI): Promise<void> {
		void workspaceRoot;
		this.disconnectRequested = true;
		await this.teardownConnection(true);
		this.disconnectRequested = false;
		this.resetReadState();

		this.setConnectionState({
			state: HarnessConnectionState.Connecting,
			mode: 'none',
			writesEnabled: false,
			daemonVersion: undefined,
			schemaVersion: undefined,
			grantedCapabilities: Object.freeze([]),
			errorMessage: undefined,
		});

		try {
			await this.connectDaemon();
			return;
		} catch (error) {
			const daemonError = asError(error);
			this.logService.info(`Harness daemon unavailable, falling back to read-only polling: ${daemonError.message}`);
			try {
				await this.startPolling();
				return;
			} catch (pollError) {
				const resolvedPollingError = asError(pollError);
				this.logService.error(`Harness fallback polling failed: ${resolvedPollingError.message}`);
				this.resetReadState();
				this.setConnectionState({
					state: HarnessConnectionState.Error,
					mode: 'none',
					writesEnabled: false,
					daemonVersion: undefined,
					schemaVersion: undefined,
					grantedCapabilities: Object.freeze([]),
					errorMessage: `${daemonError.message}; ${resolvedPollingError.message}`,
				});
				throw resolvedPollingError;
			}
		}
	}

	async disconnect(): Promise<void> {
		this.disconnectRequested = true;
		await this.teardownConnection(false);
		this.resetReadState();
		this.setConnectionState(disconnectedConnectionState());
	}

	async getObjective(_objectiveId: string): Promise<AtlasModel.IObjectiveState | undefined> {
		return undefined;
	}

	async getSwarm(_swarmId: string): Promise<AtlasModel.ISwarmState | undefined> {
		return undefined;
	}

	async getTask(_taskId: string): Promise<AtlasModel.ITaskState | undefined> {
		return undefined;
	}

	async getAgent(dispatchId: string): Promise<AtlasModel.IAgentState | undefined> {
		return this.fleet.get().agents.find(agent => agent.dispatchId === dispatchId);
	}

	async getReviewGate(_dispatchId: string): Promise<AtlasModel.IReviewGateState | undefined> {
		return undefined;
	}

	async getTaskPacket(_taskId: string): Promise<AtlasModel.IWireTaskPacket | undefined> {
		return undefined;
	}

	async getResultPacket(_dispatchId: string): Promise<AtlasModel.IWireResultPacket | undefined> {
		return undefined;
	}

	async getTranscript(_dispatchId: string): Promise<readonly AtlasModel.ITranscriptEntry[]> {
		return Object.freeze([]);
	}

	async getMemoryRecords(_swarmId: string): Promise<readonly AtlasModel.IWireMemoryRecord[]> {
		return Object.freeze([]);
	}

	async getWorktreeState(_dispatchId: string): Promise<AtlasModel.IWorktreeState | undefined> {
		return undefined;
	}

	async pauseAgent(_dispatchId: string): Promise<void> {
		this.failClosedWrite('control methods');
	}

	async resumeAgent(_dispatchId: string): Promise<void> {
		this.failClosedWrite('control methods');
	}

	async cancelAgent(_dispatchId: string): Promise<void> {
		this.failClosedWrite('control methods');
	}

	async steerAgent(_dispatchId: string, _message: string): Promise<void> {
		this.failClosedWrite('steer methods');
	}

	async pauseAll(): Promise<void> {
		this.failClosedWrite('control methods');
	}

	async resumeAll(): Promise<void> {
		this.failClosedWrite('control methods');
	}

	async submitObjective(_problemStatement: string, _options?: AtlasModel.IObjectiveSubmitOptions): Promise<string> {
		this.failClosedWrite('objective methods');
	}

	async submitDispatch(_command: AtlasModel.IWireDispatchCommand): Promise<string> {
		this.failClosedWrite('dispatch methods');
	}

	async recordGateVerdict(_dispatchId: string, _decision: AtlasModel.ReviewDecision, _reviewedByRole: string): Promise<void> {
		this.failClosedWrite('review methods');
	}

	async authorizePromotion(_dispatchId: string, _authorizedByRole: string): Promise<void> {
		this.failClosedWrite('promotion methods');
	}

	async enqueueForMerge(_dispatchId: string): Promise<void> {
		this.failClosedWrite('merge methods');
	}

	subscribeAgentActivity(_dispatchId: string): IObservable<readonly AtlasModel.ITranscriptEntry[]> {
		return EMPTY_TRANSCRIPTS;
	}

	subscribeSwarmActivity(_swarmId: string): IObservable<readonly AtlasModel.ITranscriptEntry[]> {
		return EMPTY_TRANSCRIPTS;
	}

	private async connectDaemon(): Promise<void> {
		const token = await this.readDaemonClientToken();
		const socketPath = this.resolveDaemonSocketPath();
		const client = new HarnessDaemonClient(this.logService);

		client.onDidNotification(notification => {
			void this.handleDaemonNotification(notification);
		});
		client.onDidDisconnect(error => {
			if (!this.disconnectRequested && this.connectionState.get().mode === 'daemon') {
				void this.handleUnexpectedDaemonDisconnect(error);
			}
		});

		try {
			const initializeResult = await client.connect(socketPath, {
				protocol_version: HARNESS_PROTOCOL_VERSION,
				client_info: {
					name: 'atlas-ide',
					version: this.productService.version,
				},
				client_token: token,
				requested_capabilities: Object.freeze(['read']),
			});
			const snapshot = await client.request('fleet.snapshot', {});
			const subscription = await client.request('fleet.subscribe', {});

			this.daemonClient = client;
			this.currentFleetSubscriptionId = subscription.subscription_id;
			this.fleetSnapshotState = snapshotStateFromDaemonSnapshot(snapshot);
			this.publishFleetState();
			this.setConnectionState({
				state: HarnessConnectionState.Connected,
				mode: 'daemon',
				writesEnabled: false,
				daemonVersion: initializeResult.daemon_info.version,
				schemaVersion: initializeResult.schema_version,
				grantedCapabilities: Object.freeze([...initializeResult.granted_capabilities]),
				errorMessage: undefined,
			});
		} catch (error) {
			this.disconnectRequested = true;
			try {
				await client.shutdown();
			} finally {
				this.disconnectRequested = false;
			}
			throw error;
		}
	}

	private async startPolling(): Promise<void> {
		const dbPath = await this.resolveRouterDbPath();
		const poller = new HarnessSqlitePoller(dbPath, this.logService);
		poller.onDidSnapshot(snapshot => {
			this.fleetSnapshotState = snapshot;
			this.publishFleetState();
		});
		poller.onDidError(error => {
			this.resetReadState();
			this.setConnectionState({
				state: HarnessConnectionState.Error,
				mode: 'polling',
				writesEnabled: false,
				daemonVersion: undefined,
				schemaVersion: undefined,
				grantedCapabilities: Object.freeze([]),
				errorMessage: error.message,
			});
			this._onDidDisconnect.fire();
		});

		this.sqlitePoller = poller;
		this.fleetSnapshotState = await poller.start();
		this.publishFleetState();
		this.setConnectionState({
			state: HarnessConnectionState.Connected,
			mode: 'polling',
			writesEnabled: false,
			daemonVersion: undefined,
			schemaVersion: undefined,
			grantedCapabilities: Object.freeze([]),
			errorMessage: undefined,
		});
	}

	private async handleDaemonNotification(notification: IHarnessDaemonNotification): Promise<void> {
		switch (notification.method) {
			case 'fleet.delta': {
				const params = notification.params as IFleetDeltaNotification;
				this.fleetSnapshotState = applyDaemonFleetDelta(this.fleetSnapshotState, params);
				this.currentFleetSubscriptionId = params.subscription_id;
				this.publishFleetState();
				return;
			}
			case 'daemon.resync_required':
				{
					if (notification.params.subscription_id !== this.currentFleetSubscriptionId || !this.daemonClient) {
						return;
					}
					const snapshot = await this.daemonClient.request('fleet.snapshot', {});
					this.fleetSnapshotState = snapshotStateFromDaemonSnapshot(snapshot);
					this.publishFleetState();
					return;
				}
			default:
				return;
		}
	}

	private async handleUnexpectedDaemonDisconnect(error: Error | undefined): Promise<void> {
		this.logService.warn(`Harness daemon disconnected: ${error?.message ?? 'connection closed'}`);
		this.currentFleetSubscriptionId = undefined;
		this.daemonClient = undefined;
		this.setConnectionState({
			state: HarnessConnectionState.Reconnecting,
			mode: 'daemon',
			writesEnabled: false,
			daemonVersion: undefined,
			schemaVersion: undefined,
			grantedCapabilities: Object.freeze([]),
			errorMessage: error?.message,
		});

		try {
			await this.startPolling();
			this._onDidDisconnect.fire();
		} catch (pollError) {
			const resolved = asError(pollError);
			this.resetReadState();
			this.setConnectionState({
				state: HarnessConnectionState.Error,
				mode: 'none',
				writesEnabled: false,
				daemonVersion: undefined,
				schemaVersion: undefined,
				grantedCapabilities: Object.freeze([]),
				errorMessage: resolved.message,
			});
			this._onDidDisconnect.fire();
		}
	}

	private publishFleetState(): void {
		this.fleet.set(toPresentationFleet(this.fleetSnapshotState), undefined, undefined);
		this.health.set(toPresentationHealth(this.fleetSnapshotState), undefined, undefined);
		this.cost.set(EMPTY_COST_STATE, undefined, undefined);
	}

	private resetReadState(): void {
		this.fleetSnapshotState = createEmptyFleetSnapshotState();
		this.fleet.set(EMPTY_FLEET_STATE, undefined, undefined);
		this.health.set(EMPTY_HEALTH_STATE, undefined, undefined);
		this.cost.set(EMPTY_COST_STATE, undefined, undefined);
	}

	private async teardownConnection(silent: boolean): Promise<void> {
		const daemonClient = this.daemonClient;
		const poller = this.sqlitePoller;
		const subscriptionId = this.currentFleetSubscriptionId;

		this.daemonClient = undefined;
		this.sqlitePoller = undefined;
		this.currentFleetSubscriptionId = undefined;

		if (daemonClient && subscriptionId) {
			try {
				await daemonClient.request('fleet.unsubscribe', { subscription_id: subscriptionId }, 2_000);
			} catch (error) {
				this.logService.debug(`Harness daemon unsubscribe failed during teardown: ${asError(error).message}`);
			}
		}

		if (poller) {
			await poller.stop();
		}
		if (daemonClient) {
			await daemonClient.shutdown();
		}

		if (!silent) {
			this._onDidDisconnect.fire();
		}
	}

	private setConnectionState(value: IHarnessConnectionInfo): void {
		this.connectionState.set(value, undefined, undefined);
	}

	private failClosedWrite(capabilityLabel: string): never {
		if (this.connectionState.get().mode === 'daemon') {
			throw new Error(`Current harness daemon does not yet expose ${capabilityLabel}.`);
		}
		throw new Error(DAEMON_REQUIRED_ERROR);
	}

	private resolveDaemonSocketPath(): string {
		const override = nonEmpty(env['AXIOM_HARNESS_SOCK']);
		if (override) {
			return override;
		}
		return join(this.environmentService.userHome.fsPath, '.codex', 'harness.sock');
	}

	private async readDaemonClientToken(): Promise<string> {
		const tokenPath = join(this.environmentService.userHome.fsPath, '.codex', 'atlas-daemon-token');
		const raw = await fs.readFile(tokenPath, 'utf8');
		const token = raw.trim();
		if (!token) {
			throw new Error(`Harness daemon token file is empty: ${tokenPath}`);
		}
		return token;
	}

	private async resolveRouterDbPath(): Promise<string> {
		for (const key of ['AXIOM_FRONTIER_RUNNER_DB', 'AXIOM_WORKSPACE_ROUTER_STATE_DB', 'AXIOM_WORKSPACE_ROUTER_DB', 'AXIOM_INTEGRATION_DB_PATH'] as const) {
			const value = nonEmpty(env[key]);
			if (value) {
				return value;
			}
		}

		const managedAssignments = await this.readManagedFrontierAssignments();
		const activeValidationDb = await this.resolveActiveValidationDbPath(managedAssignments.get('AXIOM_HARNESS_HOME'));
		if (activeValidationDb) {
			return activeValidationDb;
		}

		const managedDb = nonEmpty(managedAssignments.get('AXIOM_FRONTIER_RUNNER_DB'));
		if (managedDb) {
			return managedDb;
		}

		return join(this.environmentService.userHome.fsPath, '.codex', 'workspace-comms', 'router.db');
	}

	private async readManagedFrontierAssignments(): Promise<Map<string, string>> {
		const envFile = nonEmpty(env['AXIOM_FRONTIER_ENV_FILE']) ?? FRONTIER_ENV_FILE_PATH;
		try {
			const raw = await fs.readFile(envFile, 'utf8');
			const assignments = new Map<string, string>();
			for (const line of raw.split(/\r?\n/u)) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith('#')) {
					continue;
				}
				const separator = trimmed.indexOf('=');
				if (separator <= 0) {
					continue;
				}
				const key = trimmed.slice(0, separator).trim();
				const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
				if (key && value) {
					assignments.set(key, value);
				}
			}
			return assignments;
		} catch {
			return new Map();
		}
	}

	private async resolveActiveValidationDbPath(managedHarnessHome: string | undefined): Promise<string | undefined> {
		const harnessHome = nonEmpty(env['AXIOM_HARNESS_HOME']) ?? nonEmpty(managedHarnessHome);
		if (!harnessHome) {
			return undefined;
		}

		const runsRoot = join(harnessHome, '.codex', 'soak-runs');
		let entries: string[];
		try {
			entries = await fs.readdir(runsRoot);
		} catch {
			return undefined;
		}

		entries.sort((left, right) => right.localeCompare(left));
		for (const entry of entries) {
			const runRoot = join(runsRoot, entry);
			if (!(await this.isActiveValidationRun(runRoot))) {
				continue;
			}
			return join(runRoot, 'router.db');
		}

		return undefined;
	}

	private async isActiveValidationRun(runRoot: string): Promise<boolean> {
		const routerDb = join(runRoot, 'router.db');
		const report = join(runRoot, 'report.json');
		if (!(await isFile(routerDb)) || (await pathExists(report))) {
			return false;
		}

		return recentEnough(routerDb)
			|| recentEnough(join(runRoot, 'attachments', 'metrics.jsonl'))
			|| recentEnough(join(runRoot, 'workspace'));
	}
}

registerSingleton(IHarnessService, HarnessService, InstantiationType.Delayed);

function disconnectedConnectionState(): IHarnessConnectionInfo {
	return {
		state: HarnessConnectionState.Disconnected,
		mode: 'none',
		writesEnabled: false,
		daemonVersion: undefined,
		schemaVersion: undefined,
		grantedCapabilities: Object.freeze([]),
		errorMessage: undefined,
	};
}

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function isFile(targetPath: string): Promise<boolean> {
	try {
		return (await fs.stat(targetPath)).isFile();
	} catch {
		return false;
	}
}

async function recentEnough(targetPath: string): Promise<boolean> {
	try {
		const stats = await fs.stat(targetPath);
		return Date.now() - stats.mtimeMs <= ACTIVE_VALIDATION_RECENCY_MS;
	} catch {
		return false;
	}
}
