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
	IHarnessInitializeResult,
	IPingResult,
	IQueueState,
	ISubscriptionAck,
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
	readonly subscriptionAck?: ISubscriptionAck;
	readonly requestHandler?: (request: IMockHarnessRequest) => Promise<IMockHarnessDaemonReply | undefined> | IMockHarnessDaemonReply | undefined;
}

export interface IMockHarnessDaemonServer {
	readonly socketPath: string;
	readonly requests: readonly IMockHarnessRequest[];
	dispose(): Promise<void>;
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

export async function startMockHarnessDaemon(options: IMockHarnessDaemonOptions = {}): Promise<IMockHarnessDaemonServer> {
	const ownedRoot = options.socketPath ? undefined : await fs.mkdtemp(join(os.tmpdir(), 'atlas-harness-test-'));
	const socketPath = options.socketPath ?? join(ownedRoot!, 'harness.sock');
	const requests: IMockHarnessRequest[] = [];

	await fs.mkdir(dirname(socketPath), { recursive: true });
	await fs.rm(socketPath, { force: true });

	const server = net.createServer(socket => {
		let readBuffer = '';
		socket.setEncoding('utf8');

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
				return {
					result: options.subscriptionAck ?? {
						subscription_id: 'sub-000001',
						head_seq: 3,
						resumed: false,
						resync_required: false,
					},
				};
			case 'fleet.unsubscribe':
				return { result: { removed: true } };
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
