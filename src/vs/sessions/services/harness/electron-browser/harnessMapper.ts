/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	IDaemonHealthState,
	IFleetDeltaNotification,
	IFleetSnapshotResult,
	IFleetWorkerState,
	IHarnessFleetStateSnapshot,
	IHarnessHealthSnapshot,
	IHarnessQueueSnapshot,
	IHarnessWorkerRecord,
} from '../common/harnessTypes.js';

type AgentStatus = AtlasModel.IAgentState['status'];
type AgentRole = AtlasModel.IAgentState['role'];
type AttentionLevel = AtlasModel.IAgentState['attentionLevel'];
type PoolMode = AtlasModel.IHealthState['mode'];

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
	mode: POOL_MODE.normal,
	diskUsagePct: 0,
	memoryUsagePct: 0,
	walSizeBytes: undefined,
	activeWorkers: 0,
	queueDepth: 0,
	attentionLevel: ATTENTION.idle,
	lastHealthCheck: undefined,
});

export const EMPTY_COST_STATE: AtlasModel.ICostState = Object.freeze({
	totalSpentUsd: 0,
	budgetCeilingUsd: undefined,
	utilization: undefined,
	burnRateUsdPerHour: undefined,
	breakdowns: Object.freeze([]) as AtlasModel.ICostState['breakdowns'],
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
		health: {
			mode: 'unknown',
			diskUsagePct: 0,
			memoryUsagePct: 0,
			walSizeBytes: 0,
			activeWorkers: 0,
			queueDepth: 0,
			lastHealthCheck: undefined,
		},
	};
}

export function snapshotStateFromDaemonSnapshot(result: IFleetSnapshotResult): IHarnessFleetStateSnapshot {
	return {
		capturedAt: parseTimestamp(result.snapshot.captured_at),
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
		capturedAt: parseTimestamp(delta.captured_at),
		seq: delta.seq,
		subscriptionId: delta.subscription_id,
		workers: freezeWorkers([...workers.values()]),
		queue: normalizeQueue(delta.queue),
		health: normalizeHealth(delta.health),
	};
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

export function toPresentationHealth(state: IHarnessFleetStateSnapshot): AtlasModel.IHealthState {
	const health = state.health;
	const mode = normalizePoolMode(health.mode);

	let attentionLevel = ATTENTION.idle;
	if (mode !== POOL_MODE.normal) {
		attentionLevel = ATTENTION.needsAction;
	} else if (state.queue.mergeConflicts > 0) {
		attentionLevel = ATTENTION.needsAction;
	} else if (health.activeWorkers > 0 || health.queueDepth > 0 || state.queue.pendingWorkspaceEvents > 0) {
		attentionLevel = ATTENTION.active;
	}

	return {
		mode,
		diskUsagePct: health.diskUsagePct,
		memoryUsagePct: health.memoryUsagePct,
		walSizeBytes: health.walSizeBytes,
		activeWorkers: health.activeWorkers,
		queueDepth: health.queueDepth,
		attentionLevel,
		lastHealthCheck: health.lastHealthCheck,
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
		startedAt: parseTimestamp(worker.started_at),
		lastHeartbeatAt: parseTimestamp(worker.last_heartbeat_at),
		worktreePath,
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
		startedAt: parseTimestamp(worker.startedAt),
		lastHeartbeatAt: parseTimestamp(worker.lastHeartbeatAt),
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
		walSizeBytes: health.walSizeBytes,
		activeWorkers: health.activeWorkers,
		queueDepth: health.queueDepth,
		lastHealthCheck: health.lastHealthCheck ? parseTimestamp(health.lastHealthCheck) : undefined,
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
		lastHealthCheck: parseTimestamp(health.last_health_check),
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
		case 'unknown':
			return POOL_MODE.paused;
		case 'nats_down':
			return POOL_MODE.natsDown;
		case 'disk_pressure':
			return POOL_MODE.diskPressure;
		case 'cost_ceiling':
			return POOL_MODE.costCeiling;
		case 'paused':
			return POOL_MODE.paused;
		case 'normal':
			return POOL_MODE.normal;
		default:
			return POOL_MODE.paused;
	}
}

function parseTimestamp(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function freezeWorkers(workers: IHarnessWorkerRecord[]): readonly IHarnessWorkerRecord[] {
	workers.sort((left, right) => left.startedAt - right.startedAt || left.dispatchId.localeCompare(right.dispatchId));
	return Object.freeze(workers.slice());
}

function freezeAgents(agents: AtlasModel.IAgentState[]): readonly AtlasModel.IAgentState[] {
	return Object.freeze(agents.slice());
}
