/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-layering, local/code-import-patterns -- Node-side derivation tests intentionally exercise the desktop swarm derivation implementation directly. */

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AgentRole, AgentStatus } from '../../../../common/model/agent.js';
import { PoolMode } from '../../../../common/model/health.js';
import { ObjectiveStatus } from '../../../../common/model/objective.js';
import { MergeExecutionStatus } from '../../../../common/model/review.js';
import { TaskStatus } from '../../../../common/model/task.js';
import {
	WireDispatchPriority,
	WireIntegrationState,
	WirePromotionState,
	WireReviewState,
} from '../../../../common/model/wire.js';
import type { IHarnessTaskTree } from '../../common/harnessTypes.js';
import { deriveSwarms } from '../../electron-browser/harnessSwarmDerivation.js';

suite('HarnessSwarmDerivation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('derives an objective-backed swarm from rooted lineage and agent membership', () => {
		const swarms = deriveSwarms(
			[
				createTaskTree('TASK-ROOT-1', 'OBJ-1', [
					createTaskTreeNode('TASK-ROOT-1', undefined, 0),
					createTaskTreeNode('TASK-CHILD-1', 'TASK-ROOT-1', 1),
				]),
			],
			[
				createTaskState({
					taskId: 'TASK-ROOT-1',
					dispatchId: 'disp-root',
					objectiveId: 'OBJ-1',
					status: TaskStatus.Executing,
					enqueuedAt: 100,
					startedAt: 125,
				}),
				createTaskState({
					taskId: 'TASK-CHILD-1',
					parentTaskId: 'TASK-ROOT-1',
					dispatchId: 'disp-child',
					objectiveId: 'OBJ-1',
					roleId: 'worker',
					status: TaskStatus.Queued,
					enqueuedAt: 150,
				}),
			],
			[
				createObjectiveState({
					objectiveId: 'OBJ-1',
					rootTaskId: 'TASK-ROOT-1',
					problemStatement: 'Ship Phase 3',
					status: ObjectiveStatus.Executing,
					costCeiling: 42,
					updatedAt: 170,
				}),
			],
			createFleetState([
				createAgentState({
					dispatchId: 'disp-root',
					taskId: 'TASK-ROOT-1',
					status: AgentStatus.Running,
					worktreePath: '/tmp/root-worktree',
					costSpent: 5,
					lastHeartbeat: 190,
				}),
			]),
			Object.freeze([]),
			Object.freeze([]),
			createHealthState(),
		);

		assert.strictEqual(swarms.length, 1);

		const [swarm] = swarms;
		assert.strictEqual(swarm.swarmId, 'TASK-ROOT-1');
		assert.strictEqual(swarm.rootTaskId, 'TASK-ROOT-1');
		assert.strictEqual(swarm.objectiveId, 'OBJ-1');
		assert.strictEqual(swarm.objectiveStatus, 'executing');
		assert.strictEqual(swarm.objectiveProblemStatement, 'Ship Phase 3');
		assert.strictEqual(swarm.rootTaskStatus, 'executing');
		assert.deepStrictEqual(swarm.taskIds, ['TASK-ROOT-1', 'TASK-CHILD-1']);
		assert.deepStrictEqual(swarm.agentDispatchIds, ['disp-root']);
		assert.deepStrictEqual(swarm.worktreePaths, ['/tmp/root-worktree']);
		assert.deepStrictEqual(swarm.reviewDispatchIds, []);
		assert.deepStrictEqual(swarm.mergeDispatchIds, []);
		assert.strictEqual(swarm.phase, 'executing');
		assert.strictEqual(swarm.attentionLevel, 2);
		assert.strictEqual(swarm.reviewNeeded, false);
		assert.strictEqual(swarm.mergeBlocked, false);
		assert.strictEqual(swarm.hasFailures, false);
		assert.strictEqual(swarm.hasBlockedTasks, false);
		assert.strictEqual(swarm.costSpent, 5);
		assert.strictEqual(swarm.costCeiling, 42);
		assert.strictEqual(swarm.createdAt, 100);
		assert.strictEqual(swarm.updatedAt, 190);
	});

	test('derives concurrent swarms with stable root-task identity and ad-hoc objective omission', () => {
		const swarms = deriveSwarms(
			[
				createTaskTree('TASK-ROOT-A', undefined, [
					createTaskTreeNode('TASK-ROOT-A', undefined, 0),
					createTaskTreeNode('TASK-A-CHILD', 'TASK-ROOT-A', 1),
				]),
				createTaskTree('TASK-ROOT-B', 'OBJ-B', [
					createTaskTreeNode('TASK-ROOT-B', undefined, 0),
				]),
			],
			[
				createTaskState({
					taskId: 'TASK-ROOT-A',
					dispatchId: 'disp-a',
					status: TaskStatus.Completed,
					enqueuedAt: 100,
					completedAt: 180,
				}),
				createTaskState({
					taskId: 'TASK-A-CHILD',
					parentTaskId: 'TASK-ROOT-A',
					roleId: 'worker',
					status: TaskStatus.Completed,
					enqueuedAt: 110,
					completedAt: 200,
				}),
				createTaskState({
					taskId: 'TASK-ROOT-B',
					dispatchId: 'disp-b',
					objectiveId: 'OBJ-B',
					status: TaskStatus.Queued,
					enqueuedAt: 300,
				}),
			],
			[
				createObjectiveState({
					objectiveId: 'OBJ-B',
					rootTaskId: 'TASK-ROOT-B',
					problemStatement: 'Objective-backed swarm',
					status: ObjectiveStatus.Planning,
					updatedAt: 320,
				}),
			],
			createFleetState([
				createAgentState({
					dispatchId: 'disp-b',
					taskId: 'TASK-ROOT-B',
					status: AgentStatus.Idle,
				}),
			]),
			Object.freeze([]),
			Object.freeze([]),
			createHealthState(),
		);

		assert.strictEqual(swarms.length, 2);

		const completedAdHocSwarm = swarms.find(swarm => swarm.swarmId === 'TASK-ROOT-A');
		const planningObjectiveSwarm = swarms.find(swarm => swarm.swarmId === 'TASK-ROOT-B');
		assert.ok(completedAdHocSwarm);
		assert.ok(planningObjectiveSwarm);

		assert.strictEqual(completedAdHocSwarm!.swarmId, 'TASK-ROOT-A');
		assert.strictEqual(completedAdHocSwarm!.objectiveId, undefined);
		assert.deepStrictEqual(completedAdHocSwarm!.taskIds, ['TASK-ROOT-A', 'TASK-A-CHILD']);
		assert.strictEqual(completedAdHocSwarm!.phase, 'completed');
		assert.strictEqual(completedAdHocSwarm!.attentionLevel, 0);

		assert.strictEqual(planningObjectiveSwarm!.swarmId, 'TASK-ROOT-B');
		assert.strictEqual(planningObjectiveSwarm!.objectiveId, 'OBJ-B');
		assert.deepStrictEqual(planningObjectiveSwarm!.taskIds, ['TASK-ROOT-B']);
		assert.strictEqual(planningObjectiveSwarm!.phase, 'planning');
		assert.strictEqual(planningObjectiveSwarm!.attentionLevel, 2);
	});

	test('propagates review-needed, merge-blocked, and failed summaries without inventing cross-swarm state', () => {
		const swarms = deriveSwarms(
			[
				createTaskTree('TASK-ROOT-REVIEW', 'OBJ-REVIEW', [
					createTaskTreeNode('TASK-ROOT-REVIEW', undefined, 0),
				]),
				createTaskTree('TASK-ROOT-MERGE', undefined, [
					createTaskTreeNode('TASK-ROOT-MERGE', undefined, 0),
				]),
				createTaskTree('TASK-ROOT-FAIL', undefined, [
					createTaskTreeNode('TASK-ROOT-FAIL', undefined, 0),
					createTaskTreeNode('TASK-FAIL-CHILD', 'TASK-ROOT-FAIL', 1),
				]),
			],
			[
				createTaskState({
					taskId: 'TASK-ROOT-REVIEW',
					objectiveId: 'OBJ-REVIEW',
					status: TaskStatus.Completed,
					enqueuedAt: 100,
					completedAt: 150,
				}),
				createTaskState({
					taskId: 'TASK-ROOT-MERGE',
					status: TaskStatus.Completed,
					enqueuedAt: 200,
					completedAt: 260,
				}),
				createTaskState({
					taskId: 'TASK-ROOT-FAIL',
					status: TaskStatus.Executing,
					enqueuedAt: 300,
					startedAt: 320,
				}),
				createTaskState({
					taskId: 'TASK-FAIL-CHILD',
					parentTaskId: 'TASK-ROOT-FAIL',
					roleId: 'worker',
					status: TaskStatus.Failed,
					enqueuedAt: 330,
					completedAt: 360,
				}),
			],
			[
				createObjectiveState({
					objectiveId: 'OBJ-REVIEW',
					rootTaskId: 'TASK-ROOT-REVIEW',
					status: ObjectiveStatus.Reviewing,
				}),
			],
			createFleetState(Object.freeze([])),
			[
				createReviewGateState({
					dispatchId: 'disp-review',
					taskId: 'TASK-ROOT-REVIEW',
					reviewState: WireReviewState.AwaitingReview,
					integrationState: WireIntegrationState.NotReady,
				}),
			],
			[
				createMergeEntryState({
					dispatchId: 'disp-merge',
					taskId: 'TASK-ROOT-MERGE',
					status: MergeExecutionStatus.MergeBlocked,
					blockedReason: 'conflict',
				}),
			],
			createHealthState({
				mode: PoolMode.DiskPressure,
			}),
		);

		const reviewSwarm = swarms.find(swarm => swarm.swarmId === 'TASK-ROOT-REVIEW');
		const mergeSwarm = swarms.find(swarm => swarm.swarmId === 'TASK-ROOT-MERGE');
		const failedSwarm = swarms.find(swarm => swarm.swarmId === 'TASK-ROOT-FAIL');
		assert.ok(reviewSwarm);
		assert.ok(mergeSwarm);
		assert.ok(failedSwarm);

		assert.strictEqual(reviewSwarm!.phase, 'reviewing');
		assert.strictEqual(reviewSwarm!.reviewNeeded, true);
		assert.deepStrictEqual(reviewSwarm!.reviewDispatchIds, ['disp-review']);
		assert.strictEqual(reviewSwarm!.attentionLevel, 3);

		assert.strictEqual(mergeSwarm!.phase, 'failed');
		assert.strictEqual(mergeSwarm!.mergeBlocked, true);
		assert.deepStrictEqual(mergeSwarm!.mergeDispatchIds, ['disp-merge']);
		assert.strictEqual(mergeSwarm!.attentionLevel, 4);

		assert.strictEqual(failedSwarm!.phase, 'failed');
		assert.strictEqual(failedSwarm!.hasFailures, true);
		assert.strictEqual(failedSwarm!.attentionLevel, 4);
	});

	test('omits objective metadata on ambiguous linkage instead of guessing swarm identity', () => {
		const swarms = deriveSwarms(
			[
				createTaskTree('TASK-ROOT-1', 'OBJ-TREE', [
					createTaskTreeNode('TASK-ROOT-1', undefined, 0),
				]),
			],
			[
				createTaskState({
					taskId: 'TASK-ROOT-1',
					objectiveId: 'OBJ-TASK',
					status: TaskStatus.Queued,
					enqueuedAt: 100,
				}),
			],
			[
				createObjectiveState({
					objectiveId: 'OBJ-TREE',
					rootTaskId: 'TASK-ROOT-1',
				}),
			],
			createFleetState(Object.freeze([])),
			Object.freeze([]),
			Object.freeze([]),
			createHealthState(),
		);

		assert.strictEqual(swarms.length, 1);
		assert.strictEqual(swarms[0].swarmId, 'TASK-ROOT-1');
		assert.strictEqual(swarms[0].objectiveId, undefined);
		assert.strictEqual(swarms[0].objectiveStatus, undefined);
		assert.strictEqual(swarms[0].objectiveProblemStatement, undefined);
		assert.strictEqual(swarms[0].costCeiling, undefined);
	});
});

