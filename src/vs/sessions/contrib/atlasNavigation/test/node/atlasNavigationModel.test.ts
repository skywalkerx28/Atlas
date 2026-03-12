/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-layering, local/code-import-patterns -- Node-side Phase 4 tests intentionally exercise the sessions navigation model directly. */

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AgentRole, AgentStatus, type IAgentState, type IFleetState } from '../../../../common/model/agent.js';
import { AttentionLevel } from '../../../../common/model/attention.js';
import { PoolMode, type IHealthState } from '../../../../common/model/health.js';
import { ObjectiveStatus, type IObjectiveState } from '../../../../common/model/objective.js';
import { MergeExecutionStatus, type IMergeEntry, type IReviewGateState } from '../../../../common/model/review.js';
import { EntityKind, NavigationSection, ReviewTargetKind, type INavigationSelection } from '../../../../common/model/selection.js';
import { SwarmPhase, type ISwarmState } from '../../../../common/model/swarm.js';
import { TaskStatus, type ITaskState } from '../../../../common/model/task.js';
import { ReviewDecision, WireDispatchPriority, WireIntegrationState, WirePromotionState, WireReviewState } from '../../../../common/model/wire.js';
import { HarnessConnectionState, type IHarnessConnectionInfo } from '../../../../services/harness/common/harnessService.js';
import {
	buildAtlasShellModel,
	buildReviewNavigationItems,
	buildSectionDescriptors,
	buildTaskNavigationItems,
} from '../../browser/atlasNavigationModel.js';

