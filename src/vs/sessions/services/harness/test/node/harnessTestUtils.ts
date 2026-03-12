/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import { dirname, join } from '../../../../../base/common/path.js';
import {
	HARNESS_JSONRPC_VERSION,
	HARNESS_PROTOCOL_VERSION,
	HARNESS_REQUIRED_DAEMON_METHODS,
	HARNESS_SCHEMA_VERSION,
} from '../../common/harnessProtocol.js';
import type {
	IDaemonHealthState,
	IFleetDeltaNotification,
	IFleetSnapshotResult,
	IFleetWorkerState,
	IHealthResult,
	IHarnessInitializeResult,
	IMergeListResult,
	IMergeQueueRecord,
	IObjectiveDetail,
	IObjectiveListResult,
	IObjectiveRecord,
	IPingResult,
	IQueueDispatch,
	IQueueState,
	IReviewCandidateRecord,
	IReviewListResult,
	ISubscriptionAck,
	ITaskDetail,
	ITaskListResult,
	ITaskNode,
	ITaskTreeResult,
} from '../../common/harnessTypes.js';

export interface IMockHarnessRequest {
	readonly id: number | string | null | undefined;
	readonly method: string;
	readonly params: unknown;
}

export interface IMockHarnessDaemonReply {
	readonly result?: unknown;
	readonly error?: {
		readonly code: number;
		readonly message: string;
		readonly data?: unknown;
	};
	readonly close?: boolean;
}

export interface IMockHarnessDaemonOptions {
	readonly socketPath?: string;
	readonly initializeResult?: IHarnessInitializeResult;
	readonly pingResult?: unknown;
	readonly fleetSnapshotResult?: IFleetSnapshotResult;
	readonly healthResult?: IHealthResult;
	readonly objectiveListResult?: IObjectiveListResult;
	readonly objectiveDetail?: IObjectiveDetail;
	readonly reviewListResult?: IReviewListResult;
	readonly reviewRecord?: IReviewCandidateRecord;
	readonly mergeListResult?: IMergeListResult;
	readonly mergeRecord?: IMergeQueueRecord;
	readonly taskListResult?: ITaskListResult;
	readonly taskTreeResult?: ITaskTreeResult;
	readonly taskDetail?: ITaskDetail;
	readonly subscriptionAck?: ISubscriptionAck;
	readonly requestHandler?: (request: IMockHarnessRequest) => Promise<IMockHarnessDaemonReply | undefined> | IMockHarnessDaemonReply | undefined;
}

export interface IMockHarnessDaemonServer {
	readonly socketPath: string;
	readonly requests: readonly IMockHarnessRequest[];
	dispose(): Promise<void>;
	notify(method: string, params: unknown): Promise<void>;
}

export function createHarnessInitializeResult(overrides: Partial<IHarnessInitializeResult> = {}): IHarnessInitializeResult {
	return {
		protocol_version: HARNESS_PROTOCOL_VERSION,
		daemon_info: {
			name: 'syntropic-daemon',
			version: '0.1.0-test',
			harness_version: '0.1.0-test',
			...overrides.daemon_info,
		},
		schema_version: HARNESS_SCHEMA_VERSION,
		client_id: 'atlas-0001',
		resolved_identity: 'operator:test',
		granted_capabilities: Object.freeze(['read']),
		fabric_identity: {
			fabric_id: 'fabric-test-1',
			repo_root: '/tmp/atlas-workspace',
			db_path: '/tmp/atlas-workspace/router.db',
			harness_home: '/tmp/atlas-workspace',
			artifact_dir: '/tmp/atlas-workspace/.codex/artifacts',
			metrics_path: '/tmp/atlas-workspace/.codex/workspace-comms/metrics.jsonl',
			...overrides.fabric_identity,
		},
		supported_methods: Object.freeze(['initialize', ...HARNESS_REQUIRED_DAEMON_METHODS]),
		limits: {
			max_message_bytes: 4 * 1024 * 1024,
			max_subscriptions: 64,
			max_pending_notifications: 4096,
			...overrides.limits,
		},
		...overrides,
	};
}

export function createHarnessPingResult(overrides: Partial<IPingResult> = {}): IPingResult {
	return {
		uptime_ms: 1_000,
		active_clients: 1,
		schema_version: HARNESS_SCHEMA_VERSION,
		...overrides,
	};
}

export function createFleetWorkerState(overrides: Partial<IFleetWorkerState> = {}): IFleetWorkerState {
	return {
		dispatch_id: 'disp-1',
		task_id: 'task-1',
		role_id: 'planner',
		state: 'executing',
		started_at: '2026-03-11T12:00:00.000Z',
		last_heartbeat_at: '2026-03-11T12:00:05.000Z',
		...overrides,
	};
}