function createTaskTree(
	rootTaskId: string,
	objectiveId: string | undefined,
	nodes: readonly IHarnessTaskTree['nodes'][number][],
): IHarnessTaskTree {
	return {
		rootTaskId,
		objectiveId,
		nodes: Object.freeze(nodes.slice()),
	};
}

function createTaskTreeNode(
	taskId: string,
	parentTaskId: string | undefined,
	depth: number,
): IHarnessTaskTree['nodes'][number] {
	return {
		taskId,
		parentTaskId,
		depth,
		status: depth === 0 ? 'running' : 'pending',
		aggregationStrategy: undefined,
		dispatchId: undefined,
		roleId: undefined,
		priority: undefined,
		handoffType: undefined,
		createdAt: 1,
		completedAt: undefined,
	};
}

function createTaskState(overrides: Partial<AtlasModel.ITaskState> & { readonly taskId: string }): AtlasModel.ITaskState {
	const { taskId, ...rest } = overrides;
	return {
		taskId,
		dispatchId: undefined,
		parentTaskId: undefined,
		objectiveId: undefined,
		roleId: 'planner',
		fromRole: undefined,
		toRole: undefined,
		summary: '',
		handoffType: undefined,
		status: TaskStatus.Queued,
		priority: 1,
		acceptance: Object.freeze([]),
		constraints: Object.freeze([]),
		artifacts: Object.freeze([]),
		memoryKeywords: Object.freeze([]),
		contextPaths: Object.freeze([]),
		dependsOn: Object.freeze([]),
		assignedAgentId: undefined,
		costSpent: 0,
		attentionLevel: 1,
		enqueuedAt: 1,
		startedAt: undefined,
		completedAt: undefined,
		...rest,
	};
}

