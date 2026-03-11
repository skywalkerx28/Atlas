/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-layering, local/code-import-patterns -- Node-side hardening tests intentionally exercise the desktop and web harness bridge implementations directly. */

import assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import { dirname, join } from '../../../../../base/common/path.js';
import { env } from '../../../../../base/common/process.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import type { IProductService } from '../../../../../platform/product/common/productService.js';
import { HarnessConnectionState } from '../../common/harnessService.js';
import { HarnessDaemonProtocolError, HarnessDaemonUnavailableError } from '../../electron-browser/harnessDaemonClient.js';
import { HarnessService as BrowserHarnessService } from '../../browser/harnessService.js';
import { HarnessService as DesktopHarnessService } from '../../electron-browser/harnessService.js';
import { createDaemonHealthState, createFleetSnapshotResult, createFleetWorkerState, startMockHarnessDaemon } from './harnessTestUtils.js';

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

	test('selects daemon mode when daemon connect succeeds', async () => {
		const tempRoot = process.platform === 'win32' ? os.tmpdir() : '/tmp';
		const testRoot = await fs.mkdtemp(join(tempRoot, 'atlas-hs-'));
		const workspaceRoot = join(testRoot, 'ws');
		const homeRoot = join(testRoot, 'home');
		const socketPath = join(workspaceRoot, '.codex', 'harness.sock');
		await fs.mkdir(dirname(socketPath), { recursive: true });
		await fs.mkdir(join(homeRoot, '.codex'), { recursive: true });
		await fs.writeFile(join(homeRoot, '.codex', 'atlas-daemon-token'), 'token\n');

		const server = await startMockHarnessDaemon({
			socketPath,
			fleetSnapshotResult: createFleetSnapshotResult({
				snapshot: {
					workers: Object.freeze([
						createFleetWorkerState({
							dispatch_id: 'disp-service',
							task_id: 'task-service',
							role_id: 'planner',
							state: 'executing',
						}),
					]),
					health: createDaemonHealthState({
						mode: 'normal',
						active_workers: 1,
					}),
				},
			}),
		});

		const service = disposables.add(createDesktopHarnessService(homeRoot));
		try {
			await service.connect(URI.file(workspaceRoot));

			const connectionState = service.connectionState.get();
			assert.strictEqual(connectionState.state, HarnessConnectionState.Connected);
			assert.strictEqual(connectionState.mode, 'daemon');
			assert.strictEqual(connectionState.writesEnabled, false);
			assert.deepStrictEqual(connectionState.grantedCapabilities, ['read']);

			assert.deepStrictEqual(server.requests.map(request => request.method).slice(0, 4), [
				'initialize',
				'daemon.ping',
				'fleet.snapshot',
				'fleet.subscribe',
			]);

			assert.deepStrictEqual(service.objectives.get(), []);
			assert.deepStrictEqual(service.swarms.get(), []);
			assert.deepStrictEqual(service.tasks.get(), []);
			assert.deepStrictEqual(service.advisoryReviewQueue.get(), []);
			assert.deepStrictEqual(service.reviewGates.get(), []);
			assert.deepStrictEqual(service.mergeQueue.get(), []);
			assert.strictEqual(service.cost.get().totalSpentUsd, 0);
			assert.deepStrictEqual(service.cost.get().breakdowns, []);

			const fleet = service.fleet.get();
			assert.strictEqual(fleet.agents.length, 1);
			assert.strictEqual(fleet.agents[0].dispatchId, 'disp-service');
			assert.strictEqual(fleet.agents[0].status, 'running');
			assert.strictEqual((await service.getAgent('disp-service'))?.taskId, 'task-service');
		} finally {
			await service.disconnect();
			assert.deepStrictEqual(server.requests.map(request => request.method).slice(-2), ['fleet.unsubscribe', 'shutdown']);
			await server.dispose();
			await fs.rm(testRoot, { recursive: true, force: true });
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

	test('desktop write methods stay fail-closed in daemon mode', async () => {
		const service = disposables.add(createDesktopHarnessService(os.tmpdir()));
		service.connectionState.set(connectionState('daemon'), undefined, undefined);
		await assertDesktopWriteFailures(service, {
			pauseAgent: 'Current harness daemon does not yet expose control methods.',
			resumeAgent: 'Current harness daemon does not yet expose control methods.',
			cancelAgent: 'Current harness daemon does not yet expose control methods.',
			steerAgent: 'Current harness daemon does not yet expose steer methods.',
			submitObjective: 'Current harness daemon does not yet expose objective methods.',
			submitDispatch: 'Current harness daemon does not yet expose dispatch methods.',
			recordGateVerdict: 'Current harness daemon does not yet expose review methods.',
			authorizePromotion: 'Current harness daemon does not yet expose promotion methods.',
			enqueueForMerge: 'Current harness daemon does not yet expose merge methods.',
		});
	});

	test('desktop write methods stay fail-closed in polling mode', async () => {
		const service = disposables.add(createDesktopHarnessService(os.tmpdir()));
		service.connectionState.set(connectionState('polling'), undefined, undefined);
		await assertDesktopWriteFailures(service, {
			pauseAgent: DAEMON_REQUIRED_ERROR,
			resumeAgent: DAEMON_REQUIRED_ERROR,
			cancelAgent: DAEMON_REQUIRED_ERROR,
			steerAgent: DAEMON_REQUIRED_ERROR,
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
		assert.deepStrictEqual(service.objectives.get(), []);
		assert.deepStrictEqual(service.swarms.get(), []);
		assert.deepStrictEqual(service.tasks.get(), []);
		assert.deepStrictEqual(service.fleet.get().agents, []);
		assert.strictEqual(service.cost.get().totalSpentUsd, 0);
		assert.deepStrictEqual(service.reviewGates.get(), []);
		assert.deepStrictEqual(service.mergeQueue.get(), []);

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
	startPolling(workspaceRoot: URI): Promise<void>;
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
		| 'submitObjective'
		| 'submitDispatch'
		| 'recordGateVerdict'
		| 'authorizePromotion'
		| 'enqueueForMerge',
		string
	>,
): Promise<void> {
	const operations: Array<readonly [keyof typeof expectedMessages, () => Promise<unknown>]> = [
		['pauseAgent', () => service.pauseAgent('disp-1')],
		['resumeAgent', () => service.resumeAgent('disp-1')],
		['cancelAgent', () => service.cancelAgent('disp-1')],
		['steerAgent', () => service.steerAgent('disp-1', 'hello')],
		['submitObjective', () => service.submitObjective('Ship it')],
		['submitDispatch', () => service.submitDispatch({ role_id: 'worker', message: 'echo ok', skip_gates: false })],
		['recordGateVerdict', () => service.recordGateVerdict('disp-1', 'go' as AtlasModel.ReviewDecision, 'judge')],
		['authorizePromotion', () => service.authorizePromotion('disp-1', 'judge')],
		['enqueueForMerge', () => service.enqueueForMerge('disp-1')],
	];

	for (const [name, operation] of operations) {
		await assert.rejects(
			() => operation(),
			error => error instanceof Error && error.message === expectedMessages[name],
			`${name} should fail closed`,
		);
	}
}
