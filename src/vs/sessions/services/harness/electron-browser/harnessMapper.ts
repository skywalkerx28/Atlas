/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	IDaemonHealthState,
	IFleetDeltaNotification,
	IFleetSnapshotResult,
	IFleetWorkerState,
	IHealthResult,
	IHealthUpdateNotification,
	IHarnessFleetStateSnapshot,
	IHarnessHealthSnapshot,
	IHarnessQueueSnapshot,
	IHarnessTaskLineageNode,
	IHarnessTaskTree,
	IHarnessWorkerRecord,
	IMergeQueueRecord,
	IObjectiveRecord,
	IQueueDispatch,
	IReviewCandidateRecord,
	ITaskDetail,
	ITaskNode,
	ITaskTreeNodeDetail,
	ITaskTreeResult,
	IWireAgentActivityEvent,
	IWorktreeGetResult,
} from '../common/harnessTypes.js';

type AgentStatus = AtlasModel.IAgentState['status'];
type AgentRole = AtlasModel.IAgentState['role'];
type AttentionLevel = AtlasModel.IAgentState['attentionLevel'];
type ObjectiveStatus = AtlasModel.IObjectiveState['status'];
type PoolMode = AtlasModel.IHealthState['mode'];
type TaskStatus = AtlasModel.ITaskState['status'];
type MergeStatus = AtlasModel.IMergeEntry['status'];

const AGENT_STATUS = {
	spawning: 'spawning' as AgentStatus,
	running: 'running' as AgentStatus,
	idle: 'idle' as AgentStatus,
	blocked: 'blocked' as AgentStatus,
	completed: 'completed' as AgentStatus,
	failed: 'failed' as AgentStatus,
	timedOut: 'timed_out' as AgentStatus,
};

const AGENT_ROLE = {
	planner: 'planner' as AgentRole,
	worker: 'worker' as AgentRole,
	judge: 'judge' as AgentRole,
};

const OBJECTIVE_STATUS = {
	open: 'open' as ObjectiveStatus,
	planning: 'planning' as ObjectiveStatus,
	executing: 'executing' as ObjectiveStatus,
	reviewing: 'reviewing' as ObjectiveStatus,
	completed: 'completed' as ObjectiveStatus,
	failed: 'failed' as ObjectiveStatus,
};

const TASK_STATUS = {
	queued: 'queued' as TaskStatus,
	executing: 'executing' as TaskStatus,
	blocked: 'blocked' as TaskStatus,
	reviewing: 'reviewing' as TaskStatus,
	completed: 'completed' as TaskStatus,
	failed: 'failed' as TaskStatus,
	cancelled: 'cancelled' as TaskStatus,
};

const MERGE_STATUS = {
	pending: 'pending' as MergeStatus,
	mergeStarted: 'merge_started' as MergeStatus,
	merged: 'merged' as MergeStatus,
	mergeBlocked: 'merge_blocked' as MergeStatus,
	abandoned: 'abandoned' as MergeStatus,
};

const ATTENTION = {
	critical: 4 as AttentionLevel,
	needsAction: 3 as AttentionLevel,
	active: 2 as AttentionLevel,
	idle: 1 as AttentionLevel,
	completed: 0 as AttentionLevel,
};

const POOL_MODE = {
	normal: 'normal' as PoolMode,
	natsDown: 'nats_down' as PoolMode,
	diskPressure: 'disk_pressure' as PoolMode,
	costCeiling: 'cost_ceiling' as PoolMode,
	paused: 'paused' as PoolMode,
};

const EMPTY_BREAKDOWNS = Object.freeze([]) as AtlasModel.ICostState['breakdowns'];

export const EMPTY_FLEET_STATE: AtlasModel.IFleetState = Object.freeze({
	agents: Object.freeze([]) as readonly AtlasModel.IAgentState[],
	activeCount: 0,
	idleCount: 0,
	blockedCount: 0,
	failedCount: 0,
	totalCostSpent: 0,
	attentionLevel: ATTENTION.idle,
});

export const EMPTY_HEALTH_STATE: AtlasModel.IHealthState = Object.freeze({
	mode: POOL_MODE.paused,
	diskUsagePct: 0,
	memoryUsagePct: 0,
	walSizeBytes: undefined,
	activeWorkers: 0,
	queueDepth: 0,
	attentionLevel: ATTENTION.needsAction,
	lastHealthCheck: undefined,
});

