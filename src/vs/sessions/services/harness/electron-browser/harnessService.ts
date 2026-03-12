/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns -- Electron-only bridge reads the daemon token and fallback DB metadata from disk.
import * as fs from 'fs/promises';
import { isEqualOrParent as isEqualOrParentPath } from '../../../../base/common/extpath.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { constObservable, IObservable, observableValue } from '../../../../base/common/observable.js';
import { join } from '../../../../base/common/path.js';
import { env } from '../../../../base/common/process.js';
import { isEqualOrParent } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { INativeWorkbenchEnvironmentService } from '../../../../workbench/services/environment/electron-browser/environmentService.js';
import { HarnessConnectionState, IHarnessConnectionInfo, IHarnessService } from '../common/harnessService.js';
import { type IHarnessDaemonNotification, HARNESS_PROTOCOL_VERSION } from '../common/harnessProtocol.js';
import type {
	IFleetDeltaNotification,
	IHarnessFabricIdentity,
	IHarnessTaskTree,
	IHealthUpdateNotification,
	IMergeQueueRecord,
	IMergeUpdateNotification,
	IObjectiveRecord,
	IObjectiveUpdateNotification,
	IReviewCandidateRecord,
	IReviewUpdateNotification,
	ITaskTreeResult,
} from '../common/harnessTypes.js';
import {
	HarnessDaemonClient,
	HarnessDaemonProtocolError,
	HarnessDaemonUnavailableError,
	isHarnessDaemonUnavailableError,
} from './harnessDaemonClient.js';
import {
	applyDaemonFleetDelta,
	createEmptyFleetSnapshotState,
	createUnknownHealthSnapshot,
	EMPTY_COST_STATE,
	EMPTY_FLEET_STATE,
	EMPTY_HEALTH_STATE,
	healthSnapshotFromDaemonResult,
	healthSnapshotFromDaemonUpdate,
	snapshotStateFromDaemonSnapshot,
	toBridgeTaskTree,
	toPresentationFleet,
	toPresentationHealth,
	toPresentationMergeEntries,
	toPresentationObjectives,
	toPresentationReviewGates,
	toPresentationTaskFromDetail,
	toPresentationTasks,
} from './harnessMapper.js';
import { deriveSwarms } from './harnessSwarmDerivation.js';
import { HarnessSqlitePoller } from './harnessSqlitePoller.js';

const DAEMON_REQUIRED_ERROR = 'Harness daemon required; Atlas is in read-only mode.';
const FRONTIER_ENV_FILE_PATH = '/etc/syntropic/frontier-runner.env';
const ACTIVE_VALIDATION_RECENCY_MS = 900_000;
const EMPTY_TRANSCRIPTS = constObservable(Object.freeze([]) as readonly AtlasModel.ITranscriptEntry[]);
const EMPTY_OBJECTIVES = Object.freeze([]) as readonly AtlasModel.IObjectiveState[];
const EMPTY_SWARMS = Object.freeze([]) as readonly AtlasModel.ISwarmState[];
const EMPTY_TASKS = Object.freeze([]) as readonly AtlasModel.ITaskState[];
const EMPTY_REVIEWS = Object.freeze([]) as readonly AtlasModel.IAdvisoryReviewEntry[];
const EMPTY_GATES = Object.freeze([]) as readonly AtlasModel.IReviewGateState[];
const EMPTY_MERGES = Object.freeze([]) as readonly AtlasModel.IMergeEntry[];

type HarnessSubscriptionTopic = 'fleet' | 'health' | 'objective' | 'review' | 'merge';

export class HarnessService extends Disposable implements IHarnessService {

	declare readonly _serviceBrand: undefined;

	readonly connectionState = observableValue<IHarnessConnectionInfo>(this, disconnectedConnectionState());
	readonly objectives = observableValue<readonly AtlasModel.IObjectiveState[]>(this, EMPTY_OBJECTIVES);
	readonly swarms = observableValue<readonly AtlasModel.ISwarmState[]>(this, EMPTY_SWARMS);
	readonly tasks = observableValue<readonly AtlasModel.ITaskState[]>(this, EMPTY_TASKS);
	readonly fleet = observableValue<AtlasModel.IFleetState>(this, EMPTY_FLEET_STATE);
	readonly health = observableValue<AtlasModel.IHealthState>(this, EMPTY_HEALTH_STATE);
	readonly cost = observableValue<AtlasModel.ICostState>(this, EMPTY_COST_STATE);
	readonly advisoryReviewQueue = observableValue<readonly AtlasModel.IAdvisoryReviewEntry[]>(this, EMPTY_REVIEWS);
	readonly reviewGates = observableValue<readonly AtlasModel.IReviewGateState[]>(this, EMPTY_GATES);
	readonly mergeQueue = observableValue<readonly AtlasModel.IMergeEntry[]>(this, EMPTY_MERGES);