export function createQueueState(overrides: Partial<IQueueState> = {}): IQueueState {
	return {
		dispatch_queue_depth: 0,
		merge_queue_depth: 0,
		merge_conflicts: 0,
		pending_workspace_events: 0,
		...overrides,
	};
}

export function createDaemonHealthState(overrides: Partial<IDaemonHealthState> = {}): IDaemonHealthState {
	return {
		mode: 'normal',
		disk_usage_pct: 12,
		memory_usage_pct: 34,
		wal_size_bytes: 512,
		active_workers: 1,
		queue_depth: 0,
		last_health_check: '2026-03-11T12:00:06.000Z',
		...overrides,
	};
}

export function createHealthResult(overrides: Partial<IHealthResult> = {}): IHealthResult {
	return {
		seq: 3,
		health: createDaemonHealthState(),
		...overrides,
	};
}

export function createFleetSnapshotResult(
	overrides: Omit<Partial<IFleetSnapshotResult>, 'snapshot'> & {
		readonly snapshot?: Partial<IFleetSnapshotResult['snapshot']>;
	} = {},
): IFleetSnapshotResult {
	const { snapshot: snapshotOverrides, ...resultOverrides } = overrides;
	return {
		seq: 3,
		snapshot: {
			captured_at: '2026-03-11T12:00:06.000Z',
			workers: Object.freeze([createFleetWorkerState()]),
			queue: createQueueState(),
			health: createDaemonHealthState(),
			...snapshotOverrides,
		},
		...resultOverrides,
	};
}

export function createFleetDeltaNotification(
	overrides: Partial<IFleetDeltaNotification> = {},
): IFleetDeltaNotification {
	return {
		seq: 4,
		subscription_id: 'sub-000001',
		captured_at: '2026-03-11T12:00:07.000Z',
		added: Object.freeze([]),
		removed: Object.freeze([]),
		changed: Object.freeze([]),
		queue: createQueueState(),
		health: createDaemonHealthState(),
		...overrides,
	};
}

export function createObjectiveRecord(
	overrides: Omit<Partial<IObjectiveRecord>, 'spec'> & { readonly spec?: Partial<IObjectiveRecord['spec']> } = {},
): IObjectiveRecord {
	const { spec: specOverrides, ...recordOverrides } = overrides;
	return {
		spec: {
			objective_id: 'OBJ-1',
			created_at: '2026-03-11T12:00:00.000Z',
			problem_statement: 'Ship wave c',
			desired_outcomes: Object.freeze(['ship']),
			constraints: Object.freeze(['do not fake writes']),
			context_paths: Object.freeze(['src/vs/sessions']),
			success_criteria: Object.freeze(['green']),
			playbook_ids: Object.freeze(['implementation']),
			priority: 'p1',
			operator_notes: Object.freeze(['note']),
			...specOverrides,
		} as IObjectiveRecord['spec'],
		status: 'executing',
		root_task_id: 'TASK-ROOT-1',
		resume_count: 0,
		max_resume_cycles: 3,
		created_at: '2026-03-11T12:00:00.000Z',
		updated_at: '2026-03-11T12:05:00.000Z',
		...recordOverrides,
	};
}

export function createObjectiveListResult(overrides: Partial<IObjectiveListResult> = {}): IObjectiveListResult {
	return {
		seq: 5,
		objectives: Object.freeze([createObjectiveRecord()]),
		...overrides,
	};
}

export function createTaskNode(overrides: Partial<ITaskNode> = {}): ITaskNode {
	return {
		task_id: 'TASK-ROOT-1',
		parent_task_id: null,
		depth: 0,
		status: 'running',
		aggregation_strategy: null,
		created_at: '2026-03-11T12:00:00.000Z',
		completed_at: null,
		...overrides,
	};
}

export function createQueueDispatch(overrides: Partial<IQueueDispatch> = {}): IQueueDispatch {
	return {
		dispatch_id: 'disp-1',
		idempotency_key: 'idem-1',
		task_id: 'TASK-ROOT-1',
		role_id: 'planner',
		priority: 'p1',
		handoff_type: 'planning',
		metadata: { source: 'test' },
		...overrides,
	};
}

export function createObjectiveDetail(overrides: Partial<IObjectiveDetail> = {}): IObjectiveDetail {
	return {
		objective: createObjectiveRecord(),
		task_graph: Object.freeze([createTaskNode()]),
		...overrides,
	};
}

