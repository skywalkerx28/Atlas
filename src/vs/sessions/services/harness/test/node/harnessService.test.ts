/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-layering, local/code-import-patterns -- Node-side bridge tests intentionally exercise the desktop and web harness implementations directly. */

import assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import { dirname, join } from '../../../../../base/common/path.js';
import { env } from '../../../../../base/common/process.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import type { IProductService } from '../../../../../platform/product/common/productService.js';
import { ActivityEventKind, HandoffType } from '../../../../common/model/wire.js';
import { HarnessConnectionState } from '../../common/harnessService.js';
import { HarnessDaemonProtocolError, HarnessDaemonUnavailableError } from '../../electron-browser/harnessDaemonClient.js';
import { HarnessService as BrowserHarnessService } from '../../browser/harnessService.js';
import { HarnessService as DesktopHarnessService } from '../../electron-browser/harnessService.js';
import type { HarnessCapability, HarnessSupportedWriteMethod, IHarnessFabricIdentity } from '../../common/harnessTypes.js';
import {
	createAgentActivityResult,
	createArtifactGetResult,
	createArtifactListResult,
	createControlResult,
	createDaemonHealthState,
	createDispatchSubmitResult,
	createFleetSnapshotResult,
	createFleetWorkerState,
	createHarnessInitializeResult,
	createMergeListResult,
	createMergeQueueRecord,
	createObjectiveDetail,
	createObjectiveSubmitResult,
	createObjectiveListResult,
	createObjectiveRecord,
	createQueueDispatch,
	createReviewAuthorizePromotionResult,
	createReviewCandidateRecord,
	createReviewEnqueueMergeResult,
	createReviewGateVerdictResult,
	createReviewListResult,
	createReviewProvenanceListResult,
	createResultGetResult,
	createTaskDetail,
	createTaskListResult,
	createTaskNode,
	createTaskTreeResult,
	createTranscriptGetResult,
	createWorktreeGetResult,
	createWorktreeListResult,
	createMemoryListResult,
	startMockHarnessDaemon,
} from './harnessTestUtils.js';

const DAEMON_REQUIRED_ERROR = 'Harness daemon required; Atlas is in read-only mode.';
const WEB_UNAVAILABLE_ERROR = 'Harness daemon is unavailable in web sessions.';
const HARNESS_ENV_KEYS = [
	'AXIOM_HARNESS_SOCK',
	'AXIOM_FRONTIER_RUNNER_DB',
	'AXIOM_WORKSPACE_ROUTER_STATE_DB',
	'AXIOM_WORKSPACE_ROUTER_DB',
	'AXIOM_INTEGRATION_DB_PATH',
	'AXIOM_FRONTIER_ENV_FILE',
	'AXIOM_HARNESS_HOME',
	'AXIOM_FRONTIER_REPO_ROOT',
] as const;