	private readonly _onDidDisconnect = this._register(new Emitter<void>());
	readonly onDidDisconnect: Event<void> = this._onDidDisconnect.event;
	private readonly connectionDisposables = this._register(new DisposableStore());

	private daemonClient: HarnessDaemonClient | undefined;
	private sqlitePoller: HarnessSqlitePoller | undefined;
	private fleetSnapshotState = createEmptyFleetSnapshotState();
	private healthSnapshotState = createUnknownHealthSnapshot();
	private disconnectRequested = false;
	private workspaceRoot: URI | undefined;
	private validatedPollingDbPath: string | undefined;
	private objectiveRecords: readonly IObjectiveRecord[] = Object.freeze([]);
	private reviewRecords: readonly IReviewCandidateRecord[] = Object.freeze([]);
	private mergeRecords: readonly IMergeQueueRecord[] = Object.freeze([]);
	private rootedTaskIds: readonly string[] = Object.freeze([]);
	private taskTrees = new Map<string, ITaskTreeResult>();
	private subscriptionIds: Record<HarnessSubscriptionTopic, string | undefined> = {
		fleet: undefined,
		health: undefined,
		objective: undefined,
		review: undefined,
		merge: undefined,
	};
	private taskRefreshRequested = false;
	private taskRefreshRunning: Promise<void> | undefined;

	constructor(
		@INativeWorkbenchEnvironmentService private readonly environmentService: INativeWorkbenchEnvironmentService,
		@ILogService private readonly logService: ILogService,
		@IProductService private readonly productService: IProductService,
	) {
		super();
	}

