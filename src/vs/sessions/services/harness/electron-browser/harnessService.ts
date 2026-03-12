/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns -- Electron-only bridge persists daemon-backed dispatch packets inside the served repo.
import { createHash } from 'crypto';
// eslint-disable-next-line local/code-import-patterns -- Electron-only bridge reads the daemon token and fallback DB metadata from disk.
import * as fs from 'fs/promises';
import { isEqualOrParent as isEqualOrParentPath } from '../../../../base/common/extpath.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { constObservable, IObservable, observableValue } from '../../../../base/common/observable.js';
import { join, relative as relativePath } from '../../../../base/common/path.js';
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
	HarnessCapability,
	HarnessSupportedWriteMethod,
	IHarnessArtifactInventory,
	IHarnessArtifactPreview,
	IHarnessFabricIdentity,
	IReviewProvenanceEntry,
	IHarnessTaskTree,
	IHarnessTranscriptSnapshot,
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
	toPresentationTranscriptEntries,
	toPresentationWorktreeState,
} from './harnessMapper.js';
import { deriveSwarms } from './harnessSwarmDerivation.js';
import { HarnessSqlitePoller } from './harnessSqlitePoller.js';

const DAEMON_REQUIRED_ERROR = 'Harness daemon required; Atlas is in read-only mode.';
const DEFAULT_DISPATCH_FROM_ROLE = 'axiom-planner';
const FRONTIER_ENV_FILE_PATH = '/etc/syntropic/frontier-runner.env';
const ACTIVE_VALIDATION_RECENCY_MS = 900_000;
const EMPTY_TRANSCRIPTS = constObservable(Object.freeze([]) as readonly AtlasModel.ITranscriptEntry[]);
const EMPTY_OBJECTIVES = Object.freeze([]) as readonly AtlasModel.IObjectiveState[];
const EMPTY_SWARMS = Object.freeze([]) as readonly AtlasModel.ISwarmState[];
const EMPTY_TASKS = Object.freeze([]) as readonly AtlasModel.ITaskState[];
const EMPTY_REVIEWS = Object.freeze([]) as readonly AtlasModel.IAdvisoryReviewEntry[];
const EMPTY_GATES = Object.freeze([]) as readonly AtlasModel.IReviewGateState[];
const EMPTY_MERGES = Object.freeze([]) as readonly AtlasModel.IMergeEntry[];
const EMPTY_SUPPORTED_WRITE_METHODS = Object.freeze([]) as readonly HarnessSupportedWriteMethod[];
const ATLAS_REQUESTED_DAEMON_CAPABILITIES = Object.freeze([
	'read',
	'control',
	'dispatch',
	'event',
	'review',
	'merge',
] as const satisfies readonly HarnessCapability[]);
const ATLAS_SUPPORTED_WRITE_METHODS = Object.freeze([
	'control.pause',
	'control.cancel',
	'dispatch.submit',
	'objective.submit',
	'review.gate_verdict',
	'review.authorize_promotion',
	'review.enqueue_merge',
] as const satisfies readonly HarnessSupportedWriteMethod[]);