suite('HarnessService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const originalEnv = new Map<string, string | undefined>();

	setup(() => {
		for (const key of HARNESS_ENV_KEYS) {
			originalEnv.set(key, env[key]);
			delete env[key];
		}
	});

	teardown(() => {
		for (const key of HARNESS_ENV_KEYS) {
			const value = originalEnv.get(key);
			if (value === undefined) {
				delete env[key];
			} else {
				env[key] = value;
			}
		}
		originalEnv.clear();
	});

	test('selects daemon mode and populates wave c read state when daemon connect succeeds', async () => {
		const fixture = await createDaemonFixture();
		const objective = createObjectiveRecord({
			spec: { objective_id: 'OBJ-WC-1', problem_statement: 'Expand bridge' },
			root_task_id: 'TASK-ROOT-1',
		});
		const review = createReviewCandidateRecord({
			dispatch_id: 'disp-review-wave-c',
			task_id: 'TASK-ROOT-1',
			review_state: 'awaiting_review',
		});
		const merge = createMergeQueueRecord({
			dispatch_id: 'disp-merge-wave-c',
			task_id: 'TASK-ROOT-1',
			status: 'pending',
		});
		const server = await startMockHarnessDaemon({
			socketPath: fixture.socketPath,
			initializeResult: createHarnessInitializeResult({
				fabric_identity: fixture.fabricIdentity,
			}),
			fleetSnapshotResult: createFleetSnapshotResult({
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
			}),
			healthResult: {
				seq: 10,
				health: createDaemonHealthState({
					mode: 'disk_pressure',
					active_workers: 1,
				}),
			},
			objectiveListResult: createObjectiveListResult({
				objectives: Object.freeze([objective]),
			}),
			reviewListResult: createReviewListResult({
				reviews: Object.freeze([review]),
			}),
			mergeListResult: createMergeListResult({
				entries: Object.freeze([merge]),
			}),
			taskListResult: createTaskListResult({
				roots: Object.freeze([
					{
						task: createTaskNode({
							task_id: 'TASK-ROOT-1',
							parent_task_id: null,
							status: 'running',
						}),
						objective,
						latest_dispatch: createQueueDispatch({
							dispatch_id: 'disp-root',
							task_id: 'TASK-ROOT-1',
							role_id: 'planner',
							priority: 'p1',
							handoff_type: 'planning',
						}),
					},
				]),
			}),
			taskTreeResult: createTaskTreeResult({
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
				]),
			}),
			taskDetail: createTaskDetail({
				task: createTaskNode({
					task_id: 'TASK-ROOT-1',
					parent_task_id: null,
					status: 'running',
				}),
				objective,
				latest_dispatch: createQueueDispatch({
					dispatch_id: 'disp-root',
					task_id: 'TASK-ROOT-1',
					role_id: 'planner',
					priority: 'p1',
					handoff_type: 'planning',
				}),
			}),
		});

		const service = disposables.add(createDesktopHarnessService(fixture.homeRoot));
		try {
			await service.connect(URI.file(fixture.workspaceRoot));

			const connectionState = service.connectionState.get();
			assert.strictEqual(connectionState.state, HarnessConnectionState.Connected);
			assert.strictEqual(connectionState.mode, 'daemon');
			assert.strictEqual(connectionState.writesEnabled, false);
			assert.deepStrictEqual(connectionState.supportedWriteMethods, []);
			assert.deepStrictEqual(connectionState.fabricIdentity, fixture.fabricIdentity);
			assert.deepStrictEqual(connectionState.grantedCapabilities, ['read']);

			const methods = server.requests.map(request => request.method);
			assert.deepStrictEqual(methods.slice(0, 2), ['initialize', 'daemon.ping']);
			for (const requiredMethod of [
				'fleet.snapshot',
				'health.get',
				'objective.list',
				'review.list',
				'merge.list',
				'task.list',
				'task.tree',
				'fleet.subscribe',
				'health.subscribe',
				'objective.subscribe',
				'review.subscribe',
				'merge.subscribe',
			]) {
				assert.ok(methods.includes(requiredMethod), `expected daemon request '${requiredMethod}'`);
			}

			assert.strictEqual(service.objectives.get().length, 1);
			assert.strictEqual(service.objectives.get()[0].objectiveId, 'OBJ-WC-1');
			assert.strictEqual(service.reviewGates.get().length, 1);
			assert.strictEqual(service.reviewGates.get()[0].dispatchId, 'disp-review-wave-c');
			assert.strictEqual(service.mergeQueue.get().length, 1);
			assert.strictEqual(service.mergeQueue.get()[0].dispatchId, 'disp-merge-wave-c');
			assert.strictEqual(service.tasks.get().length, 2);
			assert.deepStrictEqual(service.tasks.get().map(task => task.taskId), ['TASK-ROOT-1', 'TASK-CHILD-1']);
			assert.strictEqual(service.health.get().mode, 'disk_pressure');
			assert.strictEqual(service.health.get().attentionLevel, 3);
			assert.strictEqual(service.swarms.get().length, 1);
			assert.deepStrictEqual(service.swarms.get()[0].taskIds, ['TASK-ROOT-1', 'TASK-CHILD-1']);
			assert.deepStrictEqual(service.swarms.get()[0].agentDispatchIds, ['disp-root']);
			assert.deepStrictEqual(service.swarms.get()[0].reviewDispatchIds, ['disp-review-wave-c']);
			assert.deepStrictEqual(service.swarms.get()[0].mergeDispatchIds, ['disp-merge-wave-c']);
			assert.strictEqual(service.swarms.get()[0].swarmId, 'TASK-ROOT-1');
			assert.strictEqual(service.swarms.get()[0].rootTaskId, 'TASK-ROOT-1');
			assert.strictEqual(service.swarms.get()[0].objectiveId, 'OBJ-WC-1');
			assert.strictEqual(service.swarms.get()[0].phase, 'reviewing');
			assert.strictEqual(service.swarms.get()[0].attentionLevel, 3);
			assert.strictEqual(service.swarms.get()[0].reviewNeeded, true);
			assert.strictEqual(service.swarms.get()[0].mergeBlocked, false);

			assert.strictEqual((await service.getObjective('OBJ-WC-1'))?.objectiveId, 'OBJ-WC-1');
			assert.strictEqual((await service.getSwarm('TASK-ROOT-1'))?.swarmId, 'TASK-ROOT-1');
			assert.strictEqual((await service.getTask('TASK-ROOT-1'))?.taskId, 'TASK-ROOT-1');
			assert.strictEqual((await service.getTaskTree('TASK-ROOT-1'))?.nodes.length, 2);
			assert.strictEqual((await service.getReviewGate('disp-review-wave-c'))?.dispatchId, 'disp-review-wave-c');
			assert.strictEqual((await service.getMergeEntry('disp-merge-wave-c'))?.dispatchId, 'disp-merge-wave-c');
		} finally {
			await service.disconnect();
			await server.dispose();
			await fixture.dispose();
		}
	});

	test('loads phase 8 inspector read surfaces on demand through the daemon', async () => {
		const fixture = await createDaemonFixture();
		const memoryList = createMemoryListResult();
		const artifactList = createArtifactListResult({
			dispatch_id: 'disp-root',
			task_id: 'TASK-ROOT-1',
			objective_id: 'OBJ-1',
		});
		const artifactGet = createArtifactGetResult({
			dispatch_id: 'disp-root',
			task_id: 'TASK-ROOT-1',
			objective_id: 'OBJ-1',
		});
		const worktreeGet = createWorktreeGetResult({
			dispatch_id: 'disp-root',
			task_id: 'TASK-ROOT-1',
			objective_id: 'OBJ-1',
		});
		const worktreeList = createWorktreeListResult({
			root_task_id: 'TASK-ROOT-1',
			objective_id: 'OBJ-1',
			worktrees: Object.freeze([
				worktreeGet,
				createWorktreeGetResult({
					dispatch_id: 'disp-child',
					task_id: 'TASK-CHILD-1',
					objective_id: 'OBJ-1',
					worktree_path: '/tmp/worktree-child',
					branch: 'feature/child',
					working_tree_clean: false,
					merge_ready: false,
				}),
			]),
		});
		const server = await startMockHarnessDaemon({
			socketPath: fixture.socketPath,
			initializeResult: createHarnessInitializeResult({
				fabric_identity: fixture.fabricIdentity,
			}),
			resultGetResult: createResultGetResult({
				dispatch_id: 'disp-root',
				result_packet: {
					...createResultGetResult().result_packet,
					task_id: 'TASK-ROOT-1',
					summary: 'Inspector-ready result packet',
				},
			}),
			transcriptGetResult: createTranscriptGetResult({
				dispatch_id: 'disp-root',
				available: true,
				excerpt_jsonl: '{"role":"assistant","content":"Captured checkpoint"}',
			}),
			memoryListResult: memoryList,
			memoryRecord: memoryList.records[0],
			worktreeGetResult: worktreeGet,
			worktreeListResult: worktreeList,
			artifactListResult: artifactList,
			artifactGetResult: artifactGet,
			agentActivityResult: createAgentActivityResult({
				dispatch_id: 'disp-root',
				events: Object.freeze([
					{
						ts: '2026-03-11T12:05:00.000Z',
						dispatch_id: 'disp-root',
						task_id: 'TASK-ROOT-1',
						objective_id: 'OBJ-1',
						role_id: 'planner',
						handoff_type: HandoffType.Planning,
						kind: ActivityEventKind.Reasoning,
						summary: 'Queued the next inspector refresh',
						payload: { source: 'test' },
					},
				]),
			}),
			reviewProvenanceListResult: createReviewProvenanceListResult({
				dispatch_id: 'disp-review-wave-c',
			}),
		});

		const service = disposables.add(createDesktopHarnessService(fixture.homeRoot));
		try {
			await service.connect(URI.file(fixture.workspaceRoot));

			const resultPacket = await service.getResultPacket('disp-root');
			assert.strictEqual(resultPacket?.summary, 'Inspector-ready result packet');

			const transcript = await service.getTranscript('disp-root');
			assert.strictEqual(transcript?.available, true);
			assert.strictEqual(transcript?.excerptJsonl, '{"role":"assistant","content":"Captured checkpoint"}');

			const rootMemory = await service.getMemoryRecords('TASK-ROOT-1');
			assert.strictEqual(rootMemory.length, 1);
			assert.strictEqual(rootMemory[0].header.record_id, 'mem-1');

			const taskMemory = await service.getTaskMemoryRecords('TASK-ROOT-1');
			assert.strictEqual(taskMemory.length, 1);

			const memoryRecord = await service.getMemoryRecord('mem-1');
			assert.strictEqual(memoryRecord?.header.record_id, 'mem-1');

			const worktreeState = await service.getWorktreeState('disp-root');
			assert.strictEqual(worktreeState?.dispatchId, 'disp-root');
			assert.strictEqual(worktreeState?.branch, 'feature/test');

			const worktreeStates = await service.getWorktreeStates('TASK-ROOT-1');
			assert.deepStrictEqual(worktreeStates.map(state => state.dispatchId), ['disp-root', 'disp-child']);
			assert.strictEqual(worktreeStates[1].attentionLevel, 3);

			const artifactInventory = await service.getArtifacts('disp-root');
			assert.strictEqual(artifactInventory?.artifacts.length, 1);
			assert.strictEqual(artifactInventory?.artifacts[0].artifactPath, 'result_packet.json');

			const artifactPreview = await service.getArtifactPreview('disp-root', 'result_packet.json');
			assert.strictEqual(artifactPreview?.textPreview, '{"status":"done"}');

			const activity = await service.getAgentActivity('disp-root');
			assert.strictEqual(activity.length, 1);
			assert.strictEqual(activity[0].dispatchId, 'disp-root');
			assert.strictEqual(activity[0].summary, 'Queued the next inspector refresh');

			const provenance = await service.getReviewProvenance('disp-review-wave-c');
			assert.strictEqual(provenance.length, 1);
			assert.strictEqual(provenance[0].method, 'review.gate_verdict');

			for (const method of [
				'result.get',
				'transcript.get',
				'memory.list',
				'memory.get',
				'worktree.get',
				'worktree.list',
				'artifact.list',
				'artifact.get',
				'agent.activity.get',
				'review.provenance.list',
			]) {
				assert.ok(server.requests.some(request => request.method === method), `expected daemon request '${method}'`);
			}
		} finally {
			await service.disconnect();
			await server.dispose();
			await fixture.dispose();
		}
	});

	test('fails closed when an optional phase 8 inspector method is not exposed by the daemon', async () => {
		const fixture = await createDaemonFixture();
		const initializeResult = createHarnessInitializeResult({
			fabric_identity: fixture.fabricIdentity,
			supported_methods: Object.freeze(
				createHarnessInitializeResult().supported_methods.filter(method => method !== 'artifact.get'),
			),
		});
		const server = await startMockHarnessDaemon({
			socketPath: fixture.socketPath,
			initializeResult,
		});
		const service = disposables.add(createDesktopHarnessService(fixture.homeRoot));

		try {
			await service.connect(URI.file(fixture.workspaceRoot));
			await assert.rejects(
				() => service.getArtifactPreview('disp-root', 'result_packet.json'),
				errorMessage('Current harness daemon does not expose artifact.get.'),
			);
		} finally {
			await service.disconnect();
			await server.dispose();
			await fixture.dispose();
		}
	});

	test('applies objective, review, merge, and health notifications in daemon mode', async () => {
		const fixture = await createDaemonFixture();
		const server = await startMockHarnessDaemon({
			socketPath: fixture.socketPath,
			initializeResult: createHarnessInitializeResult({
				fabric_identity: fixture.fabricIdentity,
			}),
			objectiveListResult: createObjectiveListResult({ objectives: Object.freeze([]) }),
			reviewListResult: createReviewListResult({ reviews: Object.freeze([]) }),
			mergeListResult: createMergeListResult({ entries: Object.freeze([]) }),
			taskListResult: createTaskListResult({ roots: Object.freeze([]) }),
			taskTreeResult: createTaskTreeResult({ nodes: Object.freeze([]) }),
		});

		const service = disposables.add(createDesktopHarnessService(fixture.homeRoot));
		try {
			await service.connect(URI.file(fixture.workspaceRoot));

			await server.notify('health.update', {
				subscription_id: 'sub-health.subscribe',
				seq: 11,
				...createDaemonHealthState({
					mode: 'paused',
					active_workers: 0,
				}),
			});
			await server.notify('objective.update', {
				subscription_id: 'sub-objective.subscribe',
				seq: 12,
				objectives: [createObjectiveRecord({
					spec: { objective_id: 'OBJ-NOTIFY', problem_statement: 'Notified' },
					root_task_id: 'TASK-ROOT-1',
				})],
			});
			await server.notify('review.update', {
				subscription_id: 'sub-review.subscribe',
				seq: 13,
				added: [createReviewCandidateRecord({ dispatch_id: 'disp-review-notify' })],
				changed: [],
				removed: [],
			});
			await server.notify('merge.update', {
				subscription_id: 'sub-merge.subscribe',
				seq: 14,
				added: [createMergeQueueRecord({ dispatch_id: 'disp-merge-notify' })],
				changed: [],
				removed: [],
			});

			await waitFor(() => service.objectives.get().some(objective => objective.objectiveId === 'OBJ-NOTIFY'));
			await waitFor(() => service.reviewGates.get().some(review => review.dispatchId === 'disp-review-notify'));
			await waitFor(() => service.mergeQueue.get().some(entry => entry.dispatchId === 'disp-merge-notify'));
			await waitFor(() => service.health.get().mode === 'paused');
		} finally {
			await service.disconnect();
			await server.dispose();
			await fixture.dispose();
		}
	});

	test('falls back to polling only when daemon is unavailable', async () => {
		const service = disposables.add(createDesktopHarnessService(os.tmpdir()));
		const mutable = service as unknown as IMutableHarnessService;
		let pollingStarted = false;

		mutable.connectDaemon = async () => {
			throw new HarnessDaemonUnavailableError('socket missing');
		};
		mutable.startPolling = async () => {
			pollingStarted = true;
			service.connectionState.set(connectionState('polling'), undefined, undefined);
		};

		await service.connect(URI.file('/workspace'));

		assert.ok(pollingStarted);
		assert.strictEqual(service.connectionState.get().mode, 'polling');
		assert.strictEqual(service.connectionState.get().writesEnabled, false);
	});

	test('auth/protocol failures do not degrade to polling', async () => {
		const service = disposables.add(createDesktopHarnessService(os.tmpdir()));
		const mutable = service as unknown as IMutableHarnessService;
		let pollingStarted = false;

		mutable.connectDaemon = async () => {
			throw new HarnessDaemonProtocolError('bad contract');
		};
		mutable.startPolling = async () => {
			pollingStarted = true;
		};

		await assert.rejects(
			() => service.connect(URI.file('/workspace')),
			error => error instanceof HarnessDaemonProtocolError && error.message === 'bad contract',
		);

		assert.strictEqual(pollingStarted, false);
		assert.strictEqual(service.connectionState.get().state, HarnessConnectionState.Error);
		assert.strictEqual(service.connectionState.get().mode, 'none');
		assert.strictEqual(service.connectionState.get().writesEnabled, false);
		assert.strictEqual(service.connectionState.get().errorMessage, 'bad contract');
	});

	test('fabric identity mismatch fails closed and does not poll', async () => {
		const fixture = await createDaemonFixture();
		const otherProjectRoot = join(dirname(fixture.workspaceRoot), 'other-project');
		await fs.mkdir(otherProjectRoot, { recursive: true });
		const service = disposables.add(createDesktopHarnessService(fixture.homeRoot));
		const mutable = service as unknown as IMutableHarnessService;
		let pollingStarted = false;
		const server = await startMockHarnessDaemon({
			socketPath: fixture.socketPath,
			initializeResult: createHarnessInitializeResult({
				fabric_identity: {
					...fixture.fabricIdentity,
					repo_root: otherProjectRoot,
				},
			}),
		});

		const originalStartPolling = mutable.startPolling.bind(service);
		mutable.startPolling = async workspaceRoot => {
			pollingStarted = true;
			return originalStartPolling(workspaceRoot);
		};

		try {
			await assert.rejects(
				() => service.connect(URI.file(fixture.workspaceRoot)),
				error => error instanceof HarnessDaemonProtocolError
					&& error.message.includes('does not match workspace'),
			);
			assert.strictEqual(pollingStarted, false);
			assert.strictEqual(service.connectionState.get().mode, 'none');
			assert.strictEqual(service.connectionState.get().state, HarnessConnectionState.Error);
		} finally {
			await server.dispose();
			await fixture.dispose();
		}
	});

	test('daemon mode reports a partial write subset truthfully', async () => {
		const fixture = await createDaemonFixture();
		const server = await startMockHarnessDaemon({
			socketPath: fixture.socketPath,
			initializeResult: createWriteEnabledInitializeResult({
				granted_capabilities: Object.freeze(['read', 'control', 'dispatch'] as const),
				supportedWriteMethods: Object.freeze(['control.pause', 'control.cancel', 'dispatch.submit'] as const),
				fabric_identity: fixture.fabricIdentity,
			}),
			objectiveListResult: createObjectiveListResult({ objectives: Object.freeze([]) }),
			reviewListResult: createReviewListResult({ reviews: Object.freeze([]) }),
			mergeListResult: createMergeListResult({ entries: Object.freeze([]) }),
			taskListResult: createTaskListResult({ roots: Object.freeze([]) }),
			taskTreeResult: createTaskTreeResult({ nodes: Object.freeze([]) }),
		});
		const service = disposables.add(createDesktopHarnessService(fixture.homeRoot));
		try {
			await service.connect(URI.file(fixture.workspaceRoot));

			const state = service.connectionState.get();
			assert.strictEqual(state.mode, 'daemon');
			assert.strictEqual(state.writesEnabled, true);
			assert.deepStrictEqual(state.supportedWriteMethods, ['control.pause', 'control.cancel', 'dispatch.submit']);
			assert.deepStrictEqual(state.fabricIdentity, fixture.fabricIdentity);
			assert.deepStrictEqual(state.grantedCapabilities, ['read', 'control', 'dispatch']);
		} finally {
			await service.disconnect();
			await server.dispose();
			await fixture.dispose();
		}
	});

	test('delegates the shipped daemon write subset and keeps state truthful', async () => {
		const fixture = await createDaemonFixture();
		const reviewRecord = createReviewCandidateRecord({ dispatch_id: 'disp-review-1' });
		const mergeEntry = createMergeQueueRecord({ dispatch_id: 'disp-review-1', task_id: 'TASK-ROOT-1' });
		const objective = createObjectiveRecord({
			spec: {
				objective_id: 'OBJ-SUBMIT',
				problem_statement: 'Ship wave d',
			},
			root_task_id: 'TASK-ROOT-1',
		});
		const server = await startMockHarnessDaemon({
			socketPath: fixture.socketPath,
			initializeResult: createWriteEnabledInitializeResult({
				granted_capabilities: Object.freeze(['read', 'control', 'dispatch', 'review', 'merge'] as const),
				supportedWriteMethods: Object.freeze([
					'control.pause',
					'control.cancel',
					'dispatch.submit',
					'objective.submit',
					'review.gate_verdict',
					'review.authorize_promotion',
					'review.enqueue_merge',
				] as const),
				fabric_identity: fixture.fabricIdentity,
			}),
			objectiveListResult: createObjectiveListResult({ objectives: Object.freeze([]) }),
			objectiveDetail: createObjectiveDetail({ objective }),
			objectiveSubmitResult: createObjectiveSubmitResult({
				objective_id: 'OBJ-SUBMIT',
				root_task_id: 'TASK-ROOT-1',
				dispatch_id: 'disp-objective-submit',
			}),
			reviewListResult: createReviewListResult({ reviews: Object.freeze([reviewRecord]) }),
			reviewGateVerdictResult: createReviewGateVerdictResult({
				dispatch_id: 'disp-review-1',
				review: createReviewCandidateRecord({
					dispatch_id: 'disp-review-1',
					judge_decision: 'go',
					review_state: 'review_go',
					reviewed_by_role: 'axiom-judge',
				}),
			}),
			reviewAuthorizePromotionResult: createReviewAuthorizePromotionResult({
				dispatch_id: 'disp-review-1',
				review: createReviewCandidateRecord({
					dispatch_id: 'disp-review-1',
					promotion_state: 'promotion_authorized',
					promotion_authorized_by_role: 'axiom-planner',
				}),
			}),
			reviewEnqueueMergeResult: createReviewEnqueueMergeResult({
				dispatch_id: 'disp-review-1',
				entry: mergeEntry,
			}),
			mergeListResult: createMergeListResult({ entries: Object.freeze([]) }),
			dispatchSubmitResult: createDispatchSubmitResult({
				dispatch_id: 'disp-dispatch-submit',
				task_id: 'TASK-ROOT-1',
				role_id: 'axiom-worker',
			}),
			taskListResult: createTaskListResult({
				roots: Object.freeze([
					{
						task: createTaskNode({ task_id: 'TASK-ROOT-1', parent_task_id: null, status: 'running' }),
						latest_dispatch: createQueueDispatch({
							dispatch_id: 'disp-existing',
							task_id: 'TASK-ROOT-1',
							role_id: 'axiom-worker',
							priority: 'p2',
						}),
					},
				]),
			}),
			taskTreeResult: createTaskTreeResult({
				root_task_id: 'TASK-ROOT-1',
				objective,
				nodes: Object.freeze([
					{
						task: createTaskNode({ task_id: 'TASK-ROOT-1', parent_task_id: null, status: 'running' }),
						latest_dispatch: createQueueDispatch({
							dispatch_id: 'disp-existing',
							task_id: 'TASK-ROOT-1',
							role_id: 'axiom-worker',
							priority: 'p2',
						}),
					},
				]),
			}),
			taskDetail: createTaskDetail({
				task: createTaskNode({ task_id: 'TASK-ROOT-1', parent_task_id: null, status: 'running' }),
				root_task_id: 'TASK-ROOT-1',
				objective,
				latest_dispatch: createQueueDispatch({
					dispatch_id: 'disp-existing',
					task_id: 'TASK-ROOT-1',
					role_id: 'axiom-worker',
					priority: 'p2',
				}),
			}),
		});
		const service = disposables.add(createDesktopHarnessService(fixture.homeRoot));
		try {
			await service.connect(URI.file(fixture.workspaceRoot));

			await service.pauseAgent('disp-pause-1');
			await service.cancelAgent('disp-cancel-1');
			const objectiveId = await service.submitObjective('Ship wave d', {
				priority: 'p1' as AtlasModel.WireDispatchPriority,
				contextPaths: Object.freeze(['src/vs/sessions']),
				constraints: Object.freeze(['stay read-only in UI']),
				desiredOutcomes: Object.freeze(['bridge writes']),
				successCriteria: Object.freeze(['tests pass']),
				playbookIds: Object.freeze(['implementation']),
				operatorNotes: Object.freeze(['note']),
				budgetCeilingUsd: 10,
				maxParallelWorkers: 2,
			});
			const dispatchId = await service.submitDispatch({
				role_id: 'axiom-worker',
				task_id: 'TASK-ROOT-1',
				message: 'Implement the bounded bridge write subset.',
				skip_gates: false,
			});
			await service.recordGateVerdict('disp-review-1', 'go' as AtlasModel.ReviewDecision, 'axiom-judge');
			await service.authorizePromotion('disp-review-1', 'axiom-planner');
			await service.enqueueForMerge('disp-review-1');

			assert.strictEqual(objectiveId, 'OBJ-SUBMIT');
			assert.strictEqual(dispatchId, 'disp-dispatch-submit');
			assert.ok(service.objectives.get().some(item => item.objectiveId === 'OBJ-SUBMIT'));
			assert.ok(service.reviewGates.get().some(item => item.dispatchId === 'disp-review-1'));
			assert.ok(service.mergeQueue.get().some(item => item.dispatchId === 'disp-review-1'));

			const writeRequests = server.requests.filter(request => [
				'control.pause',
				'control.cancel',
				'objective.submit',
				'dispatch.submit',
				'review.gate_verdict',
				'review.authorize_promotion',
				'review.enqueue_merge',
			].includes(request.method));
			assert.deepStrictEqual(writeRequests.map(request => request.method), [
				'control.pause',
				'control.cancel',
				'objective.submit',
				'dispatch.submit',
				'review.gate_verdict',
				'review.authorize_promotion',
				'review.enqueue_merge',
			]);

			assert.deepStrictEqual(writeRequests[0].params, { dispatch_id: 'disp-pause-1' });
			assert.deepStrictEqual(writeRequests[1].params, { dispatch_id: 'disp-cancel-1' });
			assert.deepStrictEqual(writeRequests[2].params, {
				summary: 'Ship wave d',
				priority: 'p1',
				context_paths: ['src/vs/sessions'],
				playbooks: ['implementation'],
				desired_outcomes: ['bridge writes'],
				constraints: ['stay read-only in UI'],
				success_criteria: ['tests pass'],
				operator_notes: ['note'],
				budget_ceiling_usd: 10,
				max_parallel_workers: 2,
			});
			assert.deepStrictEqual(writeRequests[4].params, {
				dispatch_id: 'disp-review-1',
				decision: 'go',
				reviewed_by_role: 'axiom-judge',
			});
			assert.deepStrictEqual(writeRequests[5].params, {
				dispatch_id: 'disp-review-1',
				authorized_by_role: 'axiom-planner',
			});
			assert.deepStrictEqual(writeRequests[6].params, { dispatch_id: 'disp-review-1' });

			const dispatchParams = writeRequests[3].params as { readonly packet_path: string; readonly metadata: Record<string, unknown> };
			assert.strictEqual(typeof dispatchParams.packet_path, 'string');
			assert.strictEqual(dispatchParams.metadata['source'], 'atlas-ide');
			assert.strictEqual(dispatchParams.metadata['from_role'], 'axiom-planner');
			assert.strictEqual(dispatchParams.metadata['skip_gates'], false);
			const packetRaw = await fs.readFile(dispatchParams.packet_path, 'utf8');
			const packet = JSON.parse(packetRaw) as Record<string, unknown>;
			assert.strictEqual(packet['task_id'], 'TASK-ROOT-1');
			assert.strictEqual(packet['from_role'], 'axiom-planner');
			assert.strictEqual(packet['to_role'], 'axiom-worker');
			assert.strictEqual(packet['summary'], 'Implement the bounded bridge write subset.');
			assert.deepStrictEqual(packet['acceptance'], ['Implement the bounded bridge write subset.']);
		} finally {
			await service.disconnect();
			await server.dispose();
			await fixture.dispose();
		}
	});

	test('submitDispatch fails closed when command.task_id is missing', async () => {
		const fixture = await createDaemonFixture();
		const server = await startMockHarnessDaemon({
			socketPath: fixture.socketPath,
			initializeResult: createWriteEnabledInitializeResult({
				granted_capabilities: Object.freeze(['read', 'dispatch'] as const),
				supportedWriteMethods: Object.freeze(['dispatch.submit'] as const),
				fabric_identity: fixture.fabricIdentity,
			}),
			objectiveListResult: createObjectiveListResult({ objectives: Object.freeze([]) }),
			reviewListResult: createReviewListResult({ reviews: Object.freeze([]) }),
			mergeListResult: createMergeListResult({ entries: Object.freeze([]) }),
			taskListResult: createTaskListResult({ roots: Object.freeze([]) }),
			taskTreeResult: createTaskTreeResult({ nodes: Object.freeze([]) }),
		});
		const service = disposables.add(createDesktopHarnessService(fixture.homeRoot));
		try {
			await service.connect(URI.file(fixture.workspaceRoot));
			await assert.rejects(
				() => service.submitDispatch({
					role_id: 'axiom-worker',
					message: 'Missing task id should fail closed.',
					skip_gates: false,
				}),
				errorMessage('Current harness daemon dispatch.submit requires command.task_id.'),
			);
			assert.strictEqual(server.requests.some(request => request.method === 'dispatch.submit'), false);
		} finally {
			await service.disconnect();
			await server.dispose();
			await fixture.dispose();
		}
	});

	test('submitDispatch fails closed when skip_gates is requested', async () => {
		const fixture = await createDaemonFixture();
		const server = await startMockHarnessDaemon({
			socketPath: fixture.socketPath,
			initializeResult: createWriteEnabledInitializeResult({
				granted_capabilities: Object.freeze(['read', 'dispatch'] as const),
				supportedWriteMethods: Object.freeze(['dispatch.submit'] as const),
				fabric_identity: fixture.fabricIdentity,
			}),
			objectiveListResult: createObjectiveListResult({ objectives: Object.freeze([]) }),
			reviewListResult: createReviewListResult({ reviews: Object.freeze([]) }),
			mergeListResult: createMergeListResult({ entries: Object.freeze([]) }),
			taskListResult: createTaskListResult({ roots: Object.freeze([]) }),
			taskTreeResult: createTaskTreeResult({ nodes: Object.freeze([]) }),
		});
		const service = disposables.add(createDesktopHarnessService(fixture.homeRoot));
		try {
			await service.connect(URI.file(fixture.workspaceRoot));
			await assert.rejects(
				() => service.submitDispatch({
					role_id: 'axiom-worker',
					task_id: 'TASK-ROOT-1',
					message: 'skip_gates should fail closed.',
					skip_gates: true,
				}),
				errorMessage('Current harness daemon dispatch.submit does not honor skip_gates requests.'),
			);
			assert.strictEqual(server.requests.some(request => request.method === 'dispatch.submit'), false);
		} finally {
			await service.disconnect();
			await server.dispose();
			await fixture.dispose();
		}
	});

	test('daemon write methods fail closed when the daemon does not grant required capability', async () => {
		const fixture = await createDaemonFixture();
		const server = await startMockHarnessDaemon({
			socketPath: fixture.socketPath,
			initializeResult: createWriteEnabledInitializeResult({
				granted_capabilities: Object.freeze(['read'] as const),
				supportedWriteMethods: Object.freeze(['control.pause'] as const),
				fabric_identity: fixture.fabricIdentity,
			}),
			objectiveListResult: createObjectiveListResult({ objectives: Object.freeze([]) }),
			reviewListResult: createReviewListResult({ reviews: Object.freeze([]) }),
			mergeListResult: createMergeListResult({ entries: Object.freeze([]) }),
			taskListResult: createTaskListResult({ roots: Object.freeze([]) }),
			taskTreeResult: createTaskTreeResult({ nodes: Object.freeze([]) }),
		});
		const service = disposables.add(createDesktopHarnessService(fixture.homeRoot));
		try {
			await service.connect(URI.file(fixture.workspaceRoot));
			assert.strictEqual(service.connectionState.get().writesEnabled, false);
			assert.deepStrictEqual(service.connectionState.get().supportedWriteMethods, []);
			await assert.rejects(
				() => service.pauseAgent('disp-1'),
				errorMessage('Current harness daemon does not grant control capability for control.pause.'),
			);
		} finally {
			await service.disconnect();
			await server.dispose();
			await fixture.dispose();
		}
	});

	test('unsupported and unshipped write methods stay fail-closed in daemon mode', async () => {
		const fixture = await createDaemonFixture();
		const server = await startMockHarnessDaemon({
			socketPath: fixture.socketPath,
			initializeResult: createWriteEnabledInitializeResult({
				granted_capabilities: Object.freeze(['read', 'control'] as const),
				supportedWriteMethods: Object.freeze(['control.pause'] as const),
				fabric_identity: fixture.fabricIdentity,
			}),
			controlResult: createControlResult({ dispatch_id: 'disp-1' }),
			objectiveListResult: createObjectiveListResult({ objectives: Object.freeze([]) }),
			reviewListResult: createReviewListResult({ reviews: Object.freeze([]) }),
			mergeListResult: createMergeListResult({ entries: Object.freeze([]) }),
			taskListResult: createTaskListResult({ roots: Object.freeze([]) }),
			taskTreeResult: createTaskTreeResult({ nodes: Object.freeze([]) }),
		});
		const service = disposables.add(createDesktopHarnessService(fixture.homeRoot));
		try {
			await service.connect(URI.file(fixture.workspaceRoot));
			await service.pauseAgent('disp-1');
			await assertDesktopWriteFailures(service, {
				pauseAgent: undefined,
				resumeAgent: 'Current harness daemon does not expose control.resume.',
				cancelAgent: 'Current harness daemon does not expose control.cancel.',
				steerAgent: 'Current harness daemon does not expose control.steer.',
				pauseAll: 'Current harness daemon does not expose pauseAll.',
				resumeAll: 'Current harness daemon does not expose resumeAll.',
				submitObjective: 'Current harness daemon does not expose objective.submit.',
				submitDispatch: 'Current harness daemon does not expose dispatch.submit.',
				recordGateVerdict: 'Current harness daemon does not expose review.gate_verdict.',
				authorizePromotion: 'Current harness daemon does not expose review.authorize_promotion.',
				enqueueForMerge: 'Current harness daemon does not expose review.enqueue_merge.',
			});
		} finally {
			await service.disconnect();
			await server.dispose();
			await fixture.dispose();
		}
	});

	test('desktop write methods stay fail-closed in polling mode', async () => {
		const service = disposables.add(createDesktopHarnessService(os.tmpdir()));
		service.connectionState.set(connectionState('polling'), undefined, undefined);
		await assertDesktopWriteFailures(service, {
			pauseAgent: DAEMON_REQUIRED_ERROR,
			resumeAgent: DAEMON_REQUIRED_ERROR,
			cancelAgent: DAEMON_REQUIRED_ERROR,
			steerAgent: DAEMON_REQUIRED_ERROR,
			pauseAll: DAEMON_REQUIRED_ERROR,
			resumeAll: DAEMON_REQUIRED_ERROR,
			submitObjective: DAEMON_REQUIRED_ERROR,
			submitDispatch: DAEMON_REQUIRED_ERROR,
			recordGateVerdict: DAEMON_REQUIRED_ERROR,
			authorizePromotion: DAEMON_REQUIRED_ERROR,
			enqueueForMerge: DAEMON_REQUIRED_ERROR,
		});
	});

	test('browser stub stays disconnected with empty default observables', async () => {
		const service = new BrowserHarnessService();

		assert.strictEqual(service.connectionState.get().state, HarnessConnectionState.Disconnected);
		assert.strictEqual(service.connectionState.get().mode, 'none');
		assert.strictEqual(service.connectionState.get().writesEnabled, false);
		assert.deepStrictEqual(service.connectionState.get().supportedWriteMethods, []);
		assert.deepStrictEqual(service.objectives.get(), []);
		assert.deepStrictEqual(service.swarms.get(), []);
		assert.deepStrictEqual(service.tasks.get(), []);
		assert.deepStrictEqual(service.fleet.get().agents, []);
		assert.strictEqual(service.cost.get().totalSpentUsd, 0);
		assert.deepStrictEqual(service.reviewGates.get(), []);
		assert.deepStrictEqual(service.mergeQueue.get(), []);
		assert.strictEqual(await service.getTaskTree('TASK-ROOT-1'), undefined);
		assert.strictEqual(await service.getMergeEntry('disp-merge-1'), undefined);

		await assert.rejects(
			() => service.pauseAgent('disp-web'),
			error => error instanceof Error && error.message === WEB_UNAVAILABLE_ERROR,
		);
		await assert.rejects(
			() => service.submitDispatch({ role_id: 'worker', message: 'noop', skip_gates: false }),
			error => error instanceof Error && error.message === WEB_UNAVAILABLE_ERROR,
		);
	});
});