suite('AtlasNavigationModel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('builds the shipped phase 4 sections in swarm-first order', () => {
		const sections = buildSectionDescriptors(
			createConnectionState(),
			[
				createSwarmState({ swarmId: 'TASK-ROOT-1', rootTaskId: 'TASK-ROOT-1', attentionLevel: AttentionLevel.Critical }),
				createSwarmState({ swarmId: 'TASK-ROOT-2', rootTaskId: 'TASK-ROOT-2', attentionLevel: AttentionLevel.Active }),
			],
			createFleetState([
				createAgentState({ dispatchId: 'disp-1', taskId: 'TASK-ROOT-1', attentionLevel: AttentionLevel.NeedsAction }),
				createAgentState({ dispatchId: 'disp-2', taskId: 'TASK-ROOT-2', attentionLevel: AttentionLevel.Idle, status: AgentStatus.Idle }),
			]),
			[
				createReviewGateState({
					dispatchId: 'disp-gate-1',
					taskId: 'TASK-ROOT-1',
					reviewState: WireReviewState.AwaitingReview,
					attentionLevel: AttentionLevel.NeedsAction,
				}),
			],
			[
				createMergeEntry({
					dispatchId: 'disp-merge-1',
					taskId: 'TASK-ROOT-1',
					status: MergeExecutionStatus.Pending,
					attentionLevel: AttentionLevel.Active,
				}),
			],
		);

		assert.deepStrictEqual(
			sections.map(section => ({ section: section.section, count: section.count })),
			[
				{ section: NavigationSection.Tasks, count: 2 },
				{ section: NavigationSection.Agents, count: 2 },
				{ section: NavigationSection.Reviews, count: 2 },
				{ section: NavigationSection.Fleet, count: 1 },
			],
		);
		assert.strictEqual(sections[0].attentionLevel, AttentionLevel.Critical);
		assert.strictEqual(sections[1].attentionLevel, AttentionLevel.NeedsAction);
		assert.strictEqual(sections[2].attentionLevel, AttentionLevel.NeedsAction);
		assert.strictEqual(sections[3].attentionLevel, AttentionLevel.NeedsAction);
	});

	test('keeps tasks swarm-rooted and treats objective metadata as secondary decoration', () => {
		const selection: INavigationSelection = {
			section: NavigationSection.Tasks,
			entity: { kind: EntityKind.Task, id: 'TASK-CHILD-1' },
		};
		const state = createAtlasStateSnapshot({
			swarms: [
				createSwarmState({
					swarmId: 'TASK-ROOT-1',
					rootTaskId: 'TASK-ROOT-1',
					objectiveId: 'OBJ-1',
					objectiveProblemStatement: 'Ship the navigation shell',
					taskIds: Object.freeze(['TASK-ROOT-1', 'TASK-CHILD-1']),
					agentDispatchIds: Object.freeze(['disp-root']),
					phase: SwarmPhase.Executing,
				}),
			],
			tasks: [
				createTaskState({
					taskId: 'TASK-ROOT-1',
					dispatchId: 'disp-root',
					summary: 'Root planner task',
					status: TaskStatus.Executing,
					enqueuedAt: 100,
				}),
				createTaskState({
					taskId: 'TASK-CHILD-1',
					parentTaskId: 'TASK-ROOT-1',
					dispatchId: 'disp-child',
					summary: 'Child implementation task',
					status: TaskStatus.Queued,
					enqueuedAt: 150,
				}),
			],
			objectives: [
				createObjectiveState({
					objectiveId: 'OBJ-1',
					rootTaskId: 'TASK-ROOT-1',
					problemStatement: 'Ship the navigation shell',
				}),
			],
		});

		const items = buildTaskNavigationItems(state.swarms);
		assert.deepStrictEqual(items.map(item => ({ title: item.title, subtitle: item.subtitle })), [
			{ title: 'Ship the navigation shell', subtitle: 'TASK-ROOT-1' },
		]);

		const model = buildAtlasShellModel(selection, state);
		assert.strictEqual(model.section, NavigationSection.Tasks);
		assert.strictEqual(model.title, 'Ship the navigation shell');
		assert.strictEqual(model.subtitle, 'Root task TASK-ROOT-1');
		assert.deepStrictEqual(model.items.map(item => item.id), ['TASK-ROOT-1', 'TASK-CHILD-1']);
		assert.strictEqual(model.items[0].label, 'Root planner task');
		assert.strictEqual(model.items[1].label, 'Child implementation task');
	});

	test('renders reviews from authoritative gate and merge surfaces only', () => {
		const swarms = [
			createSwarmState({
				swarmId: 'TASK-ROOT-1',
				rootTaskId: 'TASK-ROOT-1',
				taskIds: Object.freeze(['TASK-ROOT-1']),
			}),
		];
		const gates = [
			createReviewGateState({
				dispatchId: 'disp-gate-1',
				taskId: 'TASK-ROOT-1',
				reviewState: WireReviewState.AwaitingReview,
				attentionLevel: AttentionLevel.NeedsAction,
			}),
		];
		const merges = [
			createMergeEntry({
				dispatchId: 'disp-merge-1',
				taskId: 'TASK-ROOT-1',
				status: MergeExecutionStatus.Pending,
				attentionLevel: AttentionLevel.Active,
			}),
		];

		const items = buildReviewNavigationItems(gates, merges, swarms);
		assert.deepStrictEqual(items.map(item => ({ id: item.id, dispatchId: item.dispatchId, kind: item.kind, swarmId: item.swarmId })), [
			{ id: 'gate:disp-gate-1', dispatchId: 'disp-gate-1', kind: ReviewTargetKind.Gate, swarmId: 'TASK-ROOT-1' },
			{ id: 'merge:disp-merge-1', dispatchId: 'disp-merge-1', kind: ReviewTargetKind.Merge, swarmId: 'TASK-ROOT-1' },
		]);

		const model = buildAtlasShellModel(
			{ section: NavigationSection.Reviews, entity: undefined },
			createAtlasStateSnapshot({
				swarms,
				reviewGates: gates,
				mergeQueue: merges,
			}),
		);
		assert.strictEqual(model.section, NavigationSection.Reviews);
		assert.strictEqual(model.title, 'Reviews');
		assert.deepStrictEqual(model.stats.map(item => item.value), ['1', '0', '1']);
		assert.deepStrictEqual(model.items.map(item => item.id), ['gate:disp-gate-1', 'merge:disp-merge-1']);
	});

	test('keeps gate and merge review selections distinct when they share a dispatch id', () => {
		const dispatchId = 'disp-shared-1';
		const swarms = [
			createSwarmState({
				swarmId: 'TASK-ROOT-1',
				rootTaskId: 'TASK-ROOT-1',
				taskIds: Object.freeze(['TASK-ROOT-1']),
			}),
		];
		const gates = [
			createReviewGateState({
				dispatchId,
				taskId: 'TASK-ROOT-1',
				roleId: 'gate-reviewer',
				reviewState: WireReviewState.AwaitingReview,
				attentionLevel: AttentionLevel.NeedsAction,
			}),
		];
		const merges = [
			createMergeEntry({
				dispatchId,
				taskId: 'TASK-ROOT-1',
				candidateBranch: 'feature/shared-dispatch',
				worktreePath: '/workspace/feature/shared-dispatch',
				status: MergeExecutionStatus.Pending,
				attentionLevel: AttentionLevel.Active,
			}),
		];

		const items = buildReviewNavigationItems(gates, merges, swarms);
		assert.deepStrictEqual(items.map(item => item.id).sort(), ['gate:disp-shared-1', 'merge:disp-shared-1']);

		const gateModel = buildAtlasShellModel(
			{ section: NavigationSection.Reviews, entity: { kind: EntityKind.Review, id: dispatchId, reviewTargetKind: ReviewTargetKind.Gate } },
			createAtlasStateSnapshot({ swarms, reviewGates: gates, mergeQueue: merges }),
		);
		const mergeModel = buildAtlasShellModel(
			{ section: NavigationSection.Reviews, entity: { kind: EntityKind.Review, id: dispatchId, reviewTargetKind: ReviewTargetKind.Merge } },
			createAtlasStateSnapshot({ swarms, reviewGates: gates, mergeQueue: merges }),
		);

		assert.strictEqual(gateModel.title, 'gate-reviewer');
		assert.strictEqual(gateModel.subtitle, `Review gate for dispatch ${dispatchId}`);
		assert.strictEqual(mergeModel.title, 'shared-dispatch');
		assert.strictEqual(mergeModel.subtitle, `Merge lane for dispatch ${dispatchId}`);
		assert.deepStrictEqual(gateModel.items.map(item => item.id), ['gate:disp-shared-1', 'merge:disp-shared-1']);
		assert.deepStrictEqual(mergeModel.items.map(item => item.id), ['gate:disp-shared-1', 'merge:disp-shared-1']);
	});
});

