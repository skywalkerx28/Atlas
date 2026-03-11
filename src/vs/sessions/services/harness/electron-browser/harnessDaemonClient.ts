/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns -- Electron-only bridge uses a native Unix socket transport.
import * as net from 'net';
import { raceTimeout } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import {
	HARNESS_JSONRPC_VERSION,
	HARNESS_PROTOCOL_VERSION,
	HARNESS_REQUIRED_DAEMON_METHODS,
	HARNESS_SCHEMA_VERSION,
	type HarnessDaemonRequestMethod,
	type HarnessRequestParams,
	type HarnessRequestResult,
	type IHarnessDaemonNotification,
	type IHarnessDaemonResponse,
	type IHarnessJsonRpcError,
} from '../common/harnessProtocol.js';
import type { HarnessCapability, IHarnessInitializeParams, IHarnessInitializeResult, IPingResult } from '../common/harnessTypes.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_FRAME_BYTES = 4 * 1024 * 1024;

export class HarnessDaemonUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'HarnessDaemonUnavailableError';
	}
}

export class HarnessDaemonProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'HarnessDaemonProtocolError';
	}
}

export function isHarnessDaemonUnavailableError(error: unknown): error is HarnessDaemonUnavailableError {
	return error instanceof HarnessDaemonUnavailableError;
}

interface IPendingRequest {
	readonly method: HarnessDaemonRequestMethod;
	readonly resolve: (result: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timeoutHandle: ReturnType<typeof setTimeout>;
}

export class HarnessDaemonClient extends Disposable {

	private socket: net.Socket | undefined;
	private readBuffer = '';
	private nextRequestId = 0;
	private maxFrameBytes = DEFAULT_MAX_FRAME_BYTES;
	private didFireDisconnect = false;
	private pendingRequests = new Map<number, IPendingRequest>();
	private _initializeResult: IHarnessInitializeResult | undefined;

	private readonly _onDidDisconnect = this._register(new Emitter<Error | undefined>());
	readonly onDidDisconnect: Event<Error | undefined> = this._onDidDisconnect.event;

	private readonly _onDidNotification = this._register(new Emitter<IHarnessDaemonNotification>());
	readonly onDidNotification: Event<IHarnessDaemonNotification> = this._onDidNotification.event;

	constructor(
		private readonly logService: ILogService,
	) {
		super();
	}

	get initializeResult(): IHarnessInitializeResult | undefined {
		return this._initializeResult;
	}

	get supportedMethods(): readonly string[] {
		return this._initializeResult?.supported_methods ?? [];
	}

	get grantedCapabilities(): readonly HarnessCapability[] {
		return this._initializeResult?.granted_capabilities ?? [];
	}

	supportsMethod(method: string): boolean {
		return this.supportedMethods.includes(method);
	}

	async connect(
		socketPath: string,
		initializeParams: IHarnessInitializeParams,
		timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
	): Promise<IHarnessInitializeResult> {
		if (this.socket) {
			throw new Error('Harness daemon client is already connected.');
		}

		this.didFireDisconnect = false;
		this.readBuffer = '';
		this.maxFrameBytes = DEFAULT_MAX_FRAME_BYTES;
		this._initializeResult = undefined;

		const socket = await this.connectSocket(socketPath, timeoutMs);
		this.attachSocket(socket);

		try {
			const result = await this.request('initialize', initializeParams, timeoutMs);
			this.validateInitializeResult(result);
			this._initializeResult = result;
			this.maxFrameBytes = result.limits.max_message_bytes;
			const ping = await this.request('daemon.ping', {}, timeoutMs);
			this.validatePingResult(ping);
			return result;
		} catch (error) {
			this.failConnection(asError(error));
			throw error;
		}
	}