export const EMPTY_COST_STATE: AtlasModel.ICostState = Object.freeze({
	totalSpentUsd: 0,
	budgetCeilingUsd: undefined,
	utilization: undefined,
	burnRateUsdPerHour: undefined,
	breakdowns: EMPTY_BREAKDOWNS,
	attentionLevel: ATTENTION.idle,
	updatedAt: undefined,
});

export function createEmptyFleetSnapshotState(): IHarnessFleetStateSnapshot {
	return {
		capturedAt: 0,
		seq: 0,
		subscriptionId: undefined,
		workers: Object.freeze([]) as readonly IHarnessWorkerRecord[],
		queue: {
			dispatchQueueDepth: 0,
			mergeQueueDepth: 0,
			mergeConflicts: 0,
			pendingWorkspaceEvents: 0,
		},
		health: createUnknownHealthSnapshot(),
	};
}

export function createUnknownHealthSnapshot(): IHarnessHealthSnapshot {
	return {
		mode: 'unknown',
		diskUsagePct: 0,
		memoryUsagePct: 0,
		walSizeBytes: 0,
		activeWorkers: 0,
		queueDepth: 0,
		lastHealthCheck: undefined,
	};
}

export function snapshotStateFromDaemonSnapshot(result: IFleetSnapshotResult): IHarnessFleetStateSnapshot {
	return {
		capturedAt: parseRequiredTimestamp(result.snapshot.captured_at),
		seq: result.seq,
		subscriptionId: undefined,
		workers: freezeWorkers(result.snapshot.workers.map(worker => normalizeWorker(worker, undefined))),
		queue: normalizeQueue(result.snapshot.queue),
		health: normalizeHealth(result.snapshot.health),
	};
}

export function applyDaemonFleetDelta(
	current: IHarnessFleetStateSnapshot,
	delta: IFleetDeltaNotification,
): IHarnessFleetStateSnapshot {
	const workers = new Map<string, IHarnessWorkerRecord>();
	for (const worker of current.workers) {
		workers.set(worker.dispatchId, worker);
	}
	for (const dispatchId of delta.removed) {
		workers.delete(dispatchId);
	}
	for (const worker of delta.added) {
		workers.set(worker.dispatch_id, normalizeWorker(worker, workers.get(worker.dispatch_id)?.worktreePath));
	}
	for (const worker of delta.changed) {
		workers.set(worker.dispatch_id, normalizeWorker(worker, workers.get(worker.dispatch_id)?.worktreePath));
	}

	return {
		capturedAt: parseRequiredTimestamp(delta.captured_at),
		seq: delta.seq,
		subscriptionId: delta.subscription_id,
		workers: freezeWorkers([...workers.values()]),
		queue: normalizeQueue(delta.queue),
		health: normalizeHealth(delta.health),
	};
}

export function toBridgeHealthSnapshot(health: {
	readonly mode: string;
	readonly diskUsagePct: number;
	readonly memoryUsagePct: number;
	readonly walSizeBytes: number;
	readonly activeWorkers: number;
	readonly queueDepth: number;
	readonly lastHealthCheck: string | undefined;
}): IHarnessHealthSnapshot {
	return {
		mode: health.mode,
		diskUsagePct: health.diskUsagePct,
		memoryUsagePct: health.memoryUsagePct,
		walSizeBytes: Math.max(0, health.walSizeBytes),
		activeWorkers: Math.max(0, health.activeWorkers),
		queueDepth: Math.max(0, health.queueDepth),
		lastHealthCheck: parseOptionalTimestamp(health.lastHealthCheck),
	};
}

export function healthSnapshotFromDaemonResult(result: IHealthResult): IHarnessHealthSnapshot {
	return normalizeHealth(result.health);
}

export function healthSnapshotFromDaemonUpdate(update: IHealthUpdateNotification): IHarnessHealthSnapshot {
	return toBridgeHealthSnapshot({
		mode: update.mode,
		diskUsagePct: update.disk_usage_pct,
		memoryUsagePct: update.memory_usage_pct,
		walSizeBytes: update.wal_size_bytes,
		activeWorkers: update.active_workers,
		queueDepth: update.queue_depth,
		lastHealthCheck: update.last_health_check,
	});
}