function createAtlasStateSnapshot(overrides: Partial<{
	connection: IHarnessConnectionInfo;
	swarms: readonly ISwarmState[];
	tasks: readonly ITaskState[];
	objectives: readonly IObjectiveState[];
	fleet: IFleetState;
	health: IHealthState;
	reviewGates: readonly IReviewGateState[];
	mergeQueue: readonly IMergeEntry[];
}> = {}) {
	return {
		connection: overrides.connection ?? createConnectionState(),
		swarms: overrides.swarms ?? Object.freeze([]),
		tasks: overrides.tasks ?? Object.freeze([]),
		objectives: overrides.objectives ?? Object.freeze([]),
		fleet: overrides.fleet ?? createFleetState([]),
		health: overrides.health ?? createHealthState(),
		reviewGates: overrides.reviewGates ?? Object.freeze([]),
		mergeQueue: overrides.mergeQueue ?? Object.freeze([]),
	};
}

function createConnectionState(overrides: Partial<IHarnessConnectionInfo> = {}): IHarnessConnectionInfo {
	return {
		state: HarnessConnectionState.Connected,
		mode: 'daemon',
		writesEnabled: false,
		daemonVersion: '0.1.0-test',
		schemaVersion: '2026-03-01',
		grantedCapabilities: Object.freeze(['read']),
		errorMessage: undefined,
		...overrides,
	};
}

function createSwarmState(overrides: Partial<ISwarmState> = {}): ISwarmState {
	return {
		swarmId: 'TASK-ROOT-1',
		rootTaskId: 'TASK-ROOT-1',
		objectiveId: undefined,
		objectiveStatus: undefined,
		objectiveProblemStatement: undefined,
		rootTaskStatus: TaskStatus.Executing,
		phase: SwarmPhase.Executing,
		taskIds: Object.freeze(['TASK-ROOT-1']),
		agentDispatchIds: Object.freeze([]),
		worktreePaths: Object.freeze([]),
		reviewDispatchIds: Object.freeze([]),
		mergeDispatchIds: Object.freeze([]),
		reviewNeeded: false,
		mergeBlocked: false,
		hasFailures: false,
		hasBlockedTasks: false,
		memoryRecordCount: 0,
		costSpent: 0,
		costCeiling: undefined,
		attentionLevel: AttentionLevel.Active,
		createdAt: 100,
		updatedAt: 200,
		...overrides,
	};
}

function createTaskState(overrides: Partial<ITaskState> = {}): ITaskState {
	return {
		taskId: 'TASK-ROOT-1',
		dispatchId: 'disp-root',
		parentTaskId: undefined,
		objectiveId: undefined,
		roleId: 'planner',
		fromRole: undefined,
		toRole: undefined,
		summary: 'Task summary',
		handoffType: undefined,
		status: TaskStatus.Executing,
		priority: 1,
		acceptance: Object.freeze([]),
		constraints: Object.freeze([]),
		artifacts: Object.freeze([]),
		memoryKeywords: Object.freeze([]),
		contextPaths: Object.freeze([]),
		dependsOn: Object.freeze([]),
		assignedAgentId: undefined,
		costSpent: 0,
		attentionLevel: AttentionLevel.Active,
		enqueuedAt: 100,
		startedAt: 125,
		completedAt: undefined,
		...overrides,
	};
}