export function createReviewCandidateRecord(overrides: Partial<IReviewCandidateRecord> = {}): IReviewCandidateRecord {
	return {
		dispatch_id: 'disp-review-1',
		task_id: 'TASK-ROOT-1',
		role_id: 'judge',
		candidate_branch: 'feature/wave-c',
		base_ref: 'main',
		base_head_sha: 'aaaa',
		merge_base_sha: 'bbbb',
		reviewed_head_sha: 'cccc',
		commit_shas: Object.freeze(['cccc']),
		artifact_bundle_dir: '/tmp/artifacts',
		result_packet_path: '/tmp/result.json',
		handoff_path: '/tmp/handoff.json',
		dispatch_run_path: null,
		materialization_kind: 'worktree',
		materialization_path: '/tmp/worktree',
		commit_evidence_path: '/tmp/evidence',
		working_tree_clean: true,
		review_state: 'awaiting_review',
		judge_decision: null,
		reviewed_by_role: null,
		reviewed_at: null,
		promotion_state: 'not_requested',
		promotion_authorized_at: null,
		promotion_authorized_by_role: null,
		integration_state: 'not_ready',
		merged_sha: null,
		merge_executor_id: null,
		merged_at: null,
		state_reason: null,
		created_at: '2026-03-11T12:01:00.000Z',
		updated_at: '2026-03-11T12:02:00.000Z',
		...overrides,
	};
}

export function createReviewListResult(overrides: Partial<IReviewListResult> = {}): IReviewListResult {
	return {
		seq: 6,
		reviews: Object.freeze([createReviewCandidateRecord()]),
		...overrides,
	};
}

export function createMergeQueueRecord(overrides: Partial<IMergeQueueRecord> = {}): IMergeQueueRecord {
	return {
		dispatch_id: 'disp-merge-1',
		task_id: 'TASK-ROOT-1',
		worktree_path: '/tmp/worktree',
		candidate_branch: 'feature/wave-c',
		base_ref: 'main',
		base_head_sha: 'aaaa',
		merge_base_sha: 'bbbb',
		reviewed_head_sha: 'cccc',
		artifact_bundle_dir: '/tmp/artifacts',
		result_packet_path: '/tmp/result.json',
		dispatch_run_path: null,
		materialization_kind: 'worktree',
		materialization_path: '/tmp/worktree',
		commit_evidence_path: '/tmp/evidence',
		priority: 1,
		enqueued_at: '2026-03-11T12:03:00.000Z',
		status: 'pending',
		merge_sha: null,
		conflict_details: null,
		affected_paths: null,
		judge_decision: 'go' as AtlasModel.ReviewDecision,
		reviewed_by_role: 'judge',
		reviewed_at: '2026-03-11T12:04:00.000Z',
		promotion_authorized_at: '2026-03-11T12:04:30.000Z',
		promotion_authorized_by_role: 'planner',
		merge_executor_id: null,
		merged_at: null,
		blocked_reason: null,
		...overrides,
	};
}

export function createMergeListResult(overrides: Partial<IMergeListResult> = {}): IMergeListResult {
	return {
		seq: 7,
		entries: Object.freeze([createMergeQueueRecord()]),
		...overrides,
	};
}

export function createTaskListResult(overrides: Partial<ITaskListResult> = {}): ITaskListResult {
	return {
		roots: Object.freeze([
			{
				task: createTaskNode(),
				objective: createObjectiveRecord(),
				latest_dispatch: createQueueDispatch(),
			},
		]),
		...overrides,
	};
}

export function createTaskTreeResult(overrides: Partial<ITaskTreeResult> = {}): ITaskTreeResult {
	return {
		root_task_id: 'TASK-ROOT-1',
		objective: createObjectiveRecord(),
		nodes: Object.freeze([
			{
				task: createTaskNode(),
				latest_dispatch: createQueueDispatch(),
			},
			{
				task: createTaskNode({
					task_id: 'TASK-CHILD-1',
					parent_task_id: 'TASK-ROOT-1',
					depth: 1,
					status: 'pending',
				}),
				latest_dispatch: createQueueDispatch({
					dispatch_id: 'disp-child-1',
					task_id: 'TASK-CHILD-1',
					role_id: 'worker',
					handoff_type: 'implementation',
					priority: 'p2',
				}),
			},
		]),
		...overrides,
	};
}

export function createTaskDetail(overrides: Partial<ITaskDetail> = {}): ITaskDetail {
	return {
		task: createTaskNode(),
		root_task_id: 'TASK-ROOT-1',
		objective: createObjectiveRecord(),
		latest_dispatch: createQueueDispatch(),
		subtasks: Object.freeze([
			createTaskNode({
				task_id: 'TASK-CHILD-1',
				parent_task_id: 'TASK-ROOT-1',
				depth: 1,
				status: 'pending',
			}),
		]),
		latest_dispatch_timeline: Object.freeze([
			{
				dispatch_id: 'disp-1',
				task_id: 'TASK-ROOT-1',
				role_id: 'planner',
				previous_state: 'queued',
				new_state: 'executing',
				metadata_json: '{"source":"test"}',
				created_at: '2026-03-11T12:00:30.000Z',
			},
		]),
		...overrides,
	};
}