	async connect(workspaceRoot: URI): Promise<void> {
		this.disconnectRequested = true;
		await this.teardownConnection(true);
		this.disconnectRequested = false;
		this.workspaceRoot = workspaceRoot;
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
			await this.connectDaemon(workspaceRoot);
			return;
		} catch (error) {
			const daemonError = asError(error);
			if (!this.canFallBackToPolling(error)) {
				this.logService.error(`Harness daemon connection failed closed: ${daemonError.message}`);
				this.resetReadState();
				this.setConnectionState({
					state: HarnessConnectionState.Error,
					mode: 'none',
					writesEnabled: false,
					daemonVersion: undefined,
					schemaVersion: undefined,
					grantedCapabilities: Object.freeze([]),
					errorMessage: daemonError.message,
				});
				throw daemonError;
			}
			this.logService.info(`Harness daemon unavailable, falling back to read-only polling: ${daemonError.message}`);
			try {
				await this.startPolling(workspaceRoot);
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
		this.workspaceRoot = undefined;
		this.setConnectionState(disconnectedConnectionState());
	}

	async getObjective(objectiveId: string): Promise<AtlasModel.IObjectiveState | undefined> {
		const current = this.objectives.get().find(objective => objective.objectiveId === objectiveId);
		if (!this.daemonClient || this.connectionState.get().mode !== 'daemon') {
			return current;
		}

		try {
			const detail = await this.daemonClient.request('objective.get', { objective_id: objectiveId });
			this.upsertObjectiveRecord(detail.objective);
			this.publishObjectiveState();
			return this.objectives.get().find(objective => objective.objectiveId === objectiveId);
		} catch (error) {
			if (isNotFoundLikeDaemonError(error)) {
				return undefined;
			}
			throw error;
		}
	}

	async getSwarm(swarmId: string): Promise<AtlasModel.ISwarmState | undefined> {
		return this.swarms.get().find(swarm => swarm.swarmId === swarmId);
	}

	async getTask(taskId: string): Promise<AtlasModel.ITaskState | undefined> {
		const current = this.tasks.get().find(task => task.taskId === taskId);
		if (!this.daemonClient || this.connectionState.get().mode !== 'daemon') {
			return current;
		}

		try {
			const detail = await this.daemonClient.request('task.get', { task_id: taskId });
			return toPresentationTaskFromDetail(detail, this.fleetSnapshotState.workers);
		} catch (error) {
			if (isNotFoundLikeDaemonError(error)) {
				return undefined;
			}
			throw error;
		}
	}

	async getTaskTree(rootTaskId: string): Promise<IHarnessTaskTree | undefined> {
		const current = this.taskTrees.get(rootTaskId);
		if (!this.daemonClient || this.connectionState.get().mode !== 'daemon') {
			return current ? toBridgeTaskTree(current) : undefined;
		}

		try {
			const result = await this.daemonClient.request('task.tree', { root_task_id: rootTaskId });
			this.upsertTaskTree(result);
			this.publishTaskState();
			return toBridgeTaskTree(result);
		} catch (error) {
			if (isNotFoundLikeDaemonError(error)) {
				return undefined;
			}
			throw error;
		}
	}

	async getAgent(dispatchId: string): Promise<AtlasModel.IAgentState | undefined> {
		return this.fleet.get().agents.find(agent => agent.dispatchId === dispatchId);
	}

	async getReviewGate(dispatchId: string): Promise<AtlasModel.IReviewGateState | undefined> {
		const current = this.reviewGates.get().find(review => review.dispatchId === dispatchId);
		if (!this.daemonClient || this.connectionState.get().mode !== 'daemon') {
			return current;
		}

		try {
			const record = await this.daemonClient.request('review.get', { dispatch_id: dispatchId });
			this.reviewRecords = upsertByDispatchId(this.reviewRecords, record);
			this.publishReviewState();
			return this.reviewGates.get().find(review => review.dispatchId === dispatchId);
		} catch (error) {
			if (isNotFoundLikeDaemonError(error)) {
				return undefined;
			}
			throw error;
		}
	}

	async getMergeEntry(dispatchId: string): Promise<AtlasModel.IMergeEntry | undefined> {
		const current = this.mergeQueue.get().find(entry => entry.dispatchId === dispatchId);
		if (!this.daemonClient || this.connectionState.get().mode !== 'daemon') {
			return current;
		}

		try {
			const record = await this.daemonClient.request('merge.get', { dispatch_id: dispatchId });
			this.mergeRecords = upsertByDispatchId(this.mergeRecords, record);
			this.publishMergeState();
			return this.mergeQueue.get().find(entry => entry.dispatchId === dispatchId);
		} catch (error) {
			if (isNotFoundLikeDaemonError(error)) {
				return undefined;
			}
			throw error;
		}
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

	private async connectDaemon(workspaceRoot: URI): Promise<void> {
		const managedAssignments = await this.readManagedFrontierAssignments();
		const socketPath = await this.resolveDaemonSocketPath(workspaceRoot, managedAssignments);
		await this.ensureDaemonSocketPath(socketPath);
		const token = await this.readDaemonClientToken();
		const client = new HarnessDaemonClient(this.logService);
		this.connectionDisposables.add(client);

		this.connectionDisposables.add(client.onDidNotification(notification => {
			void this.handleDaemonNotification(notification);
		}));
		this.connectionDisposables.add(client.onDidDisconnect(error => {
			if (!this.disconnectRequested && this.connectionState.get().mode === 'daemon') {
				void this.handleUnexpectedDaemonDisconnect(error);
			}
		}));

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
			await this.validateWorkspaceAffinity(workspaceRoot, initializeResult.fabric_identity);

			this.daemonClient = client;
			this.validatedPollingDbPath = initializeResult.fabric_identity.db_path;

			const [
				fleetSnapshot,
				healthResult,
				objectiveList,
				reviewList,
				mergeList,
				taskList,
			] = await Promise.all([
				client.request('fleet.snapshot', {}),
				client.request('health.get', {}),
				client.request('objective.list', {}),
				client.request('review.list', {}),
				client.request('merge.list', {}),
				client.request('task.list', {}),
			]);

			const [
				fleetSubscription,
				healthSubscription,
				objectiveSubscription,
				reviewSubscription,
				mergeSubscription,
			] = await Promise.all([
				client.request('fleet.subscribe', { resume_from_seq: fleetSnapshot.seq }),
				client.request('health.subscribe', { resume_from_seq: healthResult.seq }),
				client.request('objective.subscribe', { resume_from_seq: objectiveList.seq }),
				client.request('review.subscribe', { resume_from_seq: reviewList.seq }),
				client.request('merge.subscribe', { resume_from_seq: mergeList.seq }),
			]);

			this.subscriptionIds = {
				fleet: fleetSubscription.subscription_id,
				health: healthSubscription.subscription_id,
				objective: objectiveSubscription.subscription_id,
				review: reviewSubscription.subscription_id,
				merge: mergeSubscription.subscription_id,
			};

			this.fleetSnapshotState = snapshotStateFromDaemonSnapshot(fleetSnapshot);
			this.healthSnapshotState = healthSnapshotFromDaemonResult(healthResult);
			this.objectiveRecords = Object.freeze(objectiveList.objectives.slice());
			this.reviewRecords = Object.freeze(reviewList.reviews.slice());
			this.mergeRecords = Object.freeze(mergeList.entries.slice());
			await this.replaceTaskTreesFromRoots(client, taskList.roots.map(root => root.task.task_id));

			await Promise.all([
				fleetSubscription.resync_required ? this.refreshAndResubscribeTopic(client, 'fleet') : Promise.resolve(),
				healthSubscription.resync_required ? this.refreshAndResubscribeTopic(client, 'health') : Promise.resolve(),
				objectiveSubscription.resync_required ? this.refreshAndResubscribeTopic(client, 'objective') : Promise.resolve(),
				reviewSubscription.resync_required ? this.refreshAndResubscribeTopic(client, 'review') : Promise.resolve(),
				mergeSubscription.resync_required ? this.refreshAndResubscribeTopic(client, 'merge') : Promise.resolve(),
			]);

			this.publishReadState();
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
				this.daemonClient = undefined;
				this.connectionDisposables.clear();
				this.disconnectRequested = false;
			}
			throw error;
		}
	}