function createObjectiveState(overrides: Partial<AtlasModel.IObjectiveState> & { readonly objectiveId: string; readonly rootTaskId: string }): AtlasModel.IObjectiveState {
	const { objectiveId, rootTaskId, ...rest } = overrides;
	return {
		objectiveId,
		problemStatement: 'Objective',
		playbookIds: Object.freeze([]),
		desiredOutcomes: Object.freeze([]),
		constraints: Object.freeze([]),
		contextPaths: Object.freeze([]),
		successCriteria: Object.freeze([]),
		operatorNotes: Object.freeze([]),
		priority: WireDispatchPriority.P1,
		status: ObjectiveStatus.Open,
		rootTaskId,
		resumeCount: 0,
		maxResumeCycles: 0,
		maxParallelWorkers: undefined,
		costSpent: 0,
		costCeiling: undefined,
		attentionLevel: 1,
		createdAt: 1,
		updatedAt: 1,
		completedAt: undefined,
		...rest,
	};
}

function createAgentState(overrides: Partial<AtlasModel.IAgentState> & { readonly dispatchId: string; readonly taskId: string }): AtlasModel.IAgentState {
	const { dispatchId, taskId, ...rest } = overrides;
	return {
		dispatchId,
		taskId,
		roleId: 'planner',
		status: AgentStatus.Idle,
		worktreePath: undefined,
		pid: undefined,
		startedAt: 1,
		lastHeartbeat: 1,
		role: AgentRole.Planner,
		costSpent: 0,
		lastActivity: undefined,
		timeInState: 0,
		attentionLevel: 1,
		...rest,
	};
}

