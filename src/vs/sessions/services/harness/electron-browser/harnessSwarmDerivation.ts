/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IHarnessTaskTree } from '../common/harnessTypes.js';

type SwarmPhase = AtlasModel.ISwarmState['phase'];
type AttentionLevel = AtlasModel.ISwarmState['attentionLevel'];
type TaskStatus = AtlasModel.ITaskState['status'];
type AgentStatus = AtlasModel.IAgentState['status'];
type ReviewState = AtlasModel.IReviewGateState['reviewState'];
type MergeStatus = AtlasModel.IMergeEntry['status'];
type ObjectiveStatus = AtlasModel.IObjectiveState['status'];
type PoolMode = AtlasModel.IHealthState['mode'];

const SWARM_PHASE = {
	planning: 'planning' as SwarmPhase,
	executing: 'executing' as SwarmPhase,
	reviewing: 'reviewing' as SwarmPhase,
	merging: 'merging' as SwarmPhase,
	completed: 'completed' as SwarmPhase,
	failed: 'failed' as SwarmPhase,
};

const ATTENTION = {
	critical: 4 as AttentionLevel,
	needsAction: 3 as AttentionLevel,
	active: 2 as AttentionLevel,
	idle: 1 as AttentionLevel,
	completed: 0 as AttentionLevel,
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

const AGENT_STATUS = {
	spawning: 'spawning' as AgentStatus,
	running: 'running' as AgentStatus,
	blocked: 'blocked' as AgentStatus,
};

const REVIEW_STATE = {
	awaitingReview: 'awaiting_review' as ReviewState,
	reviewBlocked: 'review_blocked' as ReviewState,
};

const MERGE_STATUS = {
	pending: 'pending' as MergeStatus,
	mergeStarted: 'merge_started' as MergeStatus,
	mergeBlocked: 'merge_blocked' as MergeStatus,
};

const OBJECTIVE_STATUS = {
	failed: 'failed' as ObjectiveStatus,
	reviewing: 'reviewing' as ObjectiveStatus,
};

const POOL_MODE = {
	normal: 'normal' as PoolMode,
};

interface IResolvedObjectiveAttachment {
	readonly objectiveId: string | undefined;
	readonly objectiveStatus: ObjectiveStatus | undefined;
	readonly objectiveProblemStatement: string | undefined;
	readonly costCeiling: number | undefined;
	readonly updatedAt: number | undefined;
}

interface ISwarmDerivationContext {
	readonly hasFailures: boolean;
	readonly reviewNeeded: boolean;
	readonly mergeBlocked: boolean;
	readonly hasBlockedTasks: boolean;
	readonly hasBlockedAgents: boolean;
	readonly hasActiveAgents: boolean;
	readonly hasQueuedTasks: boolean;
	readonly hasExecutingTasks: boolean;
	readonly hasMergeInFlight: boolean;
	readonly allTasksQueued: boolean;
	readonly allLeafTasksCompleted: boolean;
	readonly hasIncompleteTasks: boolean;
}

export function deriveSwarms(
	taskTrees: readonly IHarnessTaskTree[],
	tasks: readonly AtlasModel.ITaskState[],
	objectives: readonly AtlasModel.IObjectiveState[],
	fleet: AtlasModel.IFleetState,
	reviewGates: readonly AtlasModel.IReviewGateState[],
	mergeQueue: readonly AtlasModel.IMergeEntry[],
	health: AtlasModel.IHealthState,
): readonly AtlasModel.ISwarmState[] {
	if (taskTrees.length === 0) {
		return Object.freeze([]);
	}

	const tasksById = new Map(tasks.map(task => [task.taskId, task] as const));
	const objectivesByRootTaskId = new Map<string, AtlasModel.IObjectiveState[]>();
	for (const objective of objectives) {
		if (!objective.rootTaskId) {
			continue;
		}
		const existing = objectivesByRootTaskId.get(objective.rootTaskId);
		if (existing) {
			existing.push(objective);
		} else {
			objectivesByRootTaskId.set(objective.rootTaskId, [objective]);
		}
	}

	const swarms: AtlasModel.ISwarmState[] = [];
	for (const taskTree of taskTrees) {
		const taskIds = unique(taskTree.nodes.map(node => node.taskId));
		const taskSet = new Set(taskIds);
		const rootTask = tasksById.get(taskTree.rootTaskId);
		if (!rootTask) {
			continue;
		}

		const swarmTasks = taskIds
			.map(taskId => tasksById.get(taskId))
			.filter((task): task is AtlasModel.ITaskState => task !== undefined);
		const taskOrder = new Map(taskIds.map((taskId, index) => [taskId, index] as const));
		const swarmAgents = sortAgents(
			fleet.agents.filter(agent => taskSet.has(agent.taskId)),
			taskOrder,
		);
		const swarmReviewGates = sortReviewGates(
			reviewGates.filter(reviewGate => taskSet.has(reviewGate.taskId)),
			taskOrder,
		);
		const swarmMergeEntries = sortMergeEntries(
			mergeQueue.filter(mergeEntry => taskSet.has(mergeEntry.taskId)),
			taskOrder,
		);
		const objectiveAttachment = resolveObjectiveAttachment(
			taskTree,
			swarmTasks,
			objectivesByRootTaskId.get(taskTree.rootTaskId) ?? [],
		);
		const leafTaskIds = collectLeafTaskIds(taskTree);
		const leafTasks = leafTaskIds
			.map(taskId => tasksById.get(taskId))
			.filter((task): task is AtlasModel.ITaskState => task !== undefined);
		const context = deriveSwarmContext(
			rootTask,
			leafTasks,
			swarmTasks,
			swarmAgents,
			swarmReviewGates,
			swarmMergeEntries,
			objectiveAttachment.objectiveStatus,
		);
		const phase = deriveSwarmPhase(context);
		const attentionLevel = deriveSwarmAttention(context, phase, health);
		const createdAt = rootTask.enqueuedAt;
		const updatedAt = maxTimestamp([
			createdAt,
			objectiveAttachment.updatedAt,
			...swarmTasks.flatMap(task => [task.enqueuedAt, task.startedAt, task.completedAt]),
			...swarmAgents.flatMap(agent => [agent.startedAt, agent.lastHeartbeat]),
			...swarmReviewGates.flatMap(reviewGate => [
				reviewGate.createdAt,
				reviewGate.updatedAt,
				reviewGate.reviewedAt,
				reviewGate.promotionAuthorizedAt,
			]),
			...swarmMergeEntries.flatMap(mergeEntry => [
				mergeEntry.enqueuedAt,
				mergeEntry.reviewedAt,
				mergeEntry.promotionAuthorizedAt,
				mergeEntry.mergedAt,
			]),
		]) ?? createdAt;

		swarms.push({
			swarmId: taskTree.rootTaskId,
			rootTaskId: taskTree.rootTaskId,
			objectiveId: objectiveAttachment.objectiveId,
			objectiveStatus: objectiveAttachment.objectiveStatus,
			objectiveProblemStatement: objectiveAttachment.objectiveProblemStatement,
			rootTaskStatus: rootTask.status,
			phase,
			taskIds: Object.freeze(taskIds),
			agentDispatchIds: Object.freeze(swarmAgents.map(agent => agent.dispatchId)),
			worktreePaths: Object.freeze(uniqueDefined(swarmAgents.map(agent => agent.worktreePath))),
			reviewDispatchIds: Object.freeze(unique(swarmReviewGates.map(reviewGate => reviewGate.dispatchId))),
			mergeDispatchIds: Object.freeze(unique(swarmMergeEntries.map(mergeEntry => mergeEntry.dispatchId))),
			reviewNeeded: context.reviewNeeded,
			mergeBlocked: context.mergeBlocked,
			hasFailures: context.hasFailures,
			hasBlockedTasks: context.hasBlockedTasks,
			memoryRecordCount: 0,
			costSpent: swarmAgents.reduce((total, agent) => total + agent.costSpent, 0),
			costCeiling: objectiveAttachment.costCeiling,
			attentionLevel,
			createdAt,
			updatedAt,
		});
	}

	return Object.freeze(sortSwarms(swarms));
}

function resolveObjectiveAttachment(
	taskTree: IHarnessTaskTree,
	tasks: readonly AtlasModel.ITaskState[],
	objectives: readonly AtlasModel.IObjectiveState[],
): IResolvedObjectiveAttachment {
	if (objectives.length !== 1) {
		return emptyObjectiveAttachment();
	}

	const [objective] = objectives;
	const referencedObjectiveIds = new Set<string>();
	if (taskTree.objectiveId) {
		referencedObjectiveIds.add(taskTree.objectiveId);
	}
	for (const task of tasks) {
		if (task.objectiveId) {
			referencedObjectiveIds.add(task.objectiveId);
		}
	}

	if (referencedObjectiveIds.size > 1) {
		return emptyObjectiveAttachment();
	}
	if (referencedObjectiveIds.size === 1 && !referencedObjectiveIds.has(objective.objectiveId)) {
		return emptyObjectiveAttachment();
	}

	return {
		objectiveId: objective.objectiveId,
		objectiveStatus: objective.status,
		objectiveProblemStatement: objective.problemStatement,
		costCeiling: objective.costCeiling,
		updatedAt: objective.updatedAt,
	};
}

function emptyObjectiveAttachment(): IResolvedObjectiveAttachment {
	return {
		objectiveId: undefined,
		objectiveStatus: undefined,
		objectiveProblemStatement: undefined,
		costCeiling: undefined,
		updatedAt: undefined,
	};
}

function deriveSwarmContext(
	rootTask: AtlasModel.ITaskState,
	leafTasks: readonly AtlasModel.ITaskState[],
	tasks: readonly AtlasModel.ITaskState[],
	agents: readonly AtlasModel.IAgentState[],
	reviewGates: readonly AtlasModel.IReviewGateState[],
	mergeEntries: readonly AtlasModel.IMergeEntry[],
	objectiveStatus: ObjectiveStatus | undefined,
): ISwarmDerivationContext {
	const hasFailedTasks = tasks.some(task => task.status === TASK_STATUS.failed || task.status === TASK_STATUS.cancelled);
	const hasFailures = hasFailedTasks || objectiveStatus === OBJECTIVE_STATUS.failed;
	const hasBlockedTasks = tasks.some(task => task.status === TASK_STATUS.blocked);
	const hasBlockedAgents = agents.some(agent => agent.status === AGENT_STATUS.blocked);
	const reviewNeeded = reviewGates.some(reviewGate =>
		reviewGate.reviewState === REVIEW_STATE.awaitingReview
		|| reviewGate.reviewState === REVIEW_STATE.reviewBlocked
	)
		|| tasks.some(task => task.status === TASK_STATUS.reviewing)
		|| objectiveStatus === OBJECTIVE_STATUS.reviewing;
	const mergeBlocked = mergeEntries.some(mergeEntry => mergeEntry.status === MERGE_STATUS.mergeBlocked)
		|| reviewGates.some(reviewGate => reviewGate.integrationState === 'merge_blocked');
	const hasMergeInFlight = mergeEntries.some(mergeEntry =>
		mergeEntry.status === MERGE_STATUS.pending || mergeEntry.status === MERGE_STATUS.mergeStarted
	);
	const hasActiveAgents = agents.some(agent =>
		agent.status === AGENT_STATUS.spawning || agent.status === AGENT_STATUS.running
	);
	const hasQueuedTasks = tasks.some(task => task.status === TASK_STATUS.queued);
	const hasExecutingTasks = tasks.some(task => task.status === TASK_STATUS.executing);
	const allTasksQueued = tasks.length > 0 && tasks.every(task => task.status === TASK_STATUS.queued);
	const allLeafTasksCompleted = leafTasks.length > 0
		? leafTasks.every(task => task.status === TASK_STATUS.completed)
		: rootTask.status === TASK_STATUS.completed;
	const hasIncompleteTasks = tasks.some(task =>
		task.status !== TASK_STATUS.completed
		&& task.status !== TASK_STATUS.failed
		&& task.status !== TASK_STATUS.cancelled
	);

	return {
		hasFailures,
		reviewNeeded,
		mergeBlocked,
		hasBlockedTasks,
		hasBlockedAgents,
		hasActiveAgents,
		hasQueuedTasks,
		hasExecutingTasks,
		hasMergeInFlight,
		allTasksQueued,
		allLeafTasksCompleted,
		hasIncompleteTasks,
	};
}

function deriveSwarmPhase(context: ISwarmDerivationContext): SwarmPhase {
	if (context.hasFailures || context.mergeBlocked) {
		return SWARM_PHASE.failed;
	}
	if (context.reviewNeeded) {
		return SWARM_PHASE.reviewing;
	}
	if (context.hasMergeInFlight) {
		return SWARM_PHASE.merging;
	}
	if (context.allLeafTasksCompleted && !context.hasIncompleteTasks) {
		return SWARM_PHASE.completed;
	}
	if (context.allTasksQueued) {
		return SWARM_PHASE.planning;
	}
	return SWARM_PHASE.executing;
}

function deriveSwarmAttention(
	context: ISwarmDerivationContext,
	phase: SwarmPhase,
	health: AtlasModel.IHealthState,
): AttentionLevel {
	if (context.hasFailures || context.mergeBlocked) {
		return ATTENTION.critical;
	}
	if (context.reviewNeeded || context.hasBlockedTasks || context.hasBlockedAgents) {
		return ATTENTION.needsAction;
	}
	if (phase === SWARM_PHASE.completed) {
		return ATTENTION.completed;
	}
	if (health.mode !== POOL_MODE.normal) {
		return ATTENTION.needsAction;
	}
	if (context.hasActiveAgents || context.hasQueuedTasks || context.hasExecutingTasks || context.hasMergeInFlight) {
		return ATTENTION.active;
	}
	return ATTENTION.idle;
}

function collectLeafTaskIds(taskTree: IHarnessTaskTree): readonly string[] {
	const parentTaskIds = new Set<string>();
	for (const node of taskTree.nodes) {
		if (node.parentTaskId) {
			parentTaskIds.add(node.parentTaskId);
		}
	}

	const leafTaskIds = taskTree.nodes
		.map(node => node.taskId)
		.filter(taskId => !parentTaskIds.has(taskId));
	return leafTaskIds.length > 0 ? Object.freeze(leafTaskIds) : Object.freeze([taskTree.rootTaskId]);
}

function sortAgents(
	agents: readonly AtlasModel.IAgentState[],
	taskOrder: ReadonlyMap<string, number>,
): readonly AtlasModel.IAgentState[] {
	return Object.freeze([...agents].sort((left, right) =>
		compareNumbers(taskOrder.get(left.taskId) ?? Number.MAX_SAFE_INTEGER, taskOrder.get(right.taskId) ?? Number.MAX_SAFE_INTEGER)
		|| left.dispatchId.localeCompare(right.dispatchId)
	));
}

function sortReviewGates(
	reviewGates: readonly AtlasModel.IReviewGateState[],
	taskOrder: ReadonlyMap<string, number>,
): readonly AtlasModel.IReviewGateState[] {
	return Object.freeze([...reviewGates].sort((left, right) =>
		compareNumbers(taskOrder.get(left.taskId) ?? Number.MAX_SAFE_INTEGER, taskOrder.get(right.taskId) ?? Number.MAX_SAFE_INTEGER)
		|| left.dispatchId.localeCompare(right.dispatchId)
	));
}

function sortMergeEntries(
	mergeEntries: readonly AtlasModel.IMergeEntry[],
	taskOrder: ReadonlyMap<string, number>,
): readonly AtlasModel.IMergeEntry[] {
	return Object.freeze([...mergeEntries].sort((left, right) =>
		compareNumbers(taskOrder.get(left.taskId) ?? Number.MAX_SAFE_INTEGER, taskOrder.get(right.taskId) ?? Number.MAX_SAFE_INTEGER)
		|| left.dispatchId.localeCompare(right.dispatchId)
	));
}

function sortSwarms(swarms: readonly AtlasModel.ISwarmState[]): readonly AtlasModel.ISwarmState[] {
	return [...swarms].sort((left, right) =>
		compareNumbers(right.attentionLevel, left.attentionLevel)
		|| compareNumbers(right.updatedAt, left.updatedAt)
		|| left.swarmId.localeCompare(right.swarmId)
	);
}

function maxTimestamp(values: readonly (number | undefined)[]): number | undefined {
	let max: number | undefined;
	for (const value of values) {
		if (value === undefined) {
			continue;
		}
		max = max === undefined ? value : Math.max(max, value);
	}
	return max;
}

function unique(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (seen.has(value)) {
			continue;
		}
		seen.add(value);
		result.push(value);
	}
	return result;
}

function uniqueDefined(values: readonly (string | undefined)[]): string[] {
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

function compareNumbers(left: number, right: number): number {
	return left - right;
}