	private async startPolling(workspaceRoot: URI, preferredDbPath?: string): Promise<void> {
		const dbPath = preferredDbPath ? await this.ensurePollingDbPath(preferredDbPath) : await this.resolveRouterDbPath(workspaceRoot);
		const poller = new HarnessSqlitePoller(dbPath, this.logService);
		poller.onDidSnapshot(snapshot => {
			this.fleetSnapshotState = snapshot;
			this.healthSnapshotState = snapshot.health;
			this.publishFleetAndHealthState();
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
		this.connectionDisposables.add(poller);
		this.fleetSnapshotState = await poller.start();
		this.healthSnapshotState = this.fleetSnapshotState.health;
		this.publishReadState();
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
				if (params.subscription_id !== this.subscriptionIds.fleet) {
					return;
				}
				this.fleetSnapshotState = applyDaemonFleetDelta(this.fleetSnapshotState, params);
				this.publishFleetAndHealthState();
				this.requestTaskRefresh();
				return;
			}
			case 'health.update': {
				const params = notification.params as IHealthUpdateNotification;
				if (params.subscription_id !== this.subscriptionIds.health) {
					return;
				}
				this.healthSnapshotState = healthSnapshotFromDaemonUpdate(params);
				this.publishHealthState();
				return;
			}
			case 'objective.update': {
				const params = notification.params as IObjectiveUpdateNotification;
				if (params.subscription_id !== this.subscriptionIds.objective) {
					return;
				}
				this.objectiveRecords = Object.freeze(params.objectives.slice());
				this.publishObjectiveState();
				this.requestTaskRefresh();
				return;
			}
			case 'review.update': {
				const params = notification.params as IReviewUpdateNotification;
				if (params.subscription_id !== this.subscriptionIds.review) {
					return;
				}
				this.reviewRecords = applyDispatchDelta(this.reviewRecords, params);
				this.publishReviewState();
				return;
			}
			case 'merge.update': {
				const params = notification.params as IMergeUpdateNotification;
				if (params.subscription_id !== this.subscriptionIds.merge) {
					return;
				}
				this.mergeRecords = applyDispatchDelta(this.mergeRecords, params);
				this.publishMergeState();
				return;
			}
			case 'daemon.resync_required': {
				const topic = this.topicForSubscription(notification.params.subscription_id);
				if (!topic || !this.daemonClient) {
					return;
				}
				await this.refreshAndResubscribeTopic(this.daemonClient, topic);
				return;
			}
			default:
				return;
		}
	}