function createReviewGateState(overrides: Partial<AtlasModel.IReviewGateState> & { readonly dispatchId: string; readonly taskId: string }): AtlasModel.IReviewGateState {
	const { dispatchId, taskId, ...rest } = overrides;
	return {
		dispatchId,
		taskId,
		roleId: 'judge',
		candidateBranch: 'feature/test',
		baseRef: 'main',
		baseHeadSha: 'aaaa',
		mergeBaseSha: 'bbbb',
		reviewedHeadSha: 'cccc',
		commitShas: Object.freeze(['cccc']),
		workingTreeClean: true,
		reviewState: WireReviewState.ReviewGo,
		judgeDecision: undefined,
		reviewedByRole: undefined,
		reviewedAt: undefined,
		promotionState: WirePromotionState.NotRequested,
		promotionAuthorizedAt: undefined,
		promotionAuthorizedByRole: undefined,
		integrationState: WireIntegrationState.NotReady,
		mergedSha: undefined,
		mergeExecutorId: undefined,
		stateReason: undefined,
		attentionLevel: 1,
		createdAt: 1,
		updatedAt: 1,
		...rest,
	};
}

function createMergeEntryState(overrides: Partial<AtlasModel.IMergeEntry> & { readonly dispatchId: string; readonly taskId: string }): AtlasModel.IMergeEntry {
	const { dispatchId, taskId, ...rest } = overrides;
	return {
		dispatchId,
		taskId,
		worktreePath: '/tmp/worktree',
		candidateBranch: 'feature/test',
		baseRef: 'main',
		baseHeadSha: 'aaaa',
		mergeBaseSha: 'bbbb',
		reviewedHeadSha: 'cccc',
		priority: 1,
		status: MergeExecutionStatus.Pending,
		mergeSha: undefined,
		conflictDetails: undefined,
		affectedPaths: undefined,
		judgeDecision: undefined,
		reviewedByRole: undefined,
		reviewedAt: undefined,
		promotionAuthorizedAt: undefined,
		promotionAuthorizedByRole: undefined,
		mergeExecutorId: undefined,
		mergedAt: undefined,
		blockedReason: undefined,
		attentionLevel: 1,
		enqueuedAt: 1,
		...rest,
	};
}

