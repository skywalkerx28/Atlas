/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type IWireDispatchCommand = AtlasModel.IWireDispatchCommand;
export type IWireMemoryRecord = AtlasModel.IWireMemoryRecord;
export type IWireResultPacket = AtlasModel.IWireResultPacket;
export type IWireTaskPacket = AtlasModel.IWireTaskPacket;

export type HarnessCapability = 'read' | 'control' | 'steer' | 'dispatch' | 'event';

export type HarnessHandoffType =
	| 'intake'
	| 'planning'
	| 'specification'
	| 'implementation'
	| 'verification'
	| 'review'
	| 'clarification';

export type HarnessWorkerState =
	| 'queued'
	| 'spawning'
	| 'ready'
	| 'executing'
	| 'paused'
	| 'completing'
	| 'completed'
	| 'failed'
	| 'timed_out'
	| 'killed';

export interface IHarnessClientInfo {
	readonly name: string;
	readonly version: string;
}

export interface IHarnessDaemonInfo {
	readonly name: string;
	readonly version: string;
	readonly harness_version: string;
}

export interface IHarnessDaemonLimits {
	readonly max_message_bytes: number;
	readonly max_subscriptions: number;
	readonly max_pending_notifications: number;
}

export interface IHarnessInitializeParams {
	readonly protocol_version: string;
	readonly client_info: IHarnessClientInfo;
	readonly client_token: string;
	readonly requested_capabilities: readonly HarnessCapability[];
}

export interface IHarnessInitializeResult {
	readonly protocol_version: string;
	readonly daemon_info: IHarnessDaemonInfo;
	readonly schema_version: string;
	readonly client_id: string;
	readonly resolved_identity: string;
	readonly granted_capabilities: readonly HarnessCapability[];
	readonly supported_methods: readonly string[];
	readonly limits: IHarnessDaemonLimits;
}

export interface IFleetWorkerState {
	readonly dispatch_id: string;
	readonly task_id: string;
	readonly role_id: string;
	readonly state: HarnessWorkerState;
	readonly handoff_type?: HarnessHandoffType;
	readonly pid?: number;
	readonly asi?: number;
	readonly started_at: string;
	readonly last_heartbeat_at: string;
}

export interface IQueueState {
	readonly dispatch_queue_depth: number;
	readonly merge_queue_depth: number;
	readonly merge_conflicts: number;
	readonly pending_workspace_events: number;
}

export interface IDaemonHealthState {
	readonly mode: string;
	readonly disk_usage_pct: number;
	readonly memory_usage_pct: number;
	readonly wal_size_bytes: number;
	readonly active_workers: number;
	readonly queue_depth: number;
	readonly last_health_check: string;
}

export interface IFleetSnapshot {
	readonly captured_at: string;
	readonly workers: readonly IFleetWorkerState[];
	readonly queue: IQueueState;
	readonly health: IDaemonHealthState;
}

export interface IFleetSnapshotResult {
	readonly seq: number;
	readonly snapshot: IFleetSnapshot;
}

export interface IFleetDelta {
	readonly captured_at: string;
	readonly added: readonly IFleetWorkerState[];
	readonly removed: readonly string[];
	readonly changed: readonly IFleetWorkerState[];
	readonly queue: IQueueState;
	readonly health: IDaemonHealthState;
}

export interface ISubscribeParams {
	readonly resume_from_seq?: number;
}

export interface ISubscriptionAck {
	readonly subscription_id: string;
	readonly head_seq: number;
	readonly resumed: boolean;
	readonly resync_required: boolean;
}

export interface IUnsubscribeParams {
	readonly subscription_id: string;
}

export interface IUnsubscribeResult {
	readonly removed: boolean;
}

export interface IPingResult {
	readonly uptime_ms: number;
	readonly active_clients: number;
	readonly schema_version: string;
}

export interface IFleetDeltaNotification extends IFleetDelta {
	readonly seq: number;
	readonly subscription_id: string;
}

export interface IDaemonResyncRequiredNotification {
	readonly subscription_id: string;
	readonly reason: string;
	readonly last_valid_seq: number;
}

export interface IHarnessWorkerRecord {
	readonly dispatchId: string;
	readonly taskId: string;
	readonly roleId: string;
	readonly state: HarnessWorkerState;
	readonly handoffType: HarnessHandoffType | undefined;
	readonly pid: number | undefined;
	readonly asi: number | undefined;
	readonly startedAt: number;
	readonly lastHeartbeatAt: number;
	readonly worktreePath: string | undefined;
}

export interface IHarnessQueueSnapshot {
	readonly dispatchQueueDepth: number;
	readonly mergeQueueDepth: number;
	readonly mergeConflicts: number;
	readonly pendingWorkspaceEvents: number;
}

export interface IHarnessHealthSnapshot {
	readonly mode: string;
	readonly diskUsagePct: number;
	readonly memoryUsagePct: number;
	readonly walSizeBytes: number;
	readonly activeWorkers: number;
	readonly queueDepth: number;
	readonly lastHealthCheck: number | undefined;
}

export interface IHarnessFleetStateSnapshot {
	readonly capturedAt: number;
	readonly seq: number;
	readonly subscriptionId: string | undefined;
	readonly workers: readonly IHarnessWorkerRecord[];
	readonly queue: IHarnessQueueSnapshot;
	readonly health: IHarnessHealthSnapshot;
}