export function toPresentationFleet(state: IHarnessFleetStateSnapshot): AtlasModel.IFleetState {
	const agents = freezeAgents(state.workers.map(worker => toPresentationAgent(worker)));

	let activeCount = 0;
	let idleCount = 0;
	let blockedCount = 0;
	let failedCount = 0;
	let totalCostSpent = 0;
	let maxAttention = state.queue.mergeConflicts > 0 ? ATTENTION.needsAction : ATTENTION.idle;

	for (const agent of agents) {
		switch (agent.status) {
			case AGENT_STATUS.spawning:
			case AGENT_STATUS.running:
				activeCount += 1;
				break;
			case AGENT_STATUS.idle:
				idleCount += 1;
				break;
			case AGENT_STATUS.blocked:
				blockedCount += 1;
				break;
			case AGENT_STATUS.failed:
			case AGENT_STATUS.timedOut:
				failedCount += 1;
				break;
			default:
				break;
		}
		totalCostSpent += agent.costSpent;
		maxAttention = Math.max(maxAttention, agent.attentionLevel);
	}

	if (maxAttention === ATTENTION.idle && state.queue.dispatchQueueDepth > 0) {
		maxAttention = ATTENTION.active;
	}
	if (maxAttention === ATTENTION.idle && agents.length > 0 && agents.every(agent => agent.status === AGENT_STATUS.completed)) {
		maxAttention = ATTENTION.completed;
	}

	return {
		agents,
		activeCount,
		idleCount,
		blockedCount,
		failedCount,
		totalCostSpent,
		attentionLevel: maxAttention,
	};
}

export function toPresentationHealth(
	state: IHarnessFleetStateSnapshot,
	healthState: IHarnessHealthSnapshot = state.health,
): AtlasModel.IHealthState {
	const mode = normalizePoolMode(healthState.mode);

	let attentionLevel = ATTENTION.idle;
	if (mode !== POOL_MODE.normal) {
		attentionLevel = ATTENTION.needsAction;
	} else if (state.queue.mergeConflicts > 0) {
		attentionLevel = ATTENTION.needsAction;
	} else if (healthState.activeWorkers > 0 || healthState.queueDepth > 0 || state.queue.pendingWorkspaceEvents > 0) {
		attentionLevel = ATTENTION.active;
	}

	return {
		mode,
		diskUsagePct: healthState.diskUsagePct,
		memoryUsagePct: healthState.memoryUsagePct,
		walSizeBytes: healthState.walSizeBytes,
		activeWorkers: healthState.activeWorkers,
		queueDepth: healthState.queueDepth,
		attentionLevel,
		lastHealthCheck: healthState.lastHealthCheck,
	};
}

export function toPresentationObjectives(records: readonly IObjectiveRecord[]): readonly AtlasModel.IObjectiveState[] {
	return Object.freeze(records.map(record => toPresentationObjective(record)));
}

export function toPresentationReviewGates(records: readonly IReviewCandidateRecord[]): readonly AtlasModel.IReviewGateState[] {
	return Object.freeze(records.map(record => toPresentationReviewGate(record)));
}

export function toPresentationMergeEntries(records: readonly IMergeQueueRecord[]): readonly AtlasModel.IMergeEntry[] {
	return Object.freeze(records.map(record => toPresentationMergeEntry(record)));
}

export function toPresentationTasks(
	taskTrees: readonly ITaskTreeResult[],
	workers: readonly IHarnessWorkerRecord[],
): readonly AtlasModel.ITaskState[] {
	const assignedWorkers = latestWorkerByTaskId(workers);
	const taskStates = new Map<string, AtlasModel.ITaskState>();

	for (const tree of taskTrees) {
		const objectiveId = tree.objective?.spec.objective_id;
		for (const node of tree.nodes) {
			const assignedWorker = assignedWorkers.get(node.task.task_id);
			taskStates.set(node.task.task_id, toPresentationTaskFromTreeNode(node, objectiveId, assignedWorker));
		}
	}

	return Object.freeze([...taskStates.values()]);
}

export function toPresentationTaskFromDetail(
	detail: ITaskDetail,
	workers: readonly IHarnessWorkerRecord[],
): AtlasModel.ITaskState {
	const assignedWorker = latestWorkerByTaskId(workers).get(detail.task.task_id);
	return toPresentationTask(detail.task, detail.objective?.spec.objective_id, detail.latest_dispatch, assignedWorker);
}

