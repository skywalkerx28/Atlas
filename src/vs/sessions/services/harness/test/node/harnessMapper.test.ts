/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-layering, local/code-import-patterns -- Node-side hardening tests intentionally exercise the desktop mapper implementation directly. */

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	applyDaemonFleetDelta,
	healthSnapshotFromDaemonResult,
	snapshotStateFromDaemonSnapshot,
	toBridgeTaskTree,
	toPresentationFleet,
	toPresentationHealth,
	toPresentationMergeEntries,
	toPresentationObjectives,
	toPresentationReviewGates,
	toPresentationTasks,
} from '../../electron-browser/harnessMapper.js';
import {
	createDaemonHealthState,
	createFleetDeltaNotification,
	createFleetSnapshotResult,
	createFleetWorkerState,
	createHealthResult,
	createMergeQueueRecord,
	createObjectiveRecord,
	createQueueDispatch,
	createQueueState,
	createReviewCandidateRecord,
	createTaskNode,
	createTaskTreeResult,
} from './harnessTestUtils.js';

suite('HarnessMapper', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('maps fleet snapshot into presentation fleet without fabricating unsupported state', () => {
		const snapshot = snapshotStateFromDaemonSnapshot(createFleetSnapshotResult({
			snapshot: {
				workers: Object.freeze([
					createFleetWorkerState({
						dispatch_id: 'disp-planner',
						task_id: 'task-planner',
						role_id: 'planner',
						state: 'executing',
						started_at: '2026-03-11T12:00:01.000Z',
					}),
					createFleetWorkerState({
						dispatch_id: 'disp-judge',
						task_id: 'task-judge',
						role_id: 'judge',
						state: 'ready',
						started_at: '2026-03-11T12:00:02.000Z',
					}),
					createFleetWorkerState({
						dispatch_id: 'disp-worker',
						task_id: 'task-worker',
						role_id: 'worker',
						state: 'failed',
						started_at: '2026-03-11T12:00:03.000Z',
					}),
				]),
				queue: createQueueState({
					dispatch_queue_depth: 2,
					merge_conflicts: 1,
				}),
				health: createDaemonHealthState({
					mode: 'normal',
					active_workers: 2,
					queue_depth: 2,
				}),
			},
		}));

		const fleet = toPresentationFleet(snapshot);
		const health = toPresentationHealth(snapshot);

		assert.strictEqual(fleet.agents.length, 3);
		assert.deepStrictEqual(fleet.agents.map(agent => agent.dispatchId), ['disp-planner', 'disp-judge', 'disp-worker']);
		assert.deepStrictEqual(fleet.agents.map(agent => agent.status), ['running', 'idle', 'failed']);
		assert.deepStrictEqual(fleet.agents.map(agent => agent.role), ['planner', 'judge', 'worker']);
		assert.strictEqual(fleet.activeCount, 1);
		assert.strictEqual(fleet.idleCount, 1);
		assert.strictEqual(fleet.failedCount, 1);
		assert.strictEqual(fleet.blockedCount, 0);
		assert.strictEqual(fleet.totalCostSpent, 0);
		assert.strictEqual(fleet.attentionLevel, 4);
		assert.strictEqual(fleet.agents[0].costSpent, 0);
		assert.strictEqual(fleet.agents[0].lastActivity, undefined);

		assert.strictEqual(health.mode, 'normal');
		assert.strictEqual(health.attentionLevel, 3);
		assert.strictEqual(health.activeWorkers, 2);
		assert.strictEqual(health.queueDepth, 2);
	});

	test('applies fleet delta by dispatch id and keeps presentation state consistent', () => {
		const base = snapshotStateFromDaemonSnapshot(createFleetSnapshotResult({
			seq: 10,
			snapshot: {
				workers: Object.freeze([
					createFleetWorkerState({
						dispatch_id: 'disp-a',
						task_id: 'task-a',
						role_id: 'planner',
						state: 'executing',
						started_at: '2026-03-11T12:00:01.000Z',
					}),
					createFleetWorkerState({
						dispatch_id: 'disp-b',
						task_id: 'task-b',
						role_id: 'worker',
						state: 'ready',
						started_at: '2026-03-11T12:00:02.000Z',
					}),
				]),
			},
		}));

		const updated = applyDaemonFleetDelta(base, createFleetDeltaNotification({
			seq: 11,
			subscription_id: 'sub-2',
			removed: Object.freeze(['disp-b']),
			changed: Object.freeze([
				createFleetWorkerState({
					dispatch_id: 'disp-a',
					task_id: 'task-a',
					role_id: 'planner',
					state: 'paused',
					started_at: '2026-03-11T12:00:01.000Z',
				}),
			]),
			added: Object.freeze([
				createFleetWorkerState({
					dispatch_id: 'disp-c',
					task_id: 'task-c',
					role_id: 'judge',
					state: 'completed',
					started_at: '2026-03-11T12:00:03.000Z',
				}),
			]),
			queue: createQueueState({
				dispatch_queue_depth: 0,
				merge_queue_depth: 1,
			}),
			health: createDaemonHealthState({
				mode: 'paused',
				active_workers: 1,
			}),
		}));

		const fleet = toPresentationFleet(updated);
		const health = toPresentationHealth(updated);

		assert.strictEqual(updated.seq, 11);
		assert.strictEqual(updated.subscriptionId, 'sub-2');
		assert.deepStrictEqual(updated.workers.map(worker => worker.dispatchId), ['disp-a', 'disp-c']);
		assert.deepStrictEqual(fleet.agents.map(agent => agent.status), ['blocked', 'completed']);
		assert.strictEqual(fleet.blockedCount, 1);
		assert.strictEqual(fleet.activeCount, 0);
		assert.strictEqual(fleet.idleCount, 0);
		assert.strictEqual(fleet.failedCount, 0);
		assert.strictEqual(health.mode, 'paused');
		assert.strictEqual(health.attentionLevel, 3);
	});

	test('maps objective, review, merge, and task tree surfaces without fabricating missing semantics', () => {
		const objective = createObjectiveRecord({
			spec: {
				objective_id: 'OBJ-MAP-1',
				problem_statement: 'Map bridge state',
				constraints: Object.freeze(['read-only']),
				context_paths: Object.freeze(['src/vs/sessions']),
			},
			root_task_id: 'TASK-ROOT-1',
			status: 'reviewing',
		});
		const review = createReviewCandidateRecord({
			dispatch_id: 'disp-review-map',
			task_id: 'TASK-ROOT-1',
			review_state: 'awaiting_review',
		});
		const merge = createMergeQueueRecord({
			dispatch_id: 'disp-merge-map',
			task_id: 'TASK-ROOT-1',
			status: 'merge_blocked',
		});
		const taskTree = createTaskTreeResult({
			root_task_id: 'TASK-ROOT-1',
			objective,
			nodes: Object.freeze([
				{
					task: createTaskNode({
						task_id: 'TASK-ROOT-1',
						parent_task_id: null,
						status: 'running',
					}),
					latest_dispatch: createQueueDispatch({
						dispatch_id: 'disp-root',
						task_id: 'TASK-ROOT-1',
						role_id: 'planner',
						priority: 'p1',
						handoff_type: 'planning',
					}),
				},
				{
					task: createTaskNode({
						task_id: 'TASK-CHILD-1',
						parent_task_id: 'TASK-ROOT-1',
						depth: 1,
						status: 'pending',
					}),
					latest_dispatch: createQueueDispatch({
						dispatch_id: 'disp-child',
						task_id: 'TASK-CHILD-1',
						role_id: 'worker',
						priority: 'p2',
						handoff_type: 'implementation',
					}),
				},
				{
					task: createTaskNode({
						task_id: 'TASK-CHILD-NODISPATCH',
						parent_task_id: 'TASK-ROOT-1',
						depth: 1,
						status: 'blocked',
					}),
				},
			]),
		});

		const objectives = toPresentationObjectives([objective]);
		const reviewGates = toPresentationReviewGates([review]);
		const mergeEntries = toPresentationMergeEntries([merge]);
		const tasks = toPresentationTasks([taskTree], snapshotStateFromDaemonSnapshot(createFleetSnapshotResult({
			snapshot: {
				workers: Object.freeze([
					createFleetWorkerState({
						dispatch_id: 'disp-root',
						task_id: 'TASK-ROOT-1',
						role_id: 'planner',
						state: 'executing',
					}),
				]),
			},
		})).workers);
		const lineage = toBridgeTaskTree(taskTree);

		assert.strictEqual(objectives.length, 1);
		assert.strictEqual(objectives[0].objectiveId, 'OBJ-MAP-1');
		assert.strictEqual(objectives[0].status, 'reviewing');
		assert.strictEqual(objectives[0].costSpent, 0);

		assert.strictEqual(reviewGates.length, 1);
		assert.strictEqual(reviewGates[0].dispatchId, 'disp-review-map');
		assert.strictEqual(reviewGates[0].attentionLevel, 3);

		assert.strictEqual(mergeEntries.length, 1);
		assert.strictEqual(mergeEntries[0].dispatchId, 'disp-merge-map');
		assert.strictEqual(mergeEntries[0].status, 'merge_blocked');
		assert.strictEqual(mergeEntries[0].attentionLevel, 4);

		assert.strictEqual(tasks.length, 3);
		assert.strictEqual(tasks[0].dispatchId, 'disp-root');
		assert.strictEqual(tasks[0].roleId, 'planner');
		assert.strictEqual(tasks[1].priority, 2);
		assert.strictEqual(tasks[2].roleId, '');
		assert.strictEqual(tasks[2].priority, -1);
		assert.deepStrictEqual(tasks[2].acceptance, []);
		assert.deepStrictEqual(tasks[2].constraints, []);
		assert.deepStrictEqual(tasks[2].dependsOn, []);

		assert.strictEqual(lineage.rootTaskId, 'TASK-ROOT-1');
		assert.strictEqual(lineage.objectiveId, 'OBJ-MAP-1');
		assert.deepStrictEqual(lineage.nodes.map(node => node.taskId), ['TASK-ROOT-1', 'TASK-CHILD-1', 'TASK-CHILD-NODISPATCH']);
		assert.strictEqual(lineage.nodes[2].dispatchId, undefined);
	});

	test('unknown or degraded raw health never renders as healthy', () => {
		const snapshot = snapshotStateFromDaemonSnapshot(createFleetSnapshotResult({
			snapshot: {
				workers: Object.freeze([]),
				queue: createQueueState(),
				health: createDaemonHealthState({
					mode: 'normal',
					active_workers: 0,
					queue_depth: 0,
				}),
			},
		}));

		const unknownHealth = toPresentationHealth(snapshot, healthSnapshotFromDaemonResult(createHealthResult({
			health: createDaemonHealthState({
				mode: 'unknown',
				active_workers: 0,
				queue_depth: 0,
			}),
		})));
		const degradedHealth = toPresentationHealth(snapshot, healthSnapshotFromDaemonResult(createHealthResult({
			health: createDaemonHealthState({
				mode: 'disk_pressure',
				active_workers: 0,
				queue_depth: 0,
			}),
		})));

		assert.strictEqual(unknownHealth.mode, 'paused');
		assert.strictEqual(unknownHealth.attentionLevel, 3);
		assert.notStrictEqual(unknownHealth.mode, 'normal');
		assert.strictEqual(degradedHealth.mode, 'disk_pressure');
		assert.strictEqual(degradedHealth.attentionLevel, 3);
	});
});
