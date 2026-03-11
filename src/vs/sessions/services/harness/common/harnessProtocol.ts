/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	IDaemonResyncRequiredNotification,
	IFleetDeltaNotification,
	IFleetSnapshotResult,
	IHarnessInitializeParams,
	IHarnessInitializeResult,
	IPingResult,
	ISubscribeParams,
	ISubscriptionAck,
	IUnsubscribeParams,
	IUnsubscribeResult,
} from './harnessTypes.js';

export const HARNESS_JSONRPC_VERSION = '2.0';
export const HARNESS_PROTOCOL_VERSION = '1.0';
export const HARNESS_SCHEMA_VERSION = '2026-03-01';

export type HarnessJsonRpcId = number | string | null;
export type HarnessClientRequestId = number;

// Public JSON-RPC surface on the current harness branch. Internal stream classifications
// in syntropic-daemon/streams.rs mention future topics, but they are not subscribable here yet.
export type HarnessDaemonRequestMethod =
	| 'initialize'
	| 'shutdown'
	| 'daemon.ping'
	| 'fleet.snapshot'
	| 'fleet.subscribe'
	| 'fleet.unsubscribe';

export type HarnessDaemonNotificationMethod =
	| 'fleet.delta'
	| 'daemon.resync_required';

export const HARNESS_REQUIRED_DAEMON_METHODS: readonly HarnessDaemonRequestMethod[] = Object.freeze([
	'shutdown',
	'daemon.ping',
	'fleet.snapshot',
	'fleet.subscribe',
	'fleet.unsubscribe',
]);

export interface IHarnessJsonRpcError {
	readonly code: number;
	readonly message: string;
	readonly data?: unknown;
}

export interface IHarnessJsonRpcRequest<TMethod extends string = string, TParams = unknown> {
	readonly jsonrpc: typeof HARNESS_JSONRPC_VERSION;
	readonly method: TMethod;
	readonly params?: TParams;
	readonly id?: HarnessJsonRpcId;
}

export interface ICorrelatedHarnessJsonRpcRequest<TMethod extends string = string, TParams = unknown> extends IHarnessJsonRpcRequest<TMethod, TParams> {
	readonly id: HarnessClientRequestId;
}

export interface IHarnessJsonRpcNotification<TMethod extends string = string, TParams = unknown> {
	readonly jsonrpc: typeof HARNESS_JSONRPC_VERSION;
	readonly method: TMethod;
	readonly params: TParams;
}

export interface IHarnessJsonRpcSuccessResponse<TResult = unknown> {
	readonly jsonrpc: typeof HARNESS_JSONRPC_VERSION;
	readonly id: HarnessJsonRpcId;
	readonly result: TResult;
	readonly error?: never;
}

export interface IHarnessJsonRpcErrorResponse {
	readonly jsonrpc: typeof HARNESS_JSONRPC_VERSION;
	readonly id: HarnessJsonRpcId;
	readonly error: IHarnessJsonRpcError;
	readonly result?: never;
}

export type IHarnessJsonRpcResponse<TResult = unknown> =
	| IHarnessJsonRpcSuccessResponse<TResult>
	| IHarnessJsonRpcErrorResponse;

export type IHarnessJsonRpcMessage =
	| IHarnessJsonRpcRequest
	| IHarnessJsonRpcNotification
	| IHarnessJsonRpcResponse;

export type HarnessRequestParams<TMethod extends HarnessDaemonRequestMethod> =
	TMethod extends 'initialize' ? IHarnessInitializeParams :
	TMethod extends 'shutdown' ? Record<string, never> :
	TMethod extends 'daemon.ping' ? Record<string, never> :
	TMethod extends 'fleet.snapshot' ? Record<string, never> :
	TMethod extends 'fleet.subscribe' ? ISubscribeParams :
	TMethod extends 'fleet.unsubscribe' ? IUnsubscribeParams :
	never;

export type HarnessRequestResult<TMethod extends HarnessDaemonRequestMethod> =
	TMethod extends 'initialize' ? IHarnessInitializeResult :
	TMethod extends 'shutdown' ? Record<string, never> :
	TMethod extends 'daemon.ping' ? IPingResult :
	TMethod extends 'fleet.snapshot' ? IFleetSnapshotResult :
	TMethod extends 'fleet.subscribe' ? ISubscriptionAck :
	TMethod extends 'fleet.unsubscribe' ? IUnsubscribeResult :
	never;

export type HarnessNotificationParams<TMethod extends HarnessDaemonNotificationMethod> =
	TMethod extends 'fleet.delta' ? IFleetDeltaNotification :
	TMethod extends 'daemon.resync_required' ? IDaemonResyncRequiredNotification :
	never;

export type IHarnessInitializeRequest = ICorrelatedHarnessJsonRpcRequest<'initialize', IHarnessInitializeParams>;
export type IHarnessInitializeResponse = IHarnessJsonRpcResponse<IHarnessInitializeResult>;

export type IHarnessDaemonRequest<TMethod extends HarnessDaemonRequestMethod = HarnessDaemonRequestMethod> =
	ICorrelatedHarnessJsonRpcRequest<TMethod, HarnessRequestParams<TMethod>>;

export type IHarnessDaemonResponse<TMethod extends HarnessDaemonRequestMethod = HarnessDaemonRequestMethod> =
	IHarnessJsonRpcResponse<HarnessRequestResult<TMethod>>;

export type IHarnessDaemonNotification<TMethod extends HarnessDaemonNotificationMethod = HarnessDaemonNotificationMethod> =
	IHarnessJsonRpcNotification<TMethod, HarnessNotificationParams<TMethod>>;