function createFleetState(agents: readonly AtlasModel.IAgentState[]): AtlasModel.IFleetState {
	let activeCount = 0;
	let idleCount = 0;
	let blockedCount = 0;
	let failedCount = 0;
	let totalCostSpent = 0;
	let attentionLevel: AtlasModel.IFleetState['attentionLevel'] = 1;

	for (const agent of agents) {
		if (agent.status === 'spawning' || agent.status === 'running') {
			activeCount += 1;
		} else if (agent.status === 'idle') {
			idleCount += 1;
		} else if (agent.status === 'blocked') {
			blockedCount += 1;
		} else if (agent.status === 'failed' || agent.status === 'timed_out') {
			failedCount += 1;
		}
		totalCostSpent += agent.costSpent;
		attentionLevel = Math.max(attentionLevel, agent.attentionLevel) as AtlasModel.IFleetState['attentionLevel'];
	}

	return {
		agents: Object.freeze(agents.slice()),
		activeCount,
		idleCount,
		blockedCount,
		failedCount,
		totalCostSpent,
		attentionLevel,
	};
}

function createHealthState(overrides: Partial<AtlasModel.IHealthState> = {}): AtlasModel.IHealthState {
	return {
		mode: PoolMode.Normal,
		diskUsagePct: 10,
		memoryUsagePct: 10,
		walSizeBytes: 1024,
		activeWorkers: 0,
		queueDepth: 0,
		attentionLevel: 1,
		lastHealthCheck: 1,
		...overrides,
	};
}