export async function startMockHarnessDaemon(options: IMockHarnessDaemonOptions = {}): Promise<IMockHarnessDaemonServer> {
	const ownedRoot = options.socketPath ? undefined : await fs.mkdtemp(join(os.tmpdir(), 'atlas-harness-test-'));
	const socketPath = options.socketPath ?? join(ownedRoot!, 'harness.sock');
	const requests: IMockHarnessRequest[] = [];
	const sockets = new Set<net.Socket>();

	await fs.mkdir(dirname(socketPath), { recursive: true });
	await fs.rm(socketPath, { force: true });

	const server = net.createServer(socket => {
		sockets.add(socket);
		let readBuffer = '';
		socket.setEncoding('utf8');
		socket.on('close', () => sockets.delete(socket));
		socket.on('error', () => sockets.delete(socket));

		socket.on('data', chunk => {
			readBuffer += chunk;
			let newlineIndex = readBuffer.indexOf('\n');
			while (newlineIndex >= 0) {
				const frame = readBuffer.slice(0, newlineIndex).trim();
				readBuffer = readBuffer.slice(newlineIndex + 1);
				if (frame.length > 0) {
					void handleFrame(frame, socket);
				}
				newlineIndex = readBuffer.indexOf('\n');
			}
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(socketPath, () => {
			server.off('error', reject);
			resolve();
		});
	});

	return {
		socketPath,
		requests,
		async dispose(): Promise<void> {
			for (const socket of sockets) {
				socket.destroy();
			}
			await new Promise<void>((resolve, reject) => {
				server.close(error => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
			await fs.rm(socketPath, { force: true });
			if (ownedRoot) {
				await fs.rm(ownedRoot, { recursive: true, force: true });
			}
		},
		async notify(method: string, params: unknown): Promise<void> {
			const message = JSON.stringify({
				jsonrpc: HARNESS_JSONRPC_VERSION,
				method,
				params,
			}) + '\n';
			for (const socket of sockets) {
				socket.write(message);
			}
		},
	};

	async function handleFrame(frame: string, socket: net.Socket): Promise<void> {
		const request = JSON.parse(frame) as IMockHarnessRequest & { readonly jsonrpc?: string };
		requests.push({
			id: request.id,
			method: request.method,
			params: request.params,
		});

		const customReply = await options.requestHandler?.(request);
		const reply = customReply ?? defaultReply(request);
		if (request.id !== undefined) {
			socket.write(JSON.stringify({
				jsonrpc: HARNESS_JSONRPC_VERSION,
				id: request.id,
				...(reply.error ? { error: reply.error } : { result: reply.result ?? {} }),
			}) + '\n');
		}
		if (reply.close) {
			socket.end();
		}
	}

	function defaultReply(request: IMockHarnessRequest): IMockHarnessDaemonReply {
		switch (request.method) {
			case 'initialize':
				return { result: options.initializeResult ?? createHarnessInitializeResult() };
			case 'daemon.ping':
				return { result: options.pingResult ?? createHarnessPingResult() };
			case 'fleet.snapshot':
				return { result: options.fleetSnapshotResult ?? createFleetSnapshotResult() };
			case 'fleet.subscribe':
			case 'health.subscribe':
			case 'objective.subscribe':
			case 'review.subscribe':
			case 'merge.subscribe':
				return {
					result: options.subscriptionAck ?? {
						subscription_id: `sub-${request.method}`,
						head_seq: 3,
						resumed: false,
						resync_required: false,
					},
				};
			case 'fleet.unsubscribe':
			case 'health.unsubscribe':
			case 'objective.unsubscribe':
			case 'review.unsubscribe':
			case 'merge.unsubscribe':
				return { result: { removed: true } };
			case 'health.get':
				return { result: options.healthResult ?? createHealthResult() };
			case 'objective.list':
				return { result: options.objectiveListResult ?? createObjectiveListResult() };
			case 'objective.get':
				return { result: options.objectiveDetail ?? createObjectiveDetail() };
			case 'review.list':
				return { result: options.reviewListResult ?? createReviewListResult() };
			case 'review.get':
				return { result: options.reviewRecord ?? createReviewCandidateRecord() };
			case 'merge.list':
				return { result: options.mergeListResult ?? createMergeListResult() };
			case 'merge.get':
				return { result: options.mergeRecord ?? createMergeQueueRecord() };
			case 'task.list':
				return { result: options.taskListResult ?? createTaskListResult() };
			case 'task.tree':
				return { result: options.taskTreeResult ?? createTaskTreeResult() };
			case 'task.get':
				return { result: options.taskDetail ?? createTaskDetail() };
			case 'shutdown':
				return { result: {}, close: true };
			default:
				return {
					error: {
						code: -32601,
						message: `unsupported method '${request.method}'`,
					},
				};
		}
	}
}