	private async handleUnexpectedDaemonDisconnect(error: Error | undefined): Promise<void> {
		this.logService.warn(`Harness daemon disconnected: ${error?.message ?? 'connection closed'}`);
		this.daemonClient = undefined;
		this.subscriptionIds = emptySubscriptionIds();

		if (!this.canFallBackToPolling(error)) {
			this.resetReadState();
			this.setConnectionState({
				state: HarnessConnectionState.Error,
				mode: 'none',
				writesEnabled: false,
				daemonVersion: undefined,
				schemaVersion: undefined,
				grantedCapabilities: Object.freeze([]),
				errorMessage: error?.message ?? 'Harness daemon disconnected unexpectedly.',
			});
			this._onDidDisconnect.fire();
			return;
		}

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
			if (!this.workspaceRoot) {
				throw new Error('Harness workspace root is unavailable for read-only fallback.');
			}
			await this.startPolling(this.workspaceRoot, this.validatedPollingDbPath);
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

	private publishReadState(): void {
		this.publishFleetAndHealthState();
		this.publishObjectiveState();
		this.publishTaskState();
		this.publishReviewState();
		this.publishMergeState();
		this.cost.set(EMPTY_COST_STATE, undefined, undefined);
		this.advisoryReviewQueue.set(EMPTY_REVIEWS, undefined, undefined);
		this.publishSwarmState();
	}

	private publishFleetAndHealthState(): void {
		this.fleet.set(toPresentationFleet(this.fleetSnapshotState), undefined, undefined);
		this.health.set(toPresentationHealth(this.fleetSnapshotState, this.healthSnapshotState), undefined, undefined);
		this.publishSwarmState();
	}

	private publishHealthState(): void {
		this.health.set(toPresentationHealth(this.fleetSnapshotState, this.healthSnapshotState), undefined, undefined);
		this.publishSwarmState();
	}

	private publishObjectiveState(): void {
		this.objectives.set(toPresentationObjectives(this.objectiveRecords), undefined, undefined);
		this.publishSwarmState();
	}

	private publishTaskState(): void {
		const taskTrees = this.rootedTaskIds
			.map(rootTaskId => this.taskTrees.get(rootTaskId))
			.filter((value): value is ITaskTreeResult => value !== undefined);
		this.tasks.set(toPresentationTasks(taskTrees, this.fleetSnapshotState.workers), undefined, undefined);
		this.publishSwarmState();
	}

	private publishReviewState(): void {
		this.reviewGates.set(toPresentationReviewGates(this.reviewRecords), undefined, undefined);
		this.publishSwarmState();
	}

	private publishMergeState(): void {
		this.mergeQueue.set(toPresentationMergeEntries(this.mergeRecords), undefined, undefined);
		this.publishSwarmState();
	}

	private publishSwarmState(): void {
		const taskTrees = this.rootedTaskIds
			.map(rootTaskId => this.taskTrees.get(rootTaskId))
			.filter((value): value is ITaskTreeResult => value !== undefined)
			.map(taskTree => toBridgeTaskTree(taskTree));
		this.swarms.set(deriveSwarms(
			taskTrees,
			this.tasks.get(),
			this.objectives.get(),
			this.fleet.get(),
			this.reviewGates.get(),
			this.mergeQueue.get(),
			this.health.get(),
		), undefined, undefined);
	}

	private requestTaskRefresh(): void {
		if (!this.daemonClient || this.connectionState.get().mode !== 'daemon') {
			return;
		}
		this.taskRefreshRequested = true;
		if (this.taskRefreshRunning) {
			return;
		}

		this.taskRefreshRunning = (async () => {
			try {
				while (this.taskRefreshRequested && this.daemonClient && this.connectionState.get().mode === 'daemon') {
					this.taskRefreshRequested = false;
					await this.refreshTaskState(this.daemonClient);
				}
			} catch (error) {
				this.logService.warn(`Harness task refresh failed closed: ${asError(error).message}`);
			} finally {
				this.taskRefreshRunning = undefined;
			}
		})();
	}

	private async refreshTaskState(client: HarnessDaemonClient): Promise<void> {
		const taskList = await client.request('task.list', {});
		await this.replaceTaskTreesFromRoots(client, taskList.roots.map(root => root.task.task_id));
		this.publishTaskState();
	}

	private async replaceTaskTreesFromRoots(client: HarnessDaemonClient, rootTaskIds: readonly string[]): Promise<void> {
		const nextTrees = new Map<string, ITaskTreeResult>();
		for (const rootTaskId of rootTaskIds) {
			try {
				const tree = await client.request('task.tree', { root_task_id: rootTaskId });
				nextTrees.set(rootTaskId, tree);
			} catch (error) {
				const resolved = asError(error);
				if (isNotFoundLikeDaemonError(error)) {
					this.logService.warn(`Harness root task '${rootTaskId}' disappeared before task.tree could load: ${resolved.message}`);
					continue;
				}
				throw resolved;
			}
		}

		this.rootedTaskIds = Object.freeze(rootTaskIds.slice());
		this.taskTrees = nextTrees;
	}

	private upsertTaskTree(tree: ITaskTreeResult): void {
		this.taskTrees.set(tree.root_task_id, tree);
		if (!this.rootedTaskIds.includes(tree.root_task_id)) {
			this.rootedTaskIds = Object.freeze([...this.rootedTaskIds, tree.root_task_id]);
		}
	}

	private upsertObjectiveRecord(record: IObjectiveRecord): void {
		const next = new Map(this.objectiveRecords.map(value => [value.spec.objective_id, value] as const));
		next.set(record.spec.objective_id, record);
		this.objectiveRecords = Object.freeze([...next.values()]);
	}

	private async refreshAndResubscribeTopic(client: HarnessDaemonClient, topic: HarnessSubscriptionTopic): Promise<void> {
		switch (topic) {
			case 'fleet': {
				const snapshot = await client.request('fleet.snapshot', {});
				this.fleetSnapshotState = snapshotStateFromDaemonSnapshot(snapshot);
				this.subscriptionIds.fleet = (await client.request('fleet.subscribe', { resume_from_seq: snapshot.seq })).subscription_id;
				this.publishFleetAndHealthState();
				return;
			}
			case 'health': {
				const health = await client.request('health.get', {});
				this.healthSnapshotState = healthSnapshotFromDaemonResult(health);
				this.subscriptionIds.health = (await client.request('health.subscribe', { resume_from_seq: health.seq })).subscription_id;
				this.publishHealthState();
				return;
			}
			case 'objective': {
				const objectives = await client.request('objective.list', {});
				this.objectiveRecords = Object.freeze(objectives.objectives.slice());
				this.subscriptionIds.objective = (await client.request('objective.subscribe', { resume_from_seq: objectives.seq })).subscription_id;
				this.publishObjectiveState();
				this.requestTaskRefresh();
				return;
			}
			case 'review': {
				const reviews = await client.request('review.list', {});
				this.reviewRecords = Object.freeze(reviews.reviews.slice());
				this.subscriptionIds.review = (await client.request('review.subscribe', { resume_from_seq: reviews.seq })).subscription_id;
				this.publishReviewState();
				return;
			}
			case 'merge': {
				const merges = await client.request('merge.list', {});
				this.mergeRecords = Object.freeze(merges.entries.slice());
				this.subscriptionIds.merge = (await client.request('merge.subscribe', { resume_from_seq: merges.seq })).subscription_id;
				this.publishMergeState();
				return;
			}
			default:
				return;
		}
	}

	private topicForSubscription(subscriptionId: string): HarnessSubscriptionTopic | undefined {
		for (const topic of Object.keys(this.subscriptionIds) as HarnessSubscriptionTopic[]) {
			if (this.subscriptionIds[topic] === subscriptionId) {
				return topic;
			}
		}
		return undefined;
	}

	private resetReadState(): void {
		this.fleetSnapshotState = createEmptyFleetSnapshotState();
		this.healthSnapshotState = createUnknownHealthSnapshot();
		this.validatedPollingDbPath = undefined;
		this.objectiveRecords = Object.freeze([]);
		this.reviewRecords = Object.freeze([]);
		this.mergeRecords = Object.freeze([]);
		this.rootedTaskIds = Object.freeze([]);
		this.taskTrees.clear();
		this.subscriptionIds = emptySubscriptionIds();
		this.taskRefreshRequested = false;
		this.fleet.set(EMPTY_FLEET_STATE, undefined, undefined);
		this.health.set(EMPTY_HEALTH_STATE, undefined, undefined);
		this.objectives.set(EMPTY_OBJECTIVES, undefined, undefined);
		this.swarms.set(EMPTY_SWARMS, undefined, undefined);
		this.tasks.set(EMPTY_TASKS, undefined, undefined);
		this.cost.set(EMPTY_COST_STATE, undefined, undefined);
		this.advisoryReviewQueue.set(EMPTY_REVIEWS, undefined, undefined);
		this.reviewGates.set(EMPTY_GATES, undefined, undefined);
		this.mergeQueue.set(EMPTY_MERGES, undefined, undefined);
	}

	private async teardownConnection(silent: boolean): Promise<void> {
		const daemonClient = this.daemonClient;
		const poller = this.sqlitePoller;
		const subscriptions = Object.entries(this.subscriptionIds) as readonly (readonly [HarnessSubscriptionTopic, string | undefined])[];

		this.daemonClient = undefined;
		this.sqlitePoller = undefined;
		this.subscriptionIds = emptySubscriptionIds();

		if (daemonClient) {
			for (const [topic, subscriptionId] of subscriptions) {
				if (!subscriptionId) {
					continue;
				}
				try {
					await daemonClient.request(unsubscribeMethodForTopic(topic), { subscription_id: subscriptionId }, 2_000);
				} catch (error) {
					this.logService.debug(`Harness daemon ${topic}.unsubscribe failed during teardown: ${asError(error).message}`);
				}
			}
		}

		if (poller) {
			await poller.stop();
		}
		if (daemonClient) {
			await daemonClient.shutdown();
		}
		this.connectionDisposables.clear();

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

	private canFallBackToPolling(error: unknown): boolean {
		return error === undefined || isHarnessDaemonUnavailableError(error);
	}

	private async validateWorkspaceAffinity(workspaceRoot: URI, fabricIdentity: IHarnessFabricIdentity): Promise<void> {
		const workspacePath = await canonicalizePath(workspaceRoot.fsPath, 'workspace root');
		const repoRoot = await canonicalizePath(fabricIdentity.repo_root, 'harness daemon repo root');
		if (!isEqualOrParentPath(workspacePath, repoRoot, process.platform === 'win32')) {
			throw new HarnessDaemonProtocolError(
				`Harness daemon fabric repo root '${repoRoot}' does not match workspace '${workspacePath}'.`,
			);
		}
	}

	private async resolveDaemonSocketPath(workspaceRoot: URI, managedAssignments: Map<string, string>): Promise<string> {
		const override = nonEmpty(env['AXIOM_HARNESS_SOCK']);
		if (override) {
			return override;
		}

		const workspaceSocket = join(workspaceRoot.fsPath, '.codex', 'harness.sock');
		if (await isSocket(workspaceSocket)) {
			return workspaceSocket;
		}

		if (!(await this.hasWorkspaceBackedHarness(workspaceRoot, managedAssignments))) {
			throw new HarnessDaemonUnavailableError(`No harness daemon socket is configured for workspace ${workspaceRoot.fsPath}.`);
		}

		return join(this.environmentService.userHome.fsPath, '.codex', 'harness.sock');
	}

	private async ensureDaemonSocketPath(socketPath: string): Promise<void> {
		try {
			const stats = await fs.stat(socketPath);
			if (!stats.isSocket()) {
				throw new Error(`Harness daemon socket path is not a Unix socket: ${socketPath}`);
			}
		} catch (error) {
			const resolved = asError(error);
			const code = (resolved as { code?: unknown }).code;
			if (code === 'ENOENT') {
				throw new HarnessDaemonUnavailableError(`Harness daemon socket not found: ${socketPath}`);
			}
			throw resolved;
		}
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

	private async ensurePollingDbPath(dbPath: string): Promise<string> {
		if (await isFile(dbPath)) {
			return dbPath;
		}
		throw new Error(`Harness router database not found: ${dbPath}`);
	}

	private async resolveRouterDbPath(workspaceRoot: URI): Promise<string> {
		for (const key of ['AXIOM_FRONTIER_RUNNER_DB', 'AXIOM_WORKSPACE_ROUTER_STATE_DB', 'AXIOM_WORKSPACE_ROUTER_DB', 'AXIOM_INTEGRATION_DB_PATH'] as const) {
			const value = nonEmpty(env[key]);
			if (value) {
				return value;
			}
		}

		for (const candidate of [
			join(workspaceRoot.fsPath, 'router.db'),
			join(workspaceRoot.fsPath, '.codex', 'workspace-comms', 'router.db'),
		]) {
			if (await isFile(candidate)) {
				return candidate;
			}
		}

		const managedAssignments = await this.readManagedFrontierAssignments();
		const activeValidationDb = await this.resolveActiveValidationDbPath(managedAssignments.get('AXIOM_HARNESS_HOME'), workspaceRoot);
		if (activeValidationDb) {
			return activeValidationDb;
		}

		const managedDb = nonEmpty(managedAssignments.get('AXIOM_FRONTIER_RUNNER_DB'));
		if (managedDb && this.matchesWorkspaceRoot(workspaceRoot, nonEmpty(managedAssignments.get('AXIOM_FRONTIER_REPO_ROOT')) ?? nonEmpty(managedAssignments.get('AXIOM_HARNESS_HOME')))) {
			return managedDb;
		}

		throw new Error(`No harness router database could be resolved for workspace ${workspaceRoot.fsPath}.`);
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

	private async resolveActiveValidationDbPath(managedHarnessHome: string | undefined, workspaceRoot: URI): Promise<string | undefined> {
		for (const harnessHome of distinctPaths([
			nonEmpty(env['AXIOM_HARNESS_HOME']),
			workspaceRoot.fsPath,
			nonEmpty(managedHarnessHome),
		])) {
			const runsRoot = join(harnessHome, '.codex', 'soak-runs');
			let entries: string[];
			try {
				entries = await fs.readdir(runsRoot);
			} catch {
				continue;
			}

			entries.sort((left, right) => right.localeCompare(left));
			for (const entry of entries) {
				const runRoot = join(runsRoot, entry);
				if (!this.matchesWorkspaceRoot(workspaceRoot, join(runRoot, 'workspace'))) {
					continue;
				}
				if (!(await this.isActiveValidationRun(runRoot))) {
					continue;
				}
				return join(runRoot, 'router.db');
			}
		}

		return undefined;
	}

	private async hasWorkspaceBackedHarness(workspaceRoot: URI, managedAssignments: Map<string, string>): Promise<boolean> {
		if (this.matchesWorkspaceRoot(workspaceRoot, nonEmpty(env['AXIOM_FRONTIER_REPO_ROOT']))
			|| this.matchesWorkspaceRoot(workspaceRoot, nonEmpty(env['AXIOM_HARNESS_HOME']))
			|| this.matchesWorkspaceRoot(workspaceRoot, nonEmpty(managedAssignments.get('AXIOM_FRONTIER_REPO_ROOT')))
			|| this.matchesWorkspaceRoot(workspaceRoot, nonEmpty(managedAssignments.get('AXIOM_HARNESS_HOME')))) {
			return true;
		}

		for (const candidate of [
			join(workspaceRoot.fsPath, 'router.db'),
			join(workspaceRoot.fsPath, '.codex', 'workspace-comms', 'router.db'),
		]) {
			if (await isFile(candidate)) {
				return true;
			}
		}

		return (await this.resolveActiveValidationDbPath(managedAssignments.get('AXIOM_HARNESS_HOME'), workspaceRoot)) !== undefined;
	}

	private matchesWorkspaceRoot(workspaceRoot: URI, candidatePath: string | undefined): boolean {
		if (!candidatePath) {
			return false;
		}

		const candidateUri = URI.file(candidatePath);
		return isEqualOrParent(workspaceRoot, candidateUri) || isEqualOrParent(candidateUri, workspaceRoot);
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

function emptySubscriptionIds(): Record<HarnessSubscriptionTopic, string | undefined> {
	return {
		fleet: undefined,
		health: undefined,
		objective: undefined,
		review: undefined,
		merge: undefined,
	};
}

function unsubscribeMethodForTopic(topic: HarnessSubscriptionTopic): `${HarnessSubscriptionTopic}.unsubscribe` {
	switch (topic) {
		case 'fleet':
			return 'fleet.unsubscribe';
		case 'health':
			return 'health.unsubscribe';
		case 'objective':
			return 'objective.unsubscribe';
		case 'review':
			return 'review.unsubscribe';
		case 'merge':
			return 'merge.unsubscribe';
		default:
			return 'fleet.unsubscribe';
	}
}

function applyDispatchDelta<T extends { readonly dispatch_id: string }>(
	current: readonly T[],
	delta: {
		readonly added: readonly T[];
		readonly changed: readonly T[];
		readonly removed: readonly string[];
	},
): readonly T[] {
	const next = new Map<string, T>();
	for (const value of current) {
		next.set(value.dispatch_id, value);
	}
	for (const dispatchId of delta.removed) {
		next.delete(dispatchId);
	}
	for (const value of delta.added) {
		next.set(value.dispatch_id, value);
	}
	for (const value of delta.changed) {
		next.set(value.dispatch_id, value);
	}
	return Object.freeze([...next.values()]);
}

function upsertByDispatchId<T extends { readonly dispatch_id: string }>(current: readonly T[], value: T): readonly T[] {
	const next = new Map<string, T>(current.map(entry => [entry.dispatch_id, entry] as const));
	next.set(value.dispatch_id, value);
	return Object.freeze([...next.values()]);
}

function isNotFoundLikeDaemonError(error: unknown): boolean {
	const message = asError(error).message;
	return message.includes('was not found');
}

async function canonicalizePath(targetPath: string, label: string): Promise<string> {
	try {
		return await fs.realpath(targetPath);
	} catch (error) {
		throw new HarnessDaemonProtocolError(`Unable to resolve ${label} '${targetPath}': ${asError(error).message}`);
	}
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

async function isSocket(targetPath: string): Promise<boolean> {
	try {
		return (await fs.stat(targetPath)).isSocket();
	} catch {
		return false;
	}
}

function distinctPaths(values: readonly (string | undefined)[]): readonly string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (!value || seen.has(value)) {
			continue;
		}
		seen.add(value);
		result.push(value);
	}
	return result;
}

async function recentEnough(targetPath: string): Promise<boolean> {
	try {
		const stats = await fs.stat(targetPath);
		return Date.now() - stats.mtimeMs <= ACTIVE_VALIDATION_RECENCY_MS;
	} catch {
		return false;
	}
}
