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
	buildAgentsWorkspaceModel,
	buildAtlasShellModel,
	buildFleetCommandModel,
	buildReviewNavigationItems,
	buildReviewWorkspaceModel,
	buildSectionDescriptors,
	buildTaskNavigationItems,
	buildTasksWorkspaceModel,
} from '../../browser/atlasNavigationModel.js';
import { ReviewWorkspaceActionId } from '../../browser/atlasReviewWorkspaceActions.js';

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

	test('builds an actionable review workspace with distinct gate and merge targets', () => {
		const dispatchId = 'disp-review-1';
		const state = createAtlasStateSnapshot({
			connection: createConnectionState({
				writesEnabled: true,
				supportedWriteMethods: Object.freeze([
					'review.gate_verdict',
					'review.authorize_promotion',
					'review.enqueue_merge',
				]),
				grantedCapabilities: Object.freeze(['read', 'review', 'merge']),
			}),
			swarms: [
				createSwarmState({
					swarmId: 'TASK-ROOT-1',
					rootTaskId: 'TASK-ROOT-1',
					taskIds: Object.freeze(['TASK-ROOT-1']),
				}),
			],
			fleet: createFleetState([
				createAgentState({
					dispatchId,
					taskId: 'TASK-ROOT-1',
				}),
			]),
			reviewGates: [
				createReviewGateState({
					dispatchId,
					taskId: 'TASK-ROOT-1',
					roleId: 'axiom-judge',
					reviewState: WireReviewState.ReviewGo,
					promotionState: WirePromotionState.NotRequested,
					integrationState: WireIntegrationState.NotReady,
					attentionLevel: AttentionLevel.Active,
				}),
			],
			mergeQueue: [
				createMergeEntry({
					dispatchId,
					taskId: 'TASK-ROOT-1',
					worktreePath: '/workspace/review-disp-1',
					candidateBranch: 'agent/review-disp-1',
					status: MergeExecutionStatus.Pending,
					attentionLevel: AttentionLevel.Active,
				}),
			],
		});

		const gateModel = buildReviewWorkspaceModel(
			{ section: NavigationSection.Reviews, entity: { kind: EntityKind.Review, id: dispatchId, reviewTargetKind: ReviewTargetKind.Gate } },
			state,
		);
		const mergeModel = buildReviewWorkspaceModel(
			{ section: NavigationSection.Reviews, entity: { kind: EntityKind.Review, id: dispatchId, reviewTargetKind: ReviewTargetKind.Merge } },
			state,
		);

		assert.strictEqual(gateModel.title, 'axiom-judge');
		assert.strictEqual(gateModel.subtitle, `Review gate for dispatch ${dispatchId}`);
		assert.strictEqual(mergeModel.title, 'review-disp-1');
		assert.strictEqual(mergeModel.subtitle, `Merge lane for dispatch ${dispatchId}`);
		assert.deepStrictEqual(gateModel.entries.map(entry => ({ id: entry.id, selected: entry.selected })), [
			{ id: `gate:${dispatchId}`, selected: true },
			{ id: `merge:${dispatchId}`, selected: false },
		]);
		assert.deepStrictEqual(mergeModel.entries.map(entry => ({ id: entry.id, selected: entry.selected })), [
			{ id: `gate:${dispatchId}`, selected: false },
			{ id: `merge:${dispatchId}`, selected: true },
		]);
		assert.deepStrictEqual(gateModel.links.map(link => link.label), ['Open swarm', 'Open task', 'Open agent']);
		assert.strictEqual(gateModel.actions.find(action => action.id === ReviewWorkspaceActionId.AuthorizePromotion)?.enabled, true);
		assert.strictEqual(gateModel.actions.find(action => action.id === ReviewWorkspaceActionId.RecordGo)?.enabled, false);
		assert.strictEqual(gateModel.actions.find(action => action.id === ReviewWorkspaceActionId.EnqueueMerge)?.enabled, false);
		assert.strictEqual(mergeModel.actions.find(action => action.id === ReviewWorkspaceActionId.RecordGo)?.enabled, false);
		assert.strictEqual(mergeModel.actions.find(action => action.id === ReviewWorkspaceActionId.RecordGo)?.disabledReason, 'Select a review gate target to record a verdict.');
		assert.strictEqual(mergeModel.actions.find(action => action.id === ReviewWorkspaceActionId.RecordNoGo)?.enabled, false);
		assert.strictEqual(mergeModel.actions.find(action => action.id === ReviewWorkspaceActionId.AuthorizePromotion)?.enabled, false);
		assert.strictEqual(mergeModel.actions.find(action => action.id === ReviewWorkspaceActionId.AuthorizePromotion)?.disabledReason, 'Select a review gate target to authorize promotion.');
	});

	test('gates review workspace actions on supportedWriteMethods instead of writesEnabled alone', () => {
		const dispatchId = 'disp-review-2';
		const state = createAtlasStateSnapshot({
			connection: createConnectionState({
				writesEnabled: true,
				supportedWriteMethods: Object.freeze(['review.gate_verdict']),
				grantedCapabilities: Object.freeze(['read', 'review']),
			}),
			reviewGates: [
				createReviewGateState({
					dispatchId,
					reviewState: WireReviewState.AwaitingReview,
					promotionState: WirePromotionState.NotRequested,
				}),
			],
		});

		const model = buildReviewWorkspaceModel(
			{ section: NavigationSection.Reviews, entity: { kind: EntityKind.Review, id: dispatchId, reviewTargetKind: ReviewTargetKind.Gate } },
			state,
		);

		assert.strictEqual(model.actions.find(action => action.id === ReviewWorkspaceActionId.RecordGo)?.enabled, true);
		assert.strictEqual(model.actions.find(action => action.id === ReviewWorkspaceActionId.RecordNoGo)?.enabled, true);
		assert.strictEqual(model.actions.find(action => action.id === ReviewWorkspaceActionId.AuthorizePromotion)?.enabled, false);
		assert.strictEqual(model.actions.find(action => action.id === ReviewWorkspaceActionId.AuthorizePromotion)?.disabledReason, 'Current harness daemon does not grant merge capability for review.authorize_promotion.');
		assert.strictEqual(model.actions.find(action => action.id === ReviewWorkspaceActionId.EnqueueMerge)?.enabled, false);
	});

	test('keeps review workspace read-only in polling mode', () => {
		const model = buildReviewWorkspaceModel(
			{ section: NavigationSection.Reviews, entity: { kind: EntityKind.Review, id: 'disp-review-3', reviewTargetKind: ReviewTargetKind.Gate } },
			createAtlasStateSnapshot({
				connection: createConnectionState({
					state: HarnessConnectionState.Connected,
					mode: 'polling',
					writesEnabled: false,
					supportedWriteMethods: Object.freeze([]),
				}),
				reviewGates: [
					createReviewGateState({
						dispatchId: 'disp-review-3',
						reviewState: WireReviewState.AwaitingReview,
					}),
				],
			}),
		);

		assert.ok(model.readOnlyMessage);
		assert.strictEqual(model.actions.every(action => action.enabled === false), true);
		assert.strictEqual(model.actions.every(action => action.disabledReason === 'Harness daemon required; Atlas is in read-only mode.'), true);
	});

	test('shows a review-specific read-only notice when the daemon only exposes unrelated writes', () => {
		const model = buildReviewWorkspaceModel(
			{ section: NavigationSection.Reviews, entity: { kind: EntityKind.Review, id: 'disp-review-4', reviewTargetKind: ReviewTargetKind.Gate } },
			createAtlasStateSnapshot({
				connection: createConnectionState({
					writesEnabled: true,
					supportedWriteMethods: Object.freeze(['dispatch.submit']),
					grantedCapabilities: Object.freeze(['read', 'dispatch']),
				}),
				reviewGates: [
					createReviewGateState({
						dispatchId: 'disp-review-4',
						reviewState: WireReviewState.AwaitingReview,
					}),
				],
			}),
		);

		assert.strictEqual(model.readOnlyMessage, 'The current daemon connection does not advertise review or merge write methods for this workspace.');
		assert.strictEqual(model.actions.every(action => action.enabled === false), true);
	});

	test('builds the phase 5 fleet command surface from live fleet, health, and review pressure', () => {
		const now = 1_000_000;
		const runningDispatchId = 'disp-running-1';
		const state = createAtlasStateSnapshot({
			connection: createConnectionState(),
			swarms: [
				createSwarmState({
					swarmId: 'TASK-ROOT-1',
					rootTaskId: 'TASK-ROOT-1',
					taskIds: Object.freeze(['TASK-ROOT-1']),
					attentionLevel: AttentionLevel.Critical,
				}),
				createSwarmState({
					swarmId: 'TASK-ROOT-2',
					rootTaskId: 'TASK-ROOT-2',
					taskIds: Object.freeze(['TASK-ROOT-2']),
					attentionLevel: AttentionLevel.NeedsAction,
				}),
				createSwarmState({
					swarmId: 'TASK-ROOT-3',
					rootTaskId: 'TASK-ROOT-3',
					taskIds: Object.freeze(['TASK-ROOT-3']),
					attentionLevel: AttentionLevel.Idle,
				}),
				createSwarmState({
					swarmId: 'TASK-ROOT-4',
					rootTaskId: 'TASK-ROOT-4',
					taskIds: Object.freeze(['TASK-ROOT-4']),
					attentionLevel: AttentionLevel.Completed,
				}),
			],
			fleet: createFleetState([
				createAgentState({
					dispatchId: runningDispatchId,
					taskId: 'TASK-ROOT-1',
					roleId: 'planner',
					status: AgentStatus.Running,
					attentionLevel: AttentionLevel.Active,
					lastHeartbeat: now - 5_000,
					timeInState: 125_000,
					lastActivity: 'Coordinating implementation',
				}),
				createAgentState({
					dispatchId: 'disp-blocked-1',
					taskId: 'TASK-ROOT-2',
					roleId: 'worker',
					status: AgentStatus.Blocked,
					attentionLevel: AttentionLevel.NeedsAction,
					lastHeartbeat: now - 30_000,
					timeInState: 900_000,
					lastActivity: 'Waiting on human input',
				}),
				createAgentState({
					dispatchId: 'disp-failed-1',
					taskId: 'TASK-ROOT-3',
					roleId: 'judge',
					status: AgentStatus.Failed,
					attentionLevel: AttentionLevel.Critical,
					lastHeartbeat: now - 90_000,
					timeInState: 2_400_000,
					lastActivity: 'Failed validation pass',
				}),
				createAgentState({
					dispatchId: 'disp-idle-1',
					taskId: 'TASK-ROOT-4',
					roleId: 'worker',
					status: AgentStatus.Idle,
					attentionLevel: AttentionLevel.Idle,
					lastHeartbeat: now - 240_000,
					timeInState: 3_600_000,
					lastActivity: 'Waiting for more work',
				}),
			]),
			health: createHealthState({
				mode: PoolMode.DiskPressure,
				queueDepth: 3,
				attentionLevel: AttentionLevel.NeedsAction,
			}),
			reviewGates: [
				createReviewGateState({
					dispatchId: runningDispatchId,
					taskId: 'TASK-ROOT-1',
					roleId: 'judge',
					reviewState: WireReviewState.AwaitingReview,
					attentionLevel: AttentionLevel.NeedsAction,
				}),
			],
			mergeQueue: [
				createMergeEntry({
					dispatchId: runningDispatchId,
					taskId: 'TASK-ROOT-1',
					status: MergeExecutionStatus.Pending,
					attentionLevel: AttentionLevel.Active,
				}),
			],
		});

		const model = buildFleetCommandModel(state, now);
		const stats = Object.fromEntries(model.stats.map(item => [item.label, item.value]));
		const groups = Object.fromEntries(model.groups.map(group => [group.id, group]));

		assert.strictEqual(model.title, 'Fleet Command');
		assert.deepStrictEqual(stats, {
			'Connection': 'Daemon',
			'Health': 'Disk Pressure',
			'Queue depth': '3',
			'Running': '1',
			'Blocked': '1',
			'Failed': '1',
			'Critical swarms': '1',
			'Needs action swarms': '1',
			'Review pressure': '1',
		});
		assert.strictEqual(groups['attention'].count, 1);
		assert.strictEqual(groups['running'].count, 1);
		assert.strictEqual(groups['blocked'].count, 1);
		assert.strictEqual(groups['failed'].count, 1);
		assert.strictEqual(groups['idle'].count, 1);

		const pressureItem = groups['attention'].items[0];
		assert.strictEqual(pressureItem.dispatchId, runningDispatchId);
		assert.strictEqual(pressureItem.heartbeatLabel, '5s ago');
		assert.strictEqual(pressureItem.timeInStateLabel, '2m');
		assert.strictEqual(pressureItem.lastActivityLabel, 'Coordinating implementation');
		assert.strictEqual(pressureItem.pressureSummary, 'Gate Awaiting Review • Merge Pending');
		assert.deepStrictEqual(pressureItem.pivots.map(pivot => ({ id: pivot.id, kind: pivot.target.kind })), [
			{ id: `agent:${runningDispatchId}`, kind: EntityKind.Agent },
			{ id: 'swarm:TASK-ROOT-1', kind: EntityKind.Swarm },
			{ id: `gate:${runningDispatchId}`, kind: EntityKind.Review },
			{ id: `merge:${runningDispatchId}`, kind: EntityKind.Review },
		]);
	});

	test('keeps fleet review pressure scoped to the live dispatch rather than the whole task tree', () => {
		const now = 500_000;
		const state = createAtlasStateSnapshot({
			swarms: [
				createSwarmState({
					swarmId: 'TASK-ROOT-1',
					rootTaskId: 'TASK-ROOT-1',
					taskIds: Object.freeze(['TASK-ROOT-1']),
				}),
			],
			fleet: createFleetState([
				createAgentState({
					dispatchId: 'disp-live-1',
					taskId: 'TASK-ROOT-1',
					status: AgentStatus.Running,
					lastHeartbeat: now - 20_000,
				}),
			]),
			reviewGates: [
				createReviewGateState({
					dispatchId: 'disp-other-1',
					taskId: 'TASK-ROOT-1',
					reviewState: WireReviewState.AwaitingReview,
					attentionLevel: AttentionLevel.NeedsAction,
				}),
			],
			mergeQueue: [
				createMergeEntry({
					dispatchId: 'disp-other-1',
					taskId: 'TASK-ROOT-1',
					status: MergeExecutionStatus.Pending,
					attentionLevel: AttentionLevel.Active,
				}),
			],
		});

		const model = buildFleetCommandModel(state, now);
		const runningItem = model.groups.find(group => group.id === 'running')?.items[0];

		assert.ok(runningItem);
		assert.strictEqual(model.groups.find(group => group.id === 'attention')?.count, 0);
		assert.strictEqual(runningItem.hasReviewPressure, false);
		assert.strictEqual(runningItem.hasMergePressure, false);
		assert.strictEqual(runningItem.pressureSummary, undefined);
		assert.deepStrictEqual(runningItem.pivots.map(pivot => pivot.id), ['agent:disp-live-1', 'swarm:TASK-ROOT-1']);
	});

	test('builds a swarm-rooted tasks workspace with rooted lineage, related agents, and review pressure', () => {
		const now = 600_000;
		const state = createAtlasStateSnapshot({
			swarms: [
				createSwarmState({
					swarmId: 'TASK-ROOT-1',
					rootTaskId: 'TASK-ROOT-1',
					objectiveId: 'OBJ-1',
					objectiveProblemStatement: 'Ship the agent execution surface',
					taskIds: Object.freeze(['TASK-ROOT-1', 'TASK-CHILD-1']),
					agentDispatchIds: Object.freeze(['disp-root']),
					reviewDispatchIds: Object.freeze(['disp-gate-1']),
					mergeDispatchIds: Object.freeze(['disp-merge-1']),
					reviewNeeded: true,
					updatedAt: 540_000,
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
					roleId: 'worker',
					summary: 'Implement the center shell',
					status: TaskStatus.Blocked,
					attentionLevel: AttentionLevel.NeedsAction,
					enqueuedAt: 150,
				}),
			],
			objectives: [
				createObjectiveState({
					objectiveId: 'OBJ-1',
					rootTaskId: 'TASK-ROOT-1',
					problemStatement: 'Ship the agent execution surface',
				}),
			],
			fleet: createFleetState([
				createAgentState({
					dispatchId: 'disp-root',
					taskId: 'TASK-ROOT-1',
					lastHeartbeat: 590_000,
				}),
			]),
			reviewGates: [
				createReviewGateState({
					dispatchId: 'disp-gate-1',
					taskId: 'TASK-CHILD-1',
					reviewState: WireReviewState.AwaitingReview,
				}),
			],
			mergeQueue: [
				createMergeEntry({
					dispatchId: 'disp-merge-1',
					taskId: 'TASK-ROOT-1',
					status: MergeExecutionStatus.Pending,
					attentionLevel: AttentionLevel.Active,
				}),
			],
		});

		const model = buildTasksWorkspaceModel(
			{ section: NavigationSection.Tasks, entity: { kind: EntityKind.Task, id: 'TASK-CHILD-1' } },
			state,
			now,
		);

		assert.strictEqual(model.mode, 'swarm');
		assert.strictEqual(model.title, 'Ship the agent execution surface');
		assert.deepStrictEqual(model.taskEntries.map(entry => ({ taskId: entry.taskId, depth: entry.depth, selected: entry.selected })), [
			{ taskId: 'TASK-ROOT-1', depth: 0, selected: false },
			{ taskId: 'TASK-CHILD-1', depth: 1, selected: true },
		]);
		assert.deepStrictEqual(model.agentEntries.map(entry => entry.dispatchId), ['disp-root']);
		assert.deepStrictEqual(model.pressureEntries.map(entry => ({ id: entry.id, kind: entry.kind })), [
			{ id: 'gate:disp-gate-1', kind: ReviewTargetKind.Gate },
			{ id: 'merge:disp-merge-1', kind: ReviewTargetKind.Merge },
		]);
		assert.ok(model.details.some(detail => detail.label === 'Objective' && detail.value.includes('OBJ-1')));
		assert.deepStrictEqual(model.links.map(link => link.label), ['Open Objective', 'Browse Agents', 'Browse Reviews', 'Open Fleet']);
	});

	test('keeps tasks workspace objective metadata omitted when swarm derivation left linkage ambiguous', () => {
		const model = buildTasksWorkspaceModel(
			{
				section: NavigationSection.Tasks,
				entity: { kind: EntityKind.Swarm, id: 'TASK-ROOT-1' },
			},
			createAtlasStateSnapshot({
				swarms: [
					createSwarmState({
						swarmId: 'TASK-ROOT-1',
						rootTaskId: 'TASK-ROOT-1',
						objectiveId: undefined,
						objectiveProblemStatement: undefined,
						taskIds: Object.freeze(['TASK-ROOT-1']),
					}),
				],
				tasks: [
					createTaskState({
						taskId: 'TASK-ROOT-1',
						dispatchId: 'disp-root',
						summary: 'Root planner task',
					}),
				],
				objectives: [
					createObjectiveState({
						objectiveId: 'OBJ-AMBIGUOUS',
						rootTaskId: 'TASK-ROOT-1',
						problemStatement: 'Ambiguous objective that derivation intentionally omitted',
					}),
				],
			}),
		);

		assert.strictEqual(model.title, 'TASK-ROOT-1');
		assert.ok(model.details.some(detail => detail.label === 'Objective' && detail.value === 'Ad-hoc root task'));
		assert.deepStrictEqual(model.links.map(link => link.label), ['Browse Agents', 'Browse Reviews', 'Open Fleet']);
	});

	test('builds a substantive agents overview with deterministic execution groups', () => {
		const now = 900_000;
		const state = createAtlasStateSnapshot({
			swarms: [
				createSwarmState({
					swarmId: 'TASK-ROOT-1',
					rootTaskId: 'TASK-ROOT-1',
					taskIds: Object.freeze(['TASK-ROOT-1']),
				}),
				createSwarmState({
					swarmId: 'TASK-ROOT-2',
					rootTaskId: 'TASK-ROOT-2',
					taskIds: Object.freeze(['TASK-ROOT-2']),
				}),
			],
			fleet: createFleetState([
				createAgentState({
					dispatchId: 'disp-running-1',
					taskId: 'TASK-ROOT-1',
					status: AgentStatus.Running,
					lastHeartbeat: now - 5_000,
				}),
				createAgentState({
					dispatchId: 'disp-blocked-1',
					taskId: 'TASK-ROOT-1',
					status: AgentStatus.Blocked,
					attentionLevel: AttentionLevel.NeedsAction,
					lastHeartbeat: now - 30_000,
				}),
				createAgentState({
					dispatchId: 'disp-failed-1',
					taskId: 'TASK-ROOT-2',
					status: AgentStatus.Failed,
					attentionLevel: AttentionLevel.Critical,
					lastHeartbeat: now - 45_000,
				}),
				createAgentState({
					dispatchId: 'disp-idle-1',
					taskId: 'TASK-ROOT-2',
					status: AgentStatus.Idle,
					lastHeartbeat: now - 120_000,
				}),
			]),
		});

		const model = buildAgentsWorkspaceModel(
			{ section: NavigationSection.Agents, entity: undefined },
			state,
			now,
		);

		assert.strictEqual(model.mode, 'overview');
		assert.deepStrictEqual(model.groups.map(group => ({ id: group.id, count: group.count })), [
			{ id: 'running', count: 1 },
			{ id: 'blocked', count: 1 },
			{ id: 'failed', count: 1 },
			{ id: 'idle', count: 1 },
		]);
		assert.deepStrictEqual(model.links.map(link => link.label), ['Browse Tasks', 'Browse Reviews', 'Open Fleet']);
		assert.strictEqual(model.groups[0].items[0].heartbeatLabel, '5s ago');
	});

	test('builds a focused agent execution workspace with swarm, task, and review pivots', () => {
		const now = 1_200_000;
		const dispatchId = 'disp-agent-1';
		const state = createAtlasStateSnapshot({
			swarms: [
				createSwarmState({
					swarmId: 'TASK-ROOT-1',
					rootTaskId: 'TASK-ROOT-1',
					taskIds: Object.freeze(['TASK-ROOT-1', 'TASK-CHILD-1']),
				}),
			],
			fleet: createFleetState([
				createAgentState({
					dispatchId,
					taskId: 'TASK-CHILD-1',
					roleId: 'worker',
					status: AgentStatus.Blocked,
					worktreePath: '/workspace/feature/disp-agent-1',
					lastHeartbeat: now - 15_000,
					timeInState: 300_000,
					lastActivity: 'Waiting on review gate',
					attentionLevel: AttentionLevel.NeedsAction,
				}),
				createAgentState({
					dispatchId: 'disp-peer-1',
					taskId: 'TASK-CHILD-1',
					roleId: 'judge',
					status: AgentStatus.Running,
					lastHeartbeat: now - 3_000,
				}),
				createAgentState({
					dispatchId: 'disp-peer-2',
					taskId: 'TASK-ROOT-1',
					roleId: 'planner',
					status: AgentStatus.Running,
					lastHeartbeat: now - 10_000,
				}),
			]),
			reviewGates: [
				createReviewGateState({
					dispatchId,
					taskId: 'TASK-CHILD-1',
					roleId: 'axiom-judge',
					reviewState: WireReviewState.AwaitingReview,
				}),
			],
			mergeQueue: [
				createMergeEntry({
					dispatchId,
					taskId: 'TASK-CHILD-1',
					status: MergeExecutionStatus.Pending,
					attentionLevel: AttentionLevel.Active,
				}),
			],
		});

		const model = buildAgentsWorkspaceModel(
			{ section: NavigationSection.Agents, entity: { kind: EntityKind.Agent, id: dispatchId } },
			state,
			now,
		);

		assert.strictEqual(model.mode, 'agent');
		assert.strictEqual(model.selectedDispatchId, dispatchId);
		assert.deepStrictEqual(model.links.map(link => link.label), ['Open Swarm', 'Open Task', 'Open Fleet', 'Open Gate', 'Open Merge']);
		assert.deepStrictEqual(model.pressureEntries.map(entry => entry.kind), [ReviewTargetKind.Gate, ReviewTargetKind.Merge]);
		assert.ok(model.details.some(detail => detail.label === 'Worktree' && detail.value === '/workspace/feature/disp-agent-1'));
		assert.deepStrictEqual(model.groups.map(group => ({ id: group.id, count: group.count })), [
			{ id: 'same-task', count: 1 },
			{ id: 'same-swarm', count: 1 },
		]);
		assert.strictEqual(model.groups[0].items[0].dispatchId, 'disp-peer-1');
		assert.strictEqual(model.groups[1].items[0].dispatchId, 'disp-peer-2');
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
		supportedWriteMethods: Object.freeze([]),
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
