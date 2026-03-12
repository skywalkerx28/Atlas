/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	IDaemonResyncRequiredNotification,
	IFleetDeltaNotification,
	IFleetSnapshotResult,
	IHealthResult,
	IHealthUpdateNotification,
	IHarnessInitializeParams,
	IHarnessInitializeResult,
	IMergeGetParams,
	IMergeListParams,
	IMergeListResult,
	IMergeQueueRecord,
	IMergeUpdateNotification,
	IObjectiveDetail,
	IObjectiveGetParams,
	IObjectiveListParams,
	IObjectiveListResult,
	IObjectiveUpdateNotification,
	IPingResult,
	IReviewCandidateRecord,
	IReviewGetParams,
	IReviewListParams,
	IReviewListResult,
	IReviewUpdateNotification,
	ISubscribeParams,
	ISubscriptionAck,
	ITaskDetail,
	ITaskGetParams,
	ITaskListResult,
	ITaskTreeParams,
	ITaskTreeResult,
	IUnsubscribeParams,
	IUnsubscribeResult,
} from './harnessTypes.js';

export const HARNESS_JSONRPC_VERSION = '2.0';
export const HARNESS_PROTOCOL_VERSION = '1.0';
export const HARNESS_SCHEMA_VERSION = '2026-03-01';

export type HarnessJsonRpcId = number | string | null;
export type HarnessClientRequestId = number;

// Public JSON-RPC surface on the current harness branch.
export type HarnessDaemonRequestMethod =
	| 'initialize'
	| 'shutdown'
	| 'daemon.ping'
	| 'fleet.snapshot'
	| 'fleet.subscribe'
	| 'fleet.unsubscribe'
	| 'health.get'
	| 'health.subscribe'
	| 'health.unsubscribe'
	| 'objective.list'
	| 'objective.get'
	| 'objective.subscribe'
	| 'objective.unsubscribe'
	| 'review.list'
	| 'review.get'
	| 'review.subscribe'
	| 'review.unsubscribe'
	| 'merge.list'
	| 'merge.get'
	| 'merge.subscribe'
	| 'merge.unsubscribe'
	| 'task.get'
	| 'task.list'
	| 'task.tree';

export type HarnessDaemonNotificationMethod =
	| 'fleet.delta'
	| 'health.update'
	| 'objective.update'
	| 'review.update'
	| 'merge.update'
	| 'daemon.resync_required';

export const HARNESS_REQUIRED_DAEMON_METHODS: readonly HarnessDaemonRequestMethod[] = Object.freeze([
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
	'task.tree',
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
	TMethod extends 'health.get' ? Record<string, never> :
	TMethod extends 'health.subscribe' ? ISubscribeParams :
	TMethod extends 'health.unsubscribe' ? IUnsubscribeParams :
	TMethod extends 'objective.list' ? IObjectiveListParams :
	TMethod extends 'objective.get' ? IObjectiveGetParams :
	TMethod extends 'objective.subscribe' ? ISubscribeParams :
	TMethod extends 'objective.unsubscribe' ? IUnsubscribeParams :
	TMethod extends 'review.list' ? IReviewListParams :
	TMethod extends 'review.get' ? IReviewGetParams :
	TMethod extends 'review.subscribe' ? ISubscribeParams :
	TMethod extends 'review.unsubscribe' ? IUnsubscribeParams :
	TMethod extends 'merge.list' ? IMergeListParams :
	TMethod extends 'merge.get' ? IMergeGetParams :
	TMethod extends 'merge.subscribe' ? ISubscribeParams :
	TMethod extends 'merge.unsubscribe' ? IUnsubscribeParams :
	TMethod extends 'task.get' ? ITaskGetParams :
	TMethod extends 'task.list' ? Record<string, never> :
	TMethod extends 'task.tree' ? ITaskTreeParams :
	never;

export type HarnessRequestResult<TMethod extends HarnessDaemonRequestMethod> =
	TMethod extends 'initialize' ? IHarnessInitializeResult :
	TMethod extends 'shutdown' ? Record<string, never> :
	TMethod extends 'daemon.ping' ? IPingResult :
	TMethod extends 'fleet.snapshot' ? IFleetSnapshotResult :
	TMethod extends 'fleet.subscribe' ? ISubscriptionAck :
	TMethod extends 'fleet.unsubscribe' ? IUnsubscribeResult :
	TMethod extends 'health.get' ? IHealthResult :
	TMethod extends 'health.subscribe' ? ISubscriptionAck :
	TMethod extends 'health.unsubscribe' ? IUnsubscribeResult :
	TMethod extends 'objective.list' ? IObjectiveListResult :
	TMethod extends 'objective.get' ? IObjectiveDetail :
	TMethod extends 'objective.subscribe' ? ISubscriptionAck :
	TMethod extends 'objective.unsubscribe' ? IUnsubscribeResult :
	TMethod extends 'review.list' ? IReviewListResult :
	TMethod extends 'review.get' ? IReviewCandidateRecord :
	TMethod extends 'review.subscribe' ? ISubscriptionAck :
	TMethod extends 'review.unsubscribe' ? IUnsubscribeResult :
	TMethod extends 'merge.list' ? IMergeListResult :
	TMethod extends 'merge.get' ? IMergeQueueRecord :
	TMethod extends 'merge.subscribe' ? ISubscriptionAck :
	TMethod extends 'merge.unsubscribe' ? IUnsubscribeResult :
	TMethod extends 'task.get' ? ITaskDetail :
	TMethod extends 'task.list' ? ITaskListResult :
	TMethod extends 'task.tree' ? ITaskTreeResult :
	never;

export type HarnessNotificationParams<TMethod extends HarnessDaemonNotificationMethod> =
	TMethod extends 'fleet.delta' ? IFleetDeltaNotification :
	TMethod extends 'health.update' ? IHealthUpdateNotification :
	TMethod extends 'objective.update' ? IObjectiveUpdateNotification :
	TMethod extends 'review.update' ? IReviewUpdateNotification :
	TMethod extends 'merge.update' ? IMergeUpdateNotification :
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