const REQUIRED_CAPABILITY_BY_WRITE_METHOD: Readonly<Record<HarnessSupportedWriteMethod, HarnessCapability>> = Object.freeze({
	'control.pause': 'control',
	'control.cancel': 'control',
	'dispatch.submit': 'dispatch',
	'objective.submit': 'dispatch',
	'review.gate_verdict': 'review',
	'review.authorize_promotion': 'merge',
	'review.enqueue_merge': 'merge',
});

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
	private readonly agentActivityObservables = new Map<string, ReturnType<typeof observableValue<readonly AtlasModel.ITranscriptEntry[]>>>();
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
			supportedWriteMethods: EMPTY_SUPPORTED_WRITE_METHODS,
			fabricIdentity: undefined,
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
					supportedWriteMethods: EMPTY_SUPPORTED_WRITE_METHODS,
					fabricIdentity: undefined,
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
					supportedWriteMethods: EMPTY_SUPPORTED_WRITE_METHODS,
					fabricIdentity: undefined,
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

	async getResultPacket(dispatchId: string): Promise<AtlasModel.IWireResultPacket | undefined> {
		const client = this.daemonClient;
		if (!client || this.connectionState.get().mode !== 'daemon') {
			return undefined;
		}
		this.requireSupportedReadMethod(client, 'result.get');

		try {
			const result = await client.request('result.get', { dispatch_id: dispatchId });
			return result.result_packet;
		} catch (error) {
			if (isNotFoundLikeDaemonError(error)) {
				return undefined;
			}
			throw error;
		}
	}

	async getTranscript(dispatchId: string): Promise<IHarnessTranscriptSnapshot | undefined> {
		const client = this.daemonClient;
		if (!client || this.connectionState.get().mode !== 'daemon') {
			return undefined;
		}
		this.requireSupportedReadMethod(client, 'transcript.get');

		const result = await client.request('transcript.get', { dispatch_id: dispatchId, max_turns: 64 });
		return {
			dispatchId: result.dispatch_id,
			available: result.available,
			metadata: result.metadata,
			excerptJsonl: normalizeOptionalString(result.excerpt_jsonl),
		};
	}

	async getMemoryRecords(swarmId: string): Promise<readonly AtlasModel.IWireMemoryRecord[]> {
		const client = this.daemonClient;
		if (!client || this.connectionState.get().mode !== 'daemon') {
			return Object.freeze([]);
		}
		this.requireSupportedReadMethod(client, 'memory.list');

		const result = await client.request('memory.list', { root_task_id: swarmId, limit: 64 });
		return Object.freeze(result.records.slice());
	}

	async getTaskMemoryRecords(taskId: string): Promise<readonly AtlasModel.IWireMemoryRecord[]> {
		const client = this.daemonClient;
		if (!client || this.connectionState.get().mode !== 'daemon') {
			return Object.freeze([]);
		}
		this.requireSupportedReadMethod(client, 'memory.list');

		const result = await client.request('memory.list', { task_id: taskId, limit: 64 });
		return Object.freeze(result.records.slice());
	}

	async getMemoryRecord(recordId: string): Promise<AtlasModel.IWireMemoryRecord | undefined> {
		const client = this.daemonClient;
		if (!client || this.connectionState.get().mode !== 'daemon') {
			return undefined;
		}
		this.requireSupportedReadMethod(client, 'memory.get');

		try {
			return await client.request('memory.get', { record_id: recordId });
		} catch (error) {
			if (isNotFoundLikeDaemonError(error)) {
				return undefined;
			}
			throw error;
		}
	}

	async getWorktreeState(dispatchId: string): Promise<AtlasModel.IWorktreeState | undefined> {
		const client = this.daemonClient;
		if (!client || this.connectionState.get().mode !== 'daemon') {
			return undefined;
		}
		this.requireSupportedReadMethod(client, 'worktree.get');

		try {
			const result = await client.request('worktree.get', { dispatch_id: dispatchId });
			return toPresentationWorktreeState(result);
		} catch (error) {
			if (isNotFoundLikeDaemonError(error)) {
				return undefined;
			}
			throw error;
		}
	}

	async getWorktreeStates(rootTaskId: string): Promise<readonly AtlasModel.IWorktreeState[]> {
		const client = this.daemonClient;
		if (!client || this.connectionState.get().mode !== 'daemon') {
			return Object.freeze([]);
		}
		this.requireSupportedReadMethod(client, 'worktree.list');

		const result = await client.request('worktree.list', { root_task_id: rootTaskId, limit: 64 });
		return Object.freeze(result.worktrees.map(worktree => toPresentationWorktreeState(worktree)));
	}

	async getArtifacts(dispatchId: string): Promise<IHarnessArtifactInventory | undefined> {
		const client = this.daemonClient;
		if (!client || this.connectionState.get().mode !== 'daemon') {
			return undefined;
		}
		this.requireSupportedReadMethod(client, 'artifact.list');

		try {
			const result = await client.request('artifact.list', { dispatch_id: dispatchId, limit: 64 });
			return toArtifactInventory(result);
		} catch (error) {
			if (isNotFoundLikeDaemonError(error)) {
				return undefined;
			}
			throw error;
		}
	}

	async getArtifactPreview(dispatchId: string, artifactPath: string): Promise<IHarnessArtifactPreview | undefined> {
		const client = this.daemonClient;
		if (!client || this.connectionState.get().mode !== 'daemon') {
			return undefined;
		}
		this.requireSupportedReadMethod(client, 'artifact.get');

		try {
			const result = await client.request('artifact.get', {
				dispatch_id: dispatchId,
				artifact_path: artifactPath,
				max_bytes: 64 * 1024,
			});
			return toArtifactPreview(result);
		} catch (error) {
			if (isNotFoundLikeDaemonError(error)) {
				return undefined;
			}
			throw error;
		}
	}

	async getAgentActivity(dispatchId: string): Promise<readonly AtlasModel.ITranscriptEntry[]> {
		const client = this.daemonClient;
		if (!client || this.connectionState.get().mode !== 'daemon') {
			return Object.freeze([]);
		}
		this.requireSupportedReadMethod(client, 'agent.activity.get');

		const result = await client.request('agent.activity.get', { dispatch_id: dispatchId, max_events: 64 });
		return toPresentationTranscriptEntries(result.events);
	}

	async getReviewProvenance(dispatchId: string): Promise<readonly IReviewProvenanceEntry[]> {
		const client = this.daemonClient;
		if (!client || this.connectionState.get().mode !== 'daemon') {
			return Object.freeze([]);
		}
		this.requireSupportedReadMethod(client, 'review.provenance.list');

		const result = await client.request('review.provenance.list', { dispatch_id: dispatchId, limit: 64 });
		return Object.freeze(result.entries.map(entry => ({
			id: entry.id,
			dispatch_id: entry.dispatch_id,
			method: entry.method,
			rid: entry.rid,
			actor_role: normalizeOptionalString(entry.actor_role),
			client_id: normalizeOptionalString(entry.client_id),
			identity: normalizeOptionalString(entry.identity),
			outcome: entry.outcome,
			created_at: entry.created_at,
			provenance: entry.provenance,
		})));
	}

	async pauseAgent(dispatchId: string): Promise<void> {
		const client = this.requireSupportedWriteMethod('control.pause');
		await client.request('control.pause', { dispatch_id: dispatchId });
	}

	async resumeAgent(_dispatchId: string): Promise<void> {
		this.failUnsupportedWrite('control.resume');
	}

	async cancelAgent(dispatchId: string): Promise<void> {
		const client = this.requireSupportedWriteMethod('control.cancel');
		await client.request('control.cancel', { dispatch_id: dispatchId });
	}

	async steerAgent(_dispatchId: string, _message: string): Promise<void> {
		this.failUnsupportedWrite('control.steer');
	}

	async pauseAll(): Promise<void> {
		this.failUnsupportedWrite('pauseAll');
	}

	async resumeAll(): Promise<void> {
		this.failUnsupportedWrite('resumeAll');
	}

	async submitObjective(problemStatement: string, options?: AtlasModel.IObjectiveSubmitOptions): Promise<string> {
		const client = this.requireSupportedWriteMethod('objective.submit');
		const result = await client.request('objective.submit', {
			summary: requireNonEmpty(problemStatement, 'Atlas objective submission requires a non-empty problem statement.'),
			priority: options?.priority as 'p0' | 'p1' | 'p2' | 'p3' | 'info' | undefined,
			context_paths: [...(options?.contextPaths ?? [])],
			playbooks: [...(options?.playbookIds ?? [])],
			desired_outcomes: [...(options?.desiredOutcomes ?? [])],
			constraints: [...(options?.constraints ?? [])],
			success_criteria: [...(options?.successCriteria ?? [])],
			operator_notes: [...(options?.operatorNotes ?? [])],
			budget_ceiling_usd: options?.budgetCeilingUsd,
			max_parallel_workers: options?.maxParallelWorkers,
		});
		void this.refreshObjectiveSubmitState(client, result);
		return result.objective_id;
	}

	async submitDispatch(command: AtlasModel.IWireDispatchCommand): Promise<string> {
		const client = this.requireSupportedWriteMethod('dispatch.submit');
		const taskId = normalizeOptionalString(command.task_id);
		if (!taskId) {
			throw new Error('Current harness daemon dispatch.submit requires command.task_id.');
		}
		if (command.skip_gates) {
			throw new Error('Current harness daemon dispatch.submit does not honor skip_gates requests.');
		}

		const packetPath = await this.materializeDispatchPacket(client, taskId, command);
		const result = await client.request('dispatch.submit', {
			role_id: requireNonEmpty(command.role_id, 'Atlas dispatch submission requires a non-empty role_id.'),
			task_id: taskId,
			packet_path: packetPath,
			metadata: {
				source: 'atlas-ide',
				operator_message: requireNonEmpty(command.message, 'Atlas dispatch submission requires a non-empty message.'),
				from_role: normalizeOptionalString(command.from_role) ?? DEFAULT_DISPATCH_FROM_ROLE,
				subagent_nickname: normalizeOptionalString(command.subagent_nickname) ?? null,
				skip_gates: false,
			},
		});
		void this.refreshDispatchSubmitState(client, result.task_id);
		return result.dispatch_id;
	}

	async recordGateVerdict(dispatchId: string, decision: AtlasModel.ReviewDecision, reviewedByRole: string): Promise<void> {
		if (decision === 'n/a') {
			throw new Error('Current harness daemon review.gate_verdict does not accept decision \'n/a\'.');
		}
		const client = this.requireSupportedWriteMethod('review.gate_verdict');
		const result = await client.request('review.gate_verdict', {
			dispatch_id: dispatchId,
			decision: decision as 'go' | 'no-go' | 'n/a',
			reviewed_by_role: reviewedByRole,
		});
		this.reviewRecords = upsertByDispatchId(this.reviewRecords, result.review);
		this.publishReviewState();
	}

	async authorizePromotion(dispatchId: string, authorizedByRole: string): Promise<void> {
		const client = this.requireSupportedWriteMethod('review.authorize_promotion');
		const result = await client.request('review.authorize_promotion', {
			dispatch_id: dispatchId,
			authorized_by_role: authorizedByRole,
		});
		this.reviewRecords = upsertByDispatchId(this.reviewRecords, result.review);
		this.publishReviewState();
	}

	async enqueueForMerge(dispatchId: string): Promise<void> {
		const client = this.requireSupportedWriteMethod('review.enqueue_merge');
		const result = await client.request('review.enqueue_merge', { dispatch_id: dispatchId });
		this.mergeRecords = upsertByDispatchId(this.mergeRecords, result.entry);
		this.publishMergeState();
	}

	subscribeAgentActivity(dispatchId: string): IObservable<readonly AtlasModel.ITranscriptEntry[]> {
		if (this.connectionState.get().mode !== 'daemon') {
			return EMPTY_TRANSCRIPTS;
		}

		let observable = this.agentActivityObservables.get(dispatchId);
		if (!observable) {
			observable = observableValue(`harnessAgentActivity:${dispatchId}`, Object.freeze([]) as readonly AtlasModel.ITranscriptEntry[]);
			this.agentActivityObservables.set(dispatchId, observable);
			void this.getAgentActivity(dispatchId).then(events => {
				observable?.set(events, undefined, undefined);
			}, error => {
				this.logService.warn(`Harness agent.activity.get failed closed for '${dispatchId}': ${asError(error).message}`);
			});
		}

		return observable;
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
				requested_capabilities: ATLAS_REQUESTED_DAEMON_CAPABILITIES,
			});
			await this.validateWorkspaceAffinity(workspaceRoot, initializeResult.fabric_identity);
			const supportedWriteMethods = supportedWriteMethodsFromInitialize(initializeResult);

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
				writesEnabled: supportedWriteMethods.length > 0,
				supportedWriteMethods,
				fabricIdentity: initializeResult.fabric_identity,
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
				supportedWriteMethods: EMPTY_SUPPORTED_WRITE_METHODS,
				fabricIdentity: undefined,
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
			supportedWriteMethods: EMPTY_SUPPORTED_WRITE_METHODS,
			fabricIdentity: undefined,
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
				supportedWriteMethods: EMPTY_SUPPORTED_WRITE_METHODS,
				fabricIdentity: undefined,
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
			supportedWriteMethods: EMPTY_SUPPORTED_WRITE_METHODS,
			fabricIdentity: undefined,
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
				supportedWriteMethods: EMPTY_SUPPORTED_WRITE_METHODS,
				fabricIdentity: undefined,
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
		for (const observable of this.agentActivityObservables.values()) {
			observable.set(Object.freeze([]), undefined, undefined);
		}
		this.agentActivityObservables.clear();
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

	private requireSupportedWriteMethod(method: HarnessSupportedWriteMethod): HarnessDaemonClient {
		const client = this.daemonClient;
		if (!client || this.connectionState.get().mode !== 'daemon') {
			throw new Error(DAEMON_REQUIRED_ERROR);
		}
		if (!client.supportsMethod(method)) {
			throw new Error(`Current harness daemon does not expose ${method}.`);
		}

		const requiredCapability = REQUIRED_CAPABILITY_BY_WRITE_METHOD[method];
		if (!client.grantedCapabilities.includes(requiredCapability)) {
			throw new Error(`Current harness daemon does not grant ${requiredCapability} capability for ${method}.`);
		}
		return client;
	}

	private requireSupportedReadMethod<TMethod extends string>(client: HarnessDaemonClient, method: TMethod): void {
		if (!client.supportsMethod(method)) {
			throw new Error(`Current harness daemon does not expose ${method}.`);
		}
		if (!client.grantedCapabilities.includes('read')) {
			throw new Error(`Current harness daemon does not grant read capability for ${method}.`);
		}
	}

	private failUnsupportedWrite(method: string): never {
		if (this.connectionState.get().mode === 'daemon') {
			throw new Error(`Current harness daemon does not expose ${method}.`);
		}
		throw new Error(DAEMON_REQUIRED_ERROR);
	}

	private async materializeDispatchPacket(
		client: HarnessDaemonClient,
		taskId: string,
		command: AtlasModel.IWireDispatchCommand,
	): Promise<string> {
		const fabricIdentity = client.fabricIdentity;
		if (!fabricIdentity) {
			throw new Error('Harness daemon fabric identity is unavailable for dispatch.submit.');
		}

		const roleId = requireNonEmpty(command.role_id, 'Atlas dispatch submission requires a non-empty role_id.');
		const message = requireNonEmpty(command.message, 'Atlas dispatch submission requires a non-empty message.');
		const fromRole = normalizeOptionalString(command.from_role) ?? DEFAULT_DISPATCH_FROM_ROLE;
		const subagentNickname = normalizeOptionalString(command.subagent_nickname);
		const packetDir = join(fabricIdentity.repo_root, '.codex', 'atlas-dispatch-packets');
		const packetHash = createHash('sha256').update(JSON.stringify({
			task_id: taskId,
			role_id: roleId,
			from_role: fromRole,
			message,
			subagent_nickname: subagentNickname ?? null,
			skip_gates: false,
		})).digest('hex');
		const packetPath = join(packetDir, `${sanitizeFileComponent(taskId)}-${sanitizeFileComponent(roleId)}-${packetHash.slice(0, 12)}.task.json`);
		const packetPathRelative = repoRelativePath(fabricIdentity.repo_root, packetPath);

		await fs.mkdir(packetDir, { recursive: true });
		if (!(await pathExists(packetPath))) {
			const packet = {
				task_id: taskId,
				created_at: new Date().toISOString(),
				from_role: fromRole,
				to_role: roleId,
				summary: message,
				acceptance: [message],
				constraints: [],
				artifacts: [packetPathRelative],
				memory_keywords: [],
				phase_refs: [],
				context_paths: [],
				requires_prompt_engineering: false,
				allow_push: false,
				allow_merge: false,
			};
			await fs.writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
		}

		return packetPath;
	}

	private async refreshObjectiveSubmitState(client: HarnessDaemonClient, result: { readonly objective_id: string; readonly root_task_id: string }): Promise<void> {
		try {
			const detail = await client.request('objective.get', { objective_id: result.objective_id });
			this.upsertObjectiveRecord(detail.objective);
			this.upsertTaskTree(await client.request('task.tree', { root_task_id: result.root_task_id }));
			this.publishObjectiveState();
			this.publishTaskState();
		} catch (error) {
			this.logService.warn(`Harness objective.submit follow-up refresh failed closed: ${asError(error).message}`);
		}
	}

	private async refreshDispatchSubmitState(client: HarnessDaemonClient, taskId: string): Promise<void> {
		try {
			const detail = await client.request('task.get', { task_id: taskId });
			const rootTaskId = normalizeOptionalString(detail.root_task_id) ?? taskId;
			this.upsertTaskTree(await client.request('task.tree', { root_task_id: rootTaskId }));
			this.publishTaskState();
		} catch (error) {
			this.logService.warn(`Harness dispatch.submit follow-up refresh failed closed: ${asError(error).message}`);
		}
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
		supportedWriteMethods: EMPTY_SUPPORTED_WRITE_METHODS,
		fabricIdentity: undefined,
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

function supportedWriteMethodsFromInitialize(
	initializeResult: {
		readonly supported_methods: readonly string[];
		readonly granted_capabilities: readonly HarnessCapability[];
	},
): readonly HarnessSupportedWriteMethod[] {
	return Object.freeze(ATLAS_SUPPORTED_WRITE_METHODS.filter(method =>
		initializeResult.supported_methods.includes(method)
		&& initializeResult.granted_capabilities.includes(REQUIRED_CAPABILITY_BY_WRITE_METHOD[method]),
	));
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

function requireNonEmpty(value: string, errorMessage: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(errorMessage);
	}
	return normalized;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function repoRelativePath(repoRoot: string, targetPath: string): string {
	return relativePath(repoRoot, targetPath).replace(/\\/g, '/');
}

function sanitizeFileComponent(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]+/g, '-');
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

function toArtifactInventory(result: {
	readonly dispatch_id: string;
	readonly task_id: string;
	readonly objective_id?: string;
	readonly artifact_bundle_dir: string;
	readonly artifacts: readonly {
		readonly artifact_path: string;
		readonly absolute_path: string;
		readonly kind: string;
		readonly size_bytes: number;
	}[];
	readonly truncated: boolean;
}): IHarnessArtifactInventory {
	return {
		dispatchId: result.dispatch_id,
		taskId: result.task_id,
		objectiveId: normalizeOptionalString(result.objective_id),
		artifactBundleDir: result.artifact_bundle_dir,
		artifacts: Object.freeze(result.artifacts.map(artifact => ({
			artifactPath: artifact.artifact_path,
			absolutePath: artifact.absolute_path,
			kind: artifact.kind as IHarnessArtifactInventory['artifacts'][number]['kind'],
			sizeBytes: Math.max(0, artifact.size_bytes),
		}))),
		truncated: result.truncated,
	};
}

function toArtifactPreview(result: {
	readonly dispatch_id: string;
	readonly task_id: string;
	readonly objective_id?: string;
	readonly artifact_bundle_dir: string;
	readonly artifact: {
		readonly artifact_path: string;
		readonly absolute_path: string;
		readonly kind: string;
		readonly size_bytes: number;
	};
	readonly text_preview?: string;
	readonly preview_truncated: boolean;
	readonly is_utf8_text: boolean;
}): IHarnessArtifactPreview {
	return {
		dispatchId: result.dispatch_id,
		taskId: result.task_id,
		objectiveId: normalizeOptionalString(result.objective_id),
		artifactBundleDir: result.artifact_bundle_dir,
		artifact: {
			artifactPath: result.artifact.artifact_path,
			absolutePath: result.artifact.absolute_path,
			kind: result.artifact.kind as IHarnessArtifactPreview['artifact']['kind'],
			sizeBytes: Math.max(0, result.artifact.size_bytes),
		},
		textPreview: normalizeOptionalString(result.text_preview),
		previewTruncated: result.preview_truncated,
		isUtf8Text: result.is_utf8_text,
	};
}

async function recentEnough(targetPath: string): Promise<boolean> {
	try {
		const stats = await fs.stat(targetPath);
		return Date.now() - stats.mtimeMs <= ACTIVE_VALIDATION_RECENCY_MS;
	} catch {
		return false;
	}
}