function createObjectiveState(overrides: Partial<IObjectiveState> = {}): IObjectiveState {
	return {
		objectiveId: 'OBJ-1',
		problemStatement: 'Ship the shell',
		playbookIds: Object.freeze([]),
		desiredOutcomes: Object.freeze([]),
		constraints: Object.freeze([]),
		contextPaths: Object.freeze([]),
		successCriteria: Object.freeze([]),
		operatorNotes: Object.freeze([]),
		priority: WireDispatchPriority.P1,
		status: ObjectiveStatus.Executing,
		rootTaskId: 'TASK-ROOT-1',
		resumeCount: 0,
		maxResumeCycles: 0,
		maxParallelWorkers: undefined,
		costSpent: 0,
		costCeiling: undefined,
		attentionLevel: AttentionLevel.Active,
		createdAt: 100,
		updatedAt: 200,
		completedAt: undefined,
		...overrides,
	};
}

function createAgentState(overrides: Partial<IAgentState> = {}): IAgentState {
	return {
		dispatchId: 'disp-root',
		taskId: 'TASK-ROOT-1',
		roleId: 'planner',
		status: AgentStatus.Running,
		worktreePath: undefined,
		pid: undefined,
		startedAt: 100,
		lastHeartbeat: 200,
		role: AgentRole.Planner,
		costSpent: 0,
		lastActivity: 'Executing rooted work',
		timeInState: 100,
		attentionLevel: AttentionLevel.Active,
		...overrides,
	};
}

function createFleetState(agents: readonly IAgentState[], overrides: Partial<IFleetState> = {}): IFleetState {
	return {
		agents,
		activeCount: agents.filter(agent => agent.status === AgentStatus.Running || agent.status === AgentStatus.Spawning).length,
		idleCount: agents.filter(agent => agent.status === AgentStatus.Idle).length,
		blockedCount: agents.filter(agent => agent.status === AgentStatus.Blocked).length,
		failedCount: agents.filter(agent => agent.status === AgentStatus.Failed || agent.status === AgentStatus.TimedOut).length,
		totalCostSpent: agents.reduce((total, agent) => total + agent.costSpent, 0),
		attentionLevel: agents.some(agent => agent.attentionLevel === AttentionLevel.Critical)
			? AttentionLevel.Critical
			: agents.some(agent => agent.attentionLevel === AttentionLevel.NeedsAction)
				? AttentionLevel.NeedsAction
				: agents.some(agent => agent.attentionLevel === AttentionLevel.Active)
					? AttentionLevel.Active
					: AttentionLevel.Idle,
		...overrides,
	};
}

function createHealthState(overrides: Partial<IHealthState> = {}): IHealthState {
	return {
		mode: PoolMode.Normal,
		diskUsagePct: 10,
		memoryUsagePct: 20,
		walSizeBytes: 512,
		activeWorkers: 1,
		queueDepth: 0,
		attentionLevel: AttentionLevel.Idle,
		lastHealthCheck: 200,
		...overrides,
	};
}

function createReviewGateState(overrides: Partial<IReviewGateState> = {}): IReviewGateState {
	return {
		dispatchId: 'disp-gate-1',
		taskId: 'TASK-ROOT-1',
		roleId: 'judge',
		candidateBranch: 'agent/feature',
		baseRef: 'main',
		baseHeadSha: 'base',
		mergeBaseSha: 'merge-base',
		reviewedHeadSha: 'head',
		commitShas: Object.freeze(['head']),
		workingTreeClean: true,
		reviewState: WireReviewState.AwaitingReview,
		judgeDecision: ReviewDecision.Go,
		reviewedByRole: undefined,
		reviewedAt: undefined,
		promotionState: WirePromotionState.NotRequested,
		promotionAuthorizedAt: undefined,
		promotionAuthorizedByRole: undefined,
		integrationState: WireIntegrationState.NotReady,
		mergedSha: undefined,
		mergeExecutorId: undefined,
		stateReason: undefined,
		attentionLevel: AttentionLevel.NeedsAction,
		createdAt: 100,
		updatedAt: 200,
		...overrides,
	};
}

function createMergeEntry(overrides: Partial<IMergeEntry> = {}): IMergeEntry {
	return {
		dispatchId: 'disp-merge-1',
		taskId: 'TASK-ROOT-1',
		worktreePath: '/tmp/atlas/worktrees/disp-merge-1',
		candidateBranch: 'agent/feature',
		baseRef: 'main',
		baseHeadSha: 'base',
		mergeBaseSha: 'merge-base',
		reviewedHeadSha: 'head',
		priority: 0,
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
		attentionLevel: AttentionLevel.Active,
		enqueuedAt: 200,
		...overrides,
	};
}