interface IMutableHarnessService {
	connectDaemon(workspaceRoot: URI): Promise<void>;
	startPolling(workspaceRoot: URI, preferredDbPath?: string): Promise<void>;
}

function createDesktopHarnessService(userHomePath: string): DesktopHarnessService {
	return new DesktopHarnessService(
		{ userHome: URI.file(userHomePath) } as ConstructorParameters<typeof DesktopHarnessService>[0],
		new NullLogService(),
		{ version: '1.0.0' } as IProductService,
	);
}

function connectionState(mode: 'daemon' | 'polling') {
	return {
		state: HarnessConnectionState.Connected,
		mode,
		writesEnabled: false,
		supportedWriteMethods: Object.freeze([]),
		fabricIdentity: undefined,
		daemonVersion: mode === 'daemon' ? '0.1.0-test' : undefined,
		schemaVersion: mode === 'daemon' ? '2026-03-01' : undefined,
		grantedCapabilities: mode === 'daemon' ? Object.freeze(['read']) : Object.freeze([]),
		errorMessage: undefined,
	} as const;
}

async function assertDesktopWriteFailures(
	service: DesktopHarnessService,
	expectedMessages: Record<
		| 'pauseAgent'
		| 'resumeAgent'
		| 'cancelAgent'
		| 'steerAgent'
		| 'pauseAll'
		| 'resumeAll'
		| 'submitObjective'
		| 'submitDispatch'
		| 'recordGateVerdict'
		| 'authorizePromotion'
		| 'enqueueForMerge',
		string | undefined
	>,
): Promise<void> {
	await assertFailureOrSkip(() => service.pauseAgent('disp-1'), expectedMessages.pauseAgent);
	await assertFailureOrSkip(() => service.resumeAgent('disp-1'), expectedMessages.resumeAgent);
	await assertFailureOrSkip(() => service.cancelAgent('disp-1'), expectedMessages.cancelAgent);
	await assertFailureOrSkip(() => service.steerAgent('disp-1', 'msg'), expectedMessages.steerAgent);
	await assertFailureOrSkip(() => service.pauseAll(), expectedMessages.pauseAll);
	await assertFailureOrSkip(() => service.resumeAll(), expectedMessages.resumeAll);
	await assertFailureOrSkip(() => service.submitObjective('problem'), expectedMessages.submitObjective);
	await assertFailureOrSkip(
		() => service.submitDispatch({ role_id: 'worker', task_id: 'TASK-ROOT-1', message: 'noop', skip_gates: false }),
		expectedMessages.submitDispatch,
	);
	await assertFailureOrSkip(
		() => service.recordGateVerdict('disp-1', 'go' as AtlasModel.ReviewDecision, 'axiom-judge'),
		expectedMessages.recordGateVerdict,
	);
	await assertFailureOrSkip(
		() => service.authorizePromotion('disp-1', 'axiom-planner'),
		expectedMessages.authorizePromotion,
	);
	await assertFailureOrSkip(
		() => service.enqueueForMerge('disp-1'),
		expectedMessages.enqueueForMerge,
	);
}