export function toBridgeTaskTree(result: ITaskTreeResult): IHarnessTaskTree {
	return {
		rootTaskId: result.root_task_id,
		objectiveId: result.objective?.spec.objective_id,
		nodes: Object.freeze(result.nodes.map(node => toBridgeTaskLineageNode(node))),
	};
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function toPresentationTranscriptEntries(events: readonly IWireAgentActivityEvent[]): readonly AtlasModel.ITranscriptEntry[] {
	return Object.freeze(events.map(event => ({
		timestamp: parseRequiredTimestamp(event.ts),
		dispatchId: event.dispatch_id,
		taskId: event.task_id,
		objectiveId: normalizeOptionalString(event.objective_id),
		roleId: event.role_id,
		handoffType: event.handoff_type,
		kind: event.kind,
		summary: event.summary,
		tool: normalizeOptionalString(event.tool),
		filePath: normalizeOptionalString(event.file_path),
		diffStat: event.diff_stat ? {
			linesAdded: Math.max(0, event.diff_stat.lines_added),
			linesRemoved: Math.max(0, event.diff_stat.lines_removed),
		} : undefined,
		command: normalizeOptionalString(event.command),
		exitCode: typeof event.exit_code === 'number' ? event.exit_code : undefined,
		durationMs: typeof event.duration_ms === 'number' ? event.duration_ms : undefined,
		raw: event.raw,
		payload: event.payload,
	})));
}

export function toPresentationWorktreeState(worktree: IWorktreeGetResult): AtlasModel.IWorktreeState {
	const workingTreeClean = typeof worktree.working_tree_clean === 'boolean' ? worktree.working_tree_clean : undefined;
	const mergeReady = typeof worktree.merge_ready === 'boolean' ? worktree.merge_ready : undefined;
	let attentionLevel = ATTENTION.idle;
	if (workingTreeClean === false || mergeReady === false) {
		attentionLevel = ATTENTION.needsAction;
	}

	return {
		worktreePath: worktree.worktree_path,
		dispatchId: worktree.dispatch_id,
		taskId: worktree.task_id,
		objectiveId: normalizeOptionalString(worktree.objective_id),
		branch: normalizeOptionalString(worktree.branch),
		baseRef: normalizeOptionalString(worktree.base_ref),
		headSha: normalizeOptionalString(worktree.head_sha),
		workingTreeClean,
		mergeReady,
		attentionLevel,
		createdAt: parseOptionalTimestamp(worktree.created_at),
		updatedAt: parseOptionalTimestamp(worktree.updated_at),
	};
}

export function toBridgeTaskLineageNode(node: ITaskTreeNodeDetail): IHarnessTaskLineageNode {
	return {
		taskId: node.task.task_id,
		parentTaskId: node.task.parent_task_id ?? undefined,
		depth: node.task.depth,
		status: node.task.status,
		aggregationStrategy: node.task.aggregation_strategy ?? undefined,
		dispatchId: node.latest_dispatch?.dispatch_id,
		roleId: node.latest_dispatch?.role_id,
		priority: node.latest_dispatch?.priority,
		handoffType: node.latest_dispatch?.handoff_type,
		createdAt: parseRequiredTimestamp(node.task.created_at),
		completedAt: parseOptionalTimestamp(node.task.completed_at),
	};
}

export function toBridgeWorkerRecord(
	worker: {
		readonly dispatchId: string;
		readonly taskId: string;
		readonly roleId: string;
		readonly state: IFleetWorkerState['state'];
		readonly handoffType: IFleetWorkerState['handoff_type'];
		readonly pid: number | undefined;
		readonly asi: number | undefined;
		readonly startedAt: string;
		readonly lastHeartbeatAt: string;
		readonly worktreePath: string | undefined;
	},
): IHarnessWorkerRecord {
	return {
		dispatchId: worker.dispatchId,
		taskId: worker.taskId,
		roleId: worker.roleId,
		state: worker.state,
		handoffType: worker.handoffType,
		pid: worker.pid,
		asi: worker.asi,
		startedAt: parseRequiredTimestamp(worker.startedAt),
		lastHeartbeatAt: parseRequiredTimestamp(worker.lastHeartbeatAt),
		worktreePath: worker.worktreePath,
	};
}

export function toBridgeQueueSnapshot(queue: {
	readonly dispatchQueueDepth: number;
	readonly mergeQueueDepth: number;
	readonly mergeConflicts: number;
	readonly pendingWorkspaceEvents: number;
}): IHarnessQueueSnapshot {
	return {
		dispatchQueueDepth: queue.dispatchQueueDepth,
		mergeQueueDepth: queue.mergeQueueDepth,
		mergeConflicts: queue.mergeConflicts,
		pendingWorkspaceEvents: queue.pendingWorkspaceEvents,
	};
}

function normalizeWorker(worker: IFleetWorkerState, worktreePath: string | undefined): IHarnessWorkerRecord {
	return {
		dispatchId: worker.dispatch_id,
		taskId: worker.task_id,
		roleId: worker.role_id,
		state: worker.state,
		handoffType: worker.handoff_type,
		pid: worker.pid,
		asi: worker.asi,
		startedAt: parseRequiredTimestamp(worker.started_at),
		lastHeartbeatAt: parseRequiredTimestamp(worker.last_heartbeat_at),
		worktreePath,
	};
}

function normalizeQueue(queue: IFleetSnapshotResult['snapshot']['queue']): IHarnessQueueSnapshot {
	return {
		dispatchQueueDepth: queue.dispatch_queue_depth,
		mergeQueueDepth: queue.merge_queue_depth,
		mergeConflicts: queue.merge_conflicts,
		pendingWorkspaceEvents: queue.pending_workspace_events,
	};
}

function normalizeHealth(health: IDaemonHealthState): IHarnessHealthSnapshot {
	return {
		mode: health.mode,
		diskUsagePct: health.disk_usage_pct,
		memoryUsagePct: health.memory_usage_pct,
		walSizeBytes: health.wal_size_bytes,
		activeWorkers: health.active_workers,
		queueDepth: health.queue_depth,
		lastHealthCheck: parseRequiredTimestamp(health.last_health_check),
	};
}

function toPresentationAgent(worker: IHarnessWorkerRecord): AtlasModel.IAgentState {
	const status = toPresentationStatus(worker.state);
	return {
		dispatchId: worker.dispatchId,
		taskId: worker.taskId,
		roleId: worker.roleId,
		status,
		worktreePath: worker.worktreePath,
		pid: worker.pid,
		startedAt: worker.startedAt,
		lastHeartbeat: worker.lastHeartbeatAt,
		role: toPresentationRole(worker.roleId),
		costSpent: 0,
		lastActivity: undefined,
		timeInState: 0,
		attentionLevel: toAgentAttention(status),
	};
}

function toPresentationObjective(record: IObjectiveRecord): AtlasModel.IObjectiveState {
	const status = toPresentationObjectiveStatus(record.status);
	return {
		objectiveId: record.spec.objective_id,
		problemStatement: record.spec.problem_statement,
		playbookIds: freezeStrings(record.spec.playbook_ids),
		desiredOutcomes: freezeStrings(record.spec.desired_outcomes),
		constraints: freezeStrings(record.spec.constraints),
		contextPaths: freezeStrings(record.spec.context_paths),
		successCriteria: freezeStrings(record.spec.success_criteria),
		operatorNotes: freezeStrings(record.spec.operator_notes),
		priority: toPresentationDispatchPriority(record.spec.priority),
		status,
		rootTaskId: record.root_task_id,
		resumeCount: record.resume_count,
		maxResumeCycles: record.max_resume_cycles,
		maxParallelWorkers: record.spec.max_parallel_workers,
		costSpent: 0,
		costCeiling: record.spec.budget_ceiling_usd,
		attentionLevel: toObjectiveAttention(status),
		createdAt: parseRequiredTimestamp(record.created_at),
		updatedAt: parseRequiredTimestamp(record.updated_at),
		completedAt: parseOptionalTimestamp(record.completed_at),
	};
}

function toPresentationReviewGate(record: IReviewCandidateRecord): AtlasModel.IReviewGateState {
	const judgeDecision = toPresentationJudgeDecision(record.judge_decision ?? undefined);
	return {
		dispatchId: record.dispatch_id,
		taskId: record.task_id,
		roleId: record.role_id,
		candidateBranch: record.candidate_branch,
		baseRef: record.base_ref,
		baseHeadSha: record.base_head_sha,
		mergeBaseSha: record.merge_base_sha,
		reviewedHeadSha: record.reviewed_head_sha,
		commitShas: freezeStrings(record.commit_shas),
		workingTreeClean: record.working_tree_clean,
		reviewState: toPresentationReviewState(record.review_state),
		judgeDecision,
		reviewedByRole: record.reviewed_by_role ?? undefined,
		reviewedAt: parseOptionalTimestamp(record.reviewed_at),
		promotionState: toPresentationPromotionState(record.promotion_state),
		promotionAuthorizedAt: parseOptionalTimestamp(record.promotion_authorized_at),
		promotionAuthorizedByRole: record.promotion_authorized_by_role ?? undefined,
		integrationState: toPresentationIntegrationState(record.integration_state),
		mergedSha: record.merged_sha ?? undefined,
		mergeExecutorId: record.merge_executor_id ?? undefined,
		stateReason: record.state_reason ?? undefined,
		attentionLevel: toReviewAttention(record),
		createdAt: parseRequiredTimestamp(record.created_at),
		updatedAt: parseRequiredTimestamp(record.updated_at),
	};
}

function toPresentationMergeEntry(record: IMergeQueueRecord): AtlasModel.IMergeEntry {
	return {
		dispatchId: record.dispatch_id,
		taskId: record.task_id,
		worktreePath: record.worktree_path,
		candidateBranch: record.candidate_branch,
		baseRef: record.base_ref,
		baseHeadSha: record.base_head_sha,
		mergeBaseSha: record.merge_base_sha,
		reviewedHeadSha: record.reviewed_head_sha,
		priority: record.priority,
		status: normalizeMergeStatus(record.status),
		mergeSha: record.merge_sha ?? undefined,
		conflictDetails: record.conflict_details ?? undefined,
		affectedPaths: record.affected_paths ? freezeStrings(record.affected_paths) : undefined,
		judgeDecision: toPresentationJudgeDecision(record.judge_decision ?? undefined),
		reviewedByRole: record.reviewed_by_role ?? undefined,
		reviewedAt: parseOptionalTimestamp(record.reviewed_at),
		promotionAuthorizedAt: parseOptionalTimestamp(record.promotion_authorized_at),
		promotionAuthorizedByRole: record.promotion_authorized_by_role ?? undefined,
		mergeExecutorId: record.merge_executor_id ?? undefined,
		mergedAt: parseOptionalTimestamp(record.merged_at),
		blockedReason: record.blocked_reason ?? undefined,
		attentionLevel: toMergeAttention(record),
		enqueuedAt: parseRequiredTimestamp(record.enqueued_at),
	};
}

function toPresentationTaskFromTreeNode(
	node: ITaskTreeNodeDetail,
	objectiveId: string | undefined,
	assignedWorker: IHarnessWorkerRecord | undefined,
): AtlasModel.ITaskState {
	return toPresentationTask(node.task, objectiveId, node.latest_dispatch, assignedWorker);
}

function toPresentationTask(
	task: ITaskNode,
	objectiveId: string | undefined,
	latestDispatch: IQueueDispatch | undefined,
	assignedWorker: IHarnessWorkerRecord | undefined,
): AtlasModel.ITaskState {
	const status = toPresentationTaskStatus(task.status);
	const currentRoleId = latestDispatch?.role_id ?? assignedWorker?.roleId ?? '';
	return {
		taskId: task.task_id,
		dispatchId: latestDispatch?.dispatch_id ?? assignedWorker?.dispatchId,
		parentTaskId: task.parent_task_id ?? undefined,
		objectiveId,
		roleId: currentRoleId,
		fromRole: undefined,
		toRole: currentRoleId || undefined,
		summary: '',
		handoffType: toPresentationHandoffType(latestDispatch?.handoff_type),
		status,
		priority: priorityToNumber(latestDispatch?.priority),
		acceptance: Object.freeze([]),
		constraints: Object.freeze([]),
		artifacts: Object.freeze([]),
		memoryKeywords: Object.freeze([]),
		contextPaths: Object.freeze([]),
		dependsOn: Object.freeze([]),
		assignedAgentId: assignedWorker?.dispatchId,
		costSpent: 0,
		attentionLevel: toTaskAttention(status),
		enqueuedAt: parseRequiredTimestamp(task.created_at),
		startedAt: assignedWorker?.startedAt,
		completedAt: parseOptionalTimestamp(task.completed_at),
	};
}

function latestWorkerByTaskId(workers: readonly IHarnessWorkerRecord[]): Map<string, IHarnessWorkerRecord> {
	const result = new Map<string, IHarnessWorkerRecord>();
	for (const worker of workers) {
		const current = result.get(worker.taskId);
		if (!current || current.startedAt <= worker.startedAt) {
			result.set(worker.taskId, worker);
		}
	}
	return result;
}

function toPresentationStatus(state: IFleetWorkerState['state']): AgentStatus {
	switch (state) {
		case 'queued':
		case 'spawning':
			return AGENT_STATUS.spawning;
		case 'ready':
			return AGENT_STATUS.idle;
		case 'executing':
		case 'completing':
			return AGENT_STATUS.running;
		case 'paused':
			return AGENT_STATUS.blocked;
		case 'completed':
			return AGENT_STATUS.completed;
		case 'timed_out':
			return AGENT_STATUS.timedOut;
		case 'failed':
		case 'killed':
		default:
			return AGENT_STATUS.failed;
	}
}

function toPresentationRole(roleId: string): AgentRole {
	const normalized = roleId.toLowerCase();
	if (normalized.includes('judge')) {
		return AGENT_ROLE.judge;
	}
	if (normalized.includes('planner')) {
		return AGENT_ROLE.planner;
	}
	return AGENT_ROLE.worker;
}

function toAgentAttention(status: AgentStatus): AttentionLevel {
	switch (status) {
		case AGENT_STATUS.failed:
		case AGENT_STATUS.timedOut:
			return ATTENTION.critical;
		case AGENT_STATUS.blocked:
			return ATTENTION.needsAction;
		case AGENT_STATUS.spawning:
		case AGENT_STATUS.running:
			return ATTENTION.active;
		case AGENT_STATUS.completed:
			return ATTENTION.completed;
		case AGENT_STATUS.idle:
		default:
			return ATTENTION.idle;
	}
}

function normalizePoolMode(mode: string): PoolMode {
	switch (mode) {
		// Phase 0b presentation state does not expose an "unknown" pool mode, so
		// fail closed to a degraded state instead of rendering unverified health as normal.
		case 'nats_down':
			return POOL_MODE.natsDown;
		case 'disk_pressure':
			return POOL_MODE.diskPressure;
		case 'cost_ceiling':
			return POOL_MODE.costCeiling;
		case 'normal':
			return POOL_MODE.normal;
		case 'unknown':
		case 'paused':
		default:
			return POOL_MODE.paused;
	}
}

function toPresentationObjectiveStatus(status: IObjectiveRecord['status']): ObjectiveStatus {
	switch (status) {
		case 'planning':
			return OBJECTIVE_STATUS.planning;
		case 'executing':
			return OBJECTIVE_STATUS.executing;
		case 'reviewing':
			return OBJECTIVE_STATUS.reviewing;
		case 'completed':
			return OBJECTIVE_STATUS.completed;
		case 'failed':
			return OBJECTIVE_STATUS.failed;
		case 'open':
		default:
			return OBJECTIVE_STATUS.open;
	}
}

function toObjectiveAttention(status: ObjectiveStatus): AttentionLevel {
	switch (status) {
		case OBJECTIVE_STATUS.failed:
			return ATTENTION.critical;
		case OBJECTIVE_STATUS.reviewing:
			return ATTENTION.needsAction;
		case OBJECTIVE_STATUS.planning:
		case OBJECTIVE_STATUS.executing:
			return ATTENTION.active;
		case OBJECTIVE_STATUS.completed:
			return ATTENTION.completed;
		case OBJECTIVE_STATUS.open:
		default:
			return ATTENTION.idle;
	}
}

function toPresentationTaskStatus(status: ITaskNode['status']): TaskStatus {
	switch (status) {
		case 'running':
			return TASK_STATUS.executing;
		case 'blocked':
			return TASK_STATUS.blocked;
		case 'completed':
			return TASK_STATUS.completed;
		case 'failed':
			return TASK_STATUS.failed;
		case 'cancelled':
			return TASK_STATUS.cancelled;
		case 'pending':
		default:
			return TASK_STATUS.queued;
	}
}

function toTaskAttention(status: TaskStatus): AttentionLevel {
	switch (status) {
		case TASK_STATUS.failed:
			return ATTENTION.critical;
		case TASK_STATUS.blocked:
		case TASK_STATUS.reviewing:
			return ATTENTION.needsAction;
		case TASK_STATUS.executing:
			return ATTENTION.active;
		case TASK_STATUS.completed:
			return ATTENTION.completed;
		case TASK_STATUS.queued:
		case TASK_STATUS.cancelled:
		default:
			return ATTENTION.idle;
	}
}

function normalizeMergeStatus(status: string): MergeStatus {
	switch (status) {
		case 'merge_started':
			return MERGE_STATUS.mergeStarted;
		case 'merged':
			return MERGE_STATUS.merged;
		case 'merge_blocked':
			return MERGE_STATUS.mergeBlocked;
		case 'abandoned':
			return MERGE_STATUS.abandoned;
		case 'queued':
		case 'pending':
		default:
			return MERGE_STATUS.pending;
	}
}

function toPresentationDispatchPriority(priority: IQueueDispatch['priority']): AtlasModel.IObjectiveState['priority'] {
	return priority as AtlasModel.IObjectiveState['priority'];
}

function toPresentationReviewState(state: IReviewCandidateRecord['review_state']): AtlasModel.IReviewGateState['reviewState'] {
	return state as AtlasModel.IReviewGateState['reviewState'];
}

function toPresentationPromotionState(state: IReviewCandidateRecord['promotion_state']): AtlasModel.IReviewGateState['promotionState'] {
	return state as AtlasModel.IReviewGateState['promotionState'];
}

function toPresentationIntegrationState(state: IReviewCandidateRecord['integration_state']): AtlasModel.IReviewGateState['integrationState'] {
	return state as AtlasModel.IReviewGateState['integrationState'];
}

function toPresentationJudgeDecision(
	decision: IReviewCandidateRecord['judge_decision'] | IMergeQueueRecord['judge_decision'] | undefined,
): AtlasModel.ReviewDecision | undefined {
	return decision as AtlasModel.ReviewDecision | undefined;
}

function toPresentationHandoffType(handoffType: IQueueDispatch['handoff_type'] | undefined): AtlasModel.ITaskState['handoffType'] {
	return handoffType as AtlasModel.ITaskState['handoffType'];
}

function toReviewAttention(record: IReviewCandidateRecord): AttentionLevel {
	if (record.judge_decision === 'no-go' || record.review_state === 'review_blocked' || record.integration_state === 'merge_blocked') {
		return ATTENTION.critical;
	}
	if (record.review_state === 'awaiting_review'
		|| record.promotion_state === 'promotion_requested'
		|| record.integration_state === 'queued') {
		return ATTENTION.needsAction;
	}
	if (record.integration_state === 'merged') {
		return ATTENTION.completed;
	}
	if (record.review_state === 'review_go'
		|| record.promotion_state === 'promotion_authorized'
		|| record.integration_state === 'merge_started') {
		return ATTENTION.active;
	}
	return ATTENTION.idle;
}

function toMergeAttention(record: IMergeQueueRecord): AttentionLevel {
	switch (normalizeMergeStatus(record.status)) {
		case MERGE_STATUS.mergeBlocked:
			return ATTENTION.critical;
		case MERGE_STATUS.pending:
			return ATTENTION.needsAction;
		case MERGE_STATUS.mergeStarted:
			return ATTENTION.active;
		case MERGE_STATUS.merged:
			return ATTENTION.completed;
		case MERGE_STATUS.abandoned:
		default:
			return ATTENTION.idle;
	}
}

function priorityToNumber(priority: IQueueDispatch['priority'] | undefined): number {
	switch (priority) {
		case 'p0':
			return 0;
		case 'p1':
			return 1;
		case 'p2':
			return 2;
		case 'p3':
			return 3;
		case 'info':
			return 4;
		default:
			// Phase 0b presentation still requires a numeric priority even though task tree
			// reads do not always have a current dispatch. Use an explicit sentinel rather
			// than pretending the task has a real dispatch priority.
			return -1;
	}
}

function parseRequiredTimestamp(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function parseOptionalTimestamp(value: string | null | undefined): number | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function freezeWorkers(workers: IHarnessWorkerRecord[]): readonly IHarnessWorkerRecord[] {
	workers.sort((left, right) => left.startedAt - right.startedAt || left.dispatchId.localeCompare(right.dispatchId));
	return Object.freeze(workers.slice());
}

function freezeAgents(agents: AtlasModel.IAgentState[]): readonly AtlasModel.IAgentState[] {
	return Object.freeze(agents.slice());
}

function freezeStrings(values: readonly string[] | readonly string[] | undefined): readonly string[] {
	return Object.freeze((values ?? []).slice());
}
