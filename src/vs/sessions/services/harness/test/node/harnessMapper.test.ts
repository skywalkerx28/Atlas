/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-layering, local/code-import-patterns -- Node-side hardening tests intentionally exercise the desktop mapper implementation directly. */

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	applyDaemonFleetDelta,
	snapshotStateFromDaemonSnapshot,
	toPresentationFleet,
	toPresentationHealth,
} from '../../electron-browser/harnessMapper.js';
import {
	createDaemonHealthState,
	createFleetDeltaNotification,
	createFleetSnapshotResult,
	createFleetWorkerState,
	createQueueState,
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

	test('unknown or degraded raw health never renders as healthy', () => {
		const unknownSnapshot = snapshotStateFromDaemonSnapshot(createFleetSnapshotResult({
			snapshot: {
				workers: Object.freeze([]),
				queue: createQueueState(),
				health: createDaemonHealthState({
					mode: 'unknown',
					active_workers: 0,
					queue_depth: 0,
				}),
			},
		}));

		const degradedSnapshot = snapshotStateFromDaemonSnapshot(createFleetSnapshotResult({
			snapshot: {
				workers: Object.freeze([]),
				queue: createQueueState(),
				health: createDaemonHealthState({
					mode: 'disk_pressure',
					active_workers: 0,
					queue_depth: 0,
				}),
			},
		}));

		const unknownHealth = toPresentationHealth(unknownSnapshot);
		const degradedHealth = toPresentationHealth(degradedSnapshot);

		assert.strictEqual(unknownHealth.mode, 'paused');
		assert.strictEqual(unknownHealth.attentionLevel, 3);
		assert.notStrictEqual(unknownHealth.mode, 'normal');
		assert.strictEqual(degradedHealth.mode, 'disk_pressure');
		assert.strictEqual(degradedHealth.attentionLevel, 3);
	});
});
