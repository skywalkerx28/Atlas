/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-layering, local/code-import-patterns -- Node-side hardening tests intentionally exercise the desktop bridge implementation directly. */

import assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import { join } from '../../../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { HARNESS_SCHEMA_VERSION } from '../../common/harnessProtocol.js';
import {
	HarnessDaemonClient,
	HarnessDaemonProtocolError,
	HarnessDaemonUnavailableError,
	isHarnessDaemonUnavailableError,
} from '../../electron-browser/harnessDaemonClient.js';
import {
	createHarnessInitializeResult,
	createHarnessPingResult,
	startMockHarnessDaemon,
} from './harnessTestUtils.js';

// eslint-disable-next-line local/code-no-unexternalized-strings -- Exact fail-closed protocol error text is part of the regression contract.
const MISSING_REQUIRED_METHOD_ERROR = "Harness daemon initialize response is missing required method 'task.tree'.";

suite('HarnessDaemonClient', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('connect performs initialize then daemon.ping', async () => {
		const server = await startMockHarnessDaemon();
		const client = disposables.add(new HarnessDaemonClient(new NullLogService()));
		try {
			const result = await client.connect(server.socketPath, {
				protocol_version: '1.0',
				client_info: {
					name: 'atlas-tests',
					version: '1.0.0',
				},
				client_token: 'token',
				requested_capabilities: Object.freeze(['read']),
			});

			assert.strictEqual(result.schema_version, HARNESS_SCHEMA_VERSION);
			assert.deepStrictEqual(server.requests.map(request => request.method), ['initialize', 'daemon.ping']);
			assert.deepStrictEqual(client.grantedCapabilities, ['read']);
			assert.strictEqual(client.fabricIdentity?.fabric_id, 'fabric-test-1');
		} finally {
			await client.shutdown();
			await server.dispose();
		}
	});

	test('connect rejects when initialize omits a required method', async () => {
		const server = await startMockHarnessDaemon({
			initializeResult: createHarnessInitializeResult({
				supported_methods: Object.freeze([
					'initialize',
					'shutdown',
					'daemon.ping',
					'fleet.snapshot',
					'fleet.subscribe',
					'fleet.unsubscribe',
					'health.get',
					'health.subscribe',
					'health.unsubscribe',
					'objective.list',
					'objective.get',
					'objective.subscribe',
					'objective.unsubscribe',
					'review.list',
					'review.get',
					'review.subscribe',
					'review.unsubscribe',
					'merge.list',
					'merge.get',
					'merge.subscribe',
					'merge.unsubscribe',
					'task.get',
					'task.list',
				]),
			}),
		});
		try {
			const client = disposables.add(new HarnessDaemonClient(new NullLogService()));
			await assert.rejects(
				() => client.connect(server.socketPath, connectParams()),
				error => error instanceof HarnessDaemonProtocolError
					&& error.message === MISSING_REQUIRED_METHOD_ERROR,
			);
		} finally {
			await server.dispose();
		}
	});

	test('connect rejects on protocol mismatch', async () => {
		const server = await startMockHarnessDaemon({
			initializeResult: createHarnessInitializeResult({
				protocol_version: '2.0',
			}),
		});
		try {
			const client = disposables.add(new HarnessDaemonClient(new NullLogService()));
			await assert.rejects(
				() => client.connect(server.socketPath, connectParams()),
				error => error instanceof HarnessDaemonProtocolError
					&& error.message === 'Harness daemon protocol mismatch: expected 1.0, got 2.0.',
			);
		} finally {
			await server.dispose();
		}
	});

	test('connect rejects on schema mismatch', async () => {
		const server = await startMockHarnessDaemon({
			initializeResult: createHarnessInitializeResult({
				schema_version: '2026-04-01',
			}),
		});
		try {
			const client = disposables.add(new HarnessDaemonClient(new NullLogService()));
			await assert.rejects(
				() => client.connect(server.socketPath, connectParams()),
				error => error instanceof HarnessDaemonProtocolError
					&& error.message === 'Harness daemon schema mismatch: expected 2026-03-01, got 2026-04-01.',
			);
		} finally {
			await server.dispose();
		}
	});

	test('connect rejects on missing fabric identity', async () => {
		const server = await startMockHarnessDaemon({
			initializeResult: {
				...createHarnessInitializeResult(),
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test intentionally removes required protocol field.
				fabric_identity: undefined as any,
			},
		});
		try {
			const client = disposables.add(new HarnessDaemonClient(new NullLogService()));
			await assert.rejects(
				() => client.connect(server.socketPath, connectParams()),
				error => error instanceof HarnessDaemonProtocolError
					&& error.message === 'Harness daemon initialize response is missing a valid fabric_identity.',
			);
		} finally {
			await server.dispose();
		}
	});

	test('connect rejects on invalid daemon.ping payload', async () => {
		const server = await startMockHarnessDaemon({
			pingResult: createHarnessPingResult({
				active_clients: -1,
			}),
		});
		try {
			const client = disposables.add(new HarnessDaemonClient(new NullLogService()));
			await assert.rejects(
				() => client.connect(server.socketPath, connectParams()),
				error => error instanceof HarnessDaemonProtocolError
					&& error.message === 'Harness daemon ping response is missing a valid active_clients count.',
			);
		} finally {
			await server.dispose();
		}
	});

	test('missing socket path is classified as unavailable but protocol failures are not', async () => {
		const tempDir = await fs.mkdtemp(join(os.tmpdir(), 'atlas-harness-client-'));
		try {
			const client = disposables.add(new HarnessDaemonClient(new NullLogService()));
			const missingSocketPath = join(tempDir, 'missing.sock');
			let unavailableError: unknown;
			try {
				await client.connect(missingSocketPath, connectParams());
				assert.fail('Expected unavailable socket to reject.');
			} catch (error) {
				unavailableError = error;
			}
			assert.ok(unavailableError instanceof HarnessDaemonUnavailableError);
			assert.ok(isHarnessDaemonUnavailableError(unavailableError));

			const server = await startMockHarnessDaemon({
				initializeResult: createHarnessInitializeResult({
					protocol_version: '2.0',
				}),
			});
			try {
				let protocolError: unknown;
				try {
					await client.connect(server.socketPath, connectParams());
					assert.fail('Expected protocol mismatch to reject.');
				} catch (error) {
					protocolError = error;
				}
				assert.ok(protocolError instanceof HarnessDaemonProtocolError);
				assert.ok(!isHarnessDaemonUnavailableError(protocolError));
			} finally {
				await server.dispose();
			}
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});

function connectParams() {
	return {
		protocol_version: '1.0' as const,
		client_info: {
			name: 'atlas-tests',
			version: '1.0.0',
		},
		client_token: 'token',
		requested_capabilities: Object.freeze(['read']) as readonly ['read'],
	};
}