	async request<TMethod extends HarnessDaemonRequestMethod>(
		method: TMethod,
		params: HarnessRequestParams<TMethod>,
		timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
	): Promise<HarnessRequestResult<TMethod>> {
		if (!this.socket) {
			throw new Error('Harness daemon socket is not connected.');
		}
		if (method !== 'initialize' && !this._initializeResult) {
			throw new Error('Harness daemon initialize handshake has not completed.');
		}

		const id = ++this.nextRequestId;
		const payload = JSON.stringify({
			jsonrpc: HARNESS_JSONRPC_VERSION,
			id,
			method,
			params,
		}) + '\n';

		const result = await new Promise<HarnessRequestResult<TMethod>>((resolve, reject) => {
			const timeoutHandle = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Harness daemon request timed out: ${method}`));
			}, timeoutMs);

			this.pendingRequests.set(id, {
				method,
				resolve: result => resolve(result as HarnessRequestResult<TMethod>),
				reject,
				timeoutHandle,
			});

			this.socket!.write(payload, error => {
				if (!error) {
					return;
				}

				clearTimeout(timeoutHandle);
				this.pendingRequests.delete(id);
				reject(normalizeSocketTransportError(asError(error)));
			});
		});

		return result;
	}

	async shutdown(): Promise<void> {
		if (!this.socket) {
			return;
		}

		try {
			if (this._initializeResult && this.supportsMethod('shutdown')) {
				await this.request('shutdown', {}, 2_000);
			}
		} catch (error) {
			this.logService.debug('Harness daemon shutdown request failed', asError(error).message);
		} finally {
			this.closeSocket();
		}
	}

	override dispose(): void {
		this.closeSocket();
		super.dispose();
	}

	private async connectSocket(socketPath: string, timeoutMs: number): Promise<net.Socket> {
		return new Promise<net.Socket>((resolve, reject) => {
			const socket = net.createConnection(socketPath);
			socket.setNoDelay(true);

			const connectPromise = new Promise<net.Socket>((resolveConnect, rejectConnect) => {
				const onConnect = () => {
					cleanup();
					resolveConnect(socket);
				};
				const onError = (error: Error) => {
					cleanup();
					rejectConnect(normalizeSocketTransportError(error));
				};
				const cleanup = () => {
					socket.off('connect', onConnect);
					socket.off('error', onError);
				};

				socket.once('connect', onConnect);
				socket.once('error', onError);
			});

			raceTimeout(connectPromise, timeoutMs, () => {
				socket.destroy(new HarnessDaemonUnavailableError(`Timed out connecting to harness daemon socket: ${socketPath}`));
			}).then(result => {
				if (!result) {
					reject(new HarnessDaemonUnavailableError(`Timed out connecting to harness daemon socket: ${socketPath}`));
					return;
				}
				resolve(result);
			}, error => {
				socket.destroy();
				reject(asError(error));
			});
		});
	}

	private attachSocket(socket: net.Socket): void {
		this.socket = socket;
		this._register(toDisposable(() => {
			this.socket = undefined;
		}));

		socket.on('data', chunk => this.onSocketData(chunk));
		socket.on('close', () => this.handleSocketClosed(undefined));
		socket.on('error', error => this.handleSocketClosed(normalizeSocketTransportError(asError(error))));
	}

	private onSocketData(chunk: Buffer): void {
		this.readBuffer += chunk.toString('utf8');
		if (Buffer.byteLength(this.readBuffer, 'utf8') > this.maxFrameBytes) {
			this.failConnection(new HarnessDaemonProtocolError('Harness daemon sent a frame larger than the negotiated limit.'));
			return;
		}

		let newlineIndex = this.readBuffer.indexOf('\n');
		while (newlineIndex >= 0) {
			const frame = this.readBuffer.slice(0, newlineIndex).trim();
			this.readBuffer = this.readBuffer.slice(newlineIndex + 1);
			if (frame.length > 0) {
				this.processFrame(frame);
			}
			newlineIndex = this.readBuffer.indexOf('\n');
		}
	}

	private processFrame(frame: string): void {
		let message: unknown;
		try {
			message = JSON.parse(frame);
		} catch (error) {
			this.failConnection(new HarnessDaemonProtocolError(`Malformed harness daemon JSON-RPC frame: ${asError(error).message}`));
			return;
		}

		if (!isObject(message) || message.jsonrpc !== HARNESS_JSONRPC_VERSION) {
			this.failConnection(new HarnessDaemonProtocolError('Harness daemon sent an invalid JSON-RPC envelope.'));
			return;
		}

		const record = message as Record<string, unknown>;

		if (typeof record.method === 'string') {
			if (Object.prototype.hasOwnProperty.call(record, 'id') && record.id !== undefined) {
				this.failConnection(new HarnessDaemonProtocolError(`Harness daemon sent an unexpected server request: ${record.method}`));
				return;
			}
			this.handleNotificationMessage(record as unknown as IHarnessDaemonNotification);
			return;
		}

		if (Object.prototype.hasOwnProperty.call(record, 'id')) {
			this.handleResponseMessage(record as unknown as IHarnessDaemonResponse);
			return;
		}

		this.failConnection(new HarnessDaemonProtocolError('Harness daemon sent an unrecognized JSON-RPC message shape.'));
	}

	private handleResponseMessage(response: IHarnessDaemonResponse): void {
		if (typeof response.id !== 'number') {
			this.failConnection(new HarnessDaemonProtocolError('Harness daemon response did not correlate to a client request id.'));
			return;
		}

		const pending = this.pendingRequests.get(response.id);
		if (!pending) {
			this.failConnection(new HarnessDaemonProtocolError(`Harness daemon response referenced unknown request id ${response.id}.`));
			return;
		}

		clearTimeout(pending.timeoutHandle);
		this.pendingRequests.delete(response.id);

		if (Object.prototype.hasOwnProperty.call(response, 'error') && response.error) {
			pending.reject(new Error(renderJsonRpcError(pending.method, response.error)));
			return;
		}

		pending.resolve((response.result ?? {}) as HarnessRequestResult<typeof pending.method>);
	}

	private handleNotificationMessage(notification: IHarnessDaemonNotification): void {
		switch (notification.method) {
			case 'fleet.delta':
			case 'daemon.resync_required':
				this._onDidNotification.fire(notification);
				return;
			default:
				this.logService.warn(`Ignoring unsupported harness daemon notification '${notification.method}'.`);
		}
	}

	private validateInitializeResult(result: IHarnessInitializeResult): void {
		if (result.protocol_version !== HARNESS_PROTOCOL_VERSION) {
			throw new HarnessDaemonProtocolError(`Harness daemon protocol mismatch: expected ${HARNESS_PROTOCOL_VERSION}, got ${result.protocol_version}.`);
		}
		if (result.schema_version !== HARNESS_SCHEMA_VERSION) {
			throw new HarnessDaemonProtocolError(`Harness daemon schema mismatch: expected ${HARNESS_SCHEMA_VERSION}, got ${result.schema_version}.`);
		}
		if (!result.daemon_info?.version || !result.daemon_info?.harness_version) {
			throw new HarnessDaemonProtocolError('Harness daemon initialize response is missing daemon_info.');
		}
		if (!Array.isArray(result.granted_capabilities) || !result.granted_capabilities.includes('read')) {
			throw new HarnessDaemonProtocolError('Harness daemon initialize response did not grant read capability.');
		}
		if (!Array.isArray(result.supported_methods)) {
			throw new HarnessDaemonProtocolError('Harness daemon initialize response is missing supported_methods.');
		}

		for (const requiredMethod of HARNESS_REQUIRED_DAEMON_METHODS) {
			if (!result.supported_methods.includes(requiredMethod)) {
				throw new HarnessDaemonProtocolError(`Harness daemon initialize response is missing required method '${requiredMethod}'.`);
			}
		}

		if (!result.limits || result.limits.max_message_bytes <= 0) {
			throw new HarnessDaemonProtocolError('Harness daemon initialize response is missing valid limits.');
		}
	}

	private validatePingResult(result: IPingResult): void {
		if (!Number.isFinite(result.uptime_ms) || result.uptime_ms < 0) {
			throw new HarnessDaemonProtocolError('Harness daemon ping response is missing a valid uptime_ms.');
		}
		if (!Number.isInteger(result.active_clients) || result.active_clients < 0) {
			throw new HarnessDaemonProtocolError('Harness daemon ping response is missing a valid active_clients count.');
		}
		if (result.schema_version !== HARNESS_SCHEMA_VERSION) {
			throw new HarnessDaemonProtocolError(`Harness daemon ping schema mismatch: expected ${HARNESS_SCHEMA_VERSION}, got ${result.schema_version}.`);
		}
	}

	private failConnection(error: Error): void {
		this.logService.warn(`Harness daemon connection failed closed: ${error.message}`);
		this.closeSocket(error);
	}

	private handleSocketClosed(error: Error | undefined): void {
		if (!this.socket && this.didFireDisconnect) {
			return;
		}
		this.closeSocket(error);
	}

	private closeSocket(error: Error | undefined = undefined): void {
		const socket = this.socket;
		this.socket = undefined;

		if (socket) {
			socket.removeAllListeners();
			if (!socket.destroyed) {
				socket.destroy();
			}
		}

		const pending = [...this.pendingRequests.values()];
		this.pendingRequests.clear();
		for (const request of pending) {
			clearTimeout(request.timeoutHandle);
			request.reject(error ?? new Error('Harness daemon connection closed.'));
		}

		if (!this.didFireDisconnect) {
			this.didFireDisconnect = true;
			this._onDidDisconnect.fire(error);
		}
	}
}

function renderJsonRpcError(method: string, error: IHarnessJsonRpcError): string {
	return `Harness daemon ${method} failed (${error.code}): ${error.message}`;
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function normalizeSocketTransportError(error: Error): Error {
	if (error instanceof HarnessDaemonUnavailableError || error instanceof HarnessDaemonProtocolError) {
		return error;
	}

	const code = (error as { code?: unknown }).code;
	if (typeof code === 'string' && ['ECONNREFUSED', 'ECONNRESET', 'ENOENT', 'EPIPE', 'ETIMEDOUT'].includes(code)) {
		return new HarnessDaemonUnavailableError(error.message);
	}

	return error;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