function errorMessage(expected: string) {
	return (error: unknown) => error instanceof Error && error.message === expected;
}

async function assertFailureOrSkip(factory: () => Promise<unknown>, expected: string | undefined): Promise<void> {
	if (expected === undefined) {
		await factory();
		return;
	}
	await assert.rejects(factory, errorMessage(expected));
}

function createWriteEnabledInitializeResult(overrides: {
	readonly granted_capabilities: readonly HarnessCapability[];
	readonly supportedWriteMethods: readonly HarnessSupportedWriteMethod[];
	readonly fabric_identity?: IHarnessFabricIdentity;
}) {
	return createHarnessInitializeResult({
		granted_capabilities: overrides.granted_capabilities,
		fabric_identity: overrides.fabric_identity,
		supported_methods: Object.freeze([
			'initialize',
			...new Set([
				...createHarnessInitializeResult().supported_methods,
				...overrides.supportedWriteMethods,
			]),
		]),
	});
}

async function createDaemonFixture() {
	const tempRoot = process.platform === 'win32' ? os.tmpdir() : '/tmp';
	const testRoot = await fs.mkdtemp(join(tempRoot, 'atlas-hs-wave-c-'));
	const workspaceRoot = join(testRoot, 'ws');
	const homeRoot = join(testRoot, 'home');
	const socketPath = join(workspaceRoot, '.codex', 'harness.sock');
	await fs.mkdir(dirname(socketPath), { recursive: true });
	await fs.mkdir(join(homeRoot, '.codex'), { recursive: true });
	await fs.mkdir(join(workspaceRoot, '.codex', 'artifacts'), { recursive: true });
	await fs.mkdir(join(workspaceRoot, '.codex', 'workspace-comms'), { recursive: true });
	await fs.writeFile(join(homeRoot, '.codex', 'atlas-daemon-token'), 'token\n');
	await fs.writeFile(join(workspaceRoot, 'router.db'), '');
	await fs.writeFile(join(workspaceRoot, '.codex', 'workspace-comms', 'metrics.jsonl'), '');

	return {
		testRoot,
		workspaceRoot,
		homeRoot,
		socketPath,
		fabricIdentity: {
			fabric_id: 'fabric-wave-c',
			repo_root: workspaceRoot,
			db_path: join(workspaceRoot, 'router.db'),
			harness_home: workspaceRoot,
			artifact_dir: join(workspaceRoot, '.codex', 'artifacts'),
			metrics_path: join(workspaceRoot, '.codex', 'workspace-comms', 'metrics.jsonl'),
		},
		async dispose() {
			await fs.rm(testRoot, { recursive: true, force: true });
		},
	};
}

async function waitFor(predicate: () => boolean, attempts = 20): Promise<void> {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	assert.fail('Timed out waiting for harness state update.');
}
