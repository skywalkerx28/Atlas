/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type IWireDispatchCommand = AtlasModel.IWireDispatchCommand;
export type IWireAgentActivityEvent = AtlasModel.IWireAgentActivityEvent;
export type IWireMemoryRecord = AtlasModel.IWireMemoryRecord;
export type IWireResultPacket = AtlasModel.IWireResultPacket;
export type IWireTaskPacket = AtlasModel.IWireTaskPacket;
export type IWireWorkspaceEvent = AtlasModel.IWireWorkspaceEvent;

export type HarnessCapability = 'read' | 'control' | 'steer' | 'dispatch' | 'event' | 'review' | 'merge';
export type HarnessSupportedWriteMethod =
	| 'control.pause'
	| 'control.cancel'
	| 'dispatch.submit'
	| 'objective.submit'
	| 'review.gate_verdict'
	| 'review.authorize_promotion'
	| 'review.enqueue_merge';
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
export type HarnessReviewDecision = 'go' | 'no-go' | 'n/a';
export type HarnessReviewState =
	| 'not_requested'
	| 'awaiting_review'
	| 'review_blocked'
	| 'review_go';
export type HarnessPromotionState =
	| 'not_requested'
	| 'promotion_requested'
	| 'promotion_authorized'
	| 'abandoned';
export type HarnessIntegrationState =
	| 'not_ready'
	| 'queued'
	| 'merge_started'
	| 'merged'
	| 'merge_blocked'
	| 'abandoned';
export type HarnessTaskNodeStatus =
	| 'pending'
	| 'running'
	| 'completed'
	| 'failed'
	| 'blocked'
	| 'cancelled';
export type HarnessTaskPriority = 'p0' | 'p1' | 'p2' | 'p3' | 'info';

export type HarnessAggregationStrategy =
	| 'all_must_succeed'
	| 'allow_partial'
	| 'majority_succeed'
	| 'best_effort'
	| 'first_success_wins';

export type HarnessObjectiveStatus =
	| 'open'
	| 'planning'
	| 'executing'
	| 'reviewing'
	| 'completed'
	| 'failed';

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

export interface IHarnessFabricIdentity {
	readonly fabric_id: string;
	readonly repo_root: string;
	readonly db_path: string;
	readonly harness_home: string;
	readonly artifact_dir: string;
	readonly metrics_path: string;
}

export interface IHarnessInitializeParams {
	readonly protocol_version: string;
	readonly client_info: IHarnessClientInfo;
	readonly client_token: string;
	readonly requested_capabilities?: readonly HarnessCapability[];
}

export interface IHarnessInitializeResult {
	readonly protocol_version: string;
	readonly daemon_info: IHarnessDaemonInfo;
	readonly schema_version: string;
	readonly client_id: string;
	readonly resolved_identity: string;
	readonly granted_capabilities: readonly HarnessCapability[];
	readonly fabric_identity: IHarnessFabricIdentity;
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

export interface IHealthResult {
	readonly seq: number;
	readonly health: IDaemonHealthState;
}

export interface IHealthUpdateNotification {
	readonly subscription_id: string;
	readonly seq: number;
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

export interface IObjectiveSpec {
	readonly objective_id: string;
	readonly created_at: string;
	readonly problem_statement: string;
	readonly desired_outcomes: readonly string[];
	readonly constraints: readonly string[];
	readonly context_paths: readonly string[];
	readonly success_criteria: readonly string[];
	readonly playbook_ids: readonly string[];
	readonly priority: HarnessTaskPriority;
	readonly budget_ceiling_usd?: number;
	readonly max_parallel_workers?: number;
	readonly operator_notes: readonly string[];
}

export interface IObjectiveRecord {
	readonly spec: IObjectiveSpec;
	readonly status: HarnessObjectiveStatus;
	readonly root_task_id?: string;
	readonly resume_count: number;
	readonly max_resume_cycles: number;
	readonly created_at: string;
	readonly updated_at: string;
	readonly completed_at?: string;
}

export interface IObjectiveListParams {
	readonly status?: string;
}

export interface IObjectiveListResult {
	readonly seq: number;
	readonly objectives: readonly IObjectiveRecord[];
}

export interface IObjectiveGetParams {
	readonly objective_id: string;
}

export interface IObjectiveSubmitParams {
	readonly summary: string;
	readonly priority?: HarnessTaskPriority;
	readonly context_paths: readonly string[];
	readonly playbooks: readonly string[];
	readonly desired_outcomes: readonly string[];
	readonly constraints: readonly string[];
	readonly success_criteria: readonly string[];
	readonly operator_notes: readonly string[];
	readonly budget_ceiling_usd?: number;
	readonly max_parallel_workers?: number;
}

export interface IObjectiveSubmitResult {
	readonly rid: string;
	readonly objective_id: string;
	readonly root_task_id: string;
	readonly dispatch_id: string;
	readonly idempotency_key: string;
	readonly objective_path: string;
	readonly packet_path: string;
}

export interface ITaskNode {
	readonly task_id: string;
	readonly parent_task_id: string | null;
	readonly depth: number;
	readonly status: HarnessTaskNodeStatus;
	readonly aggregation_strategy: HarnessAggregationStrategy | null;
	readonly created_at: string;
	readonly completed_at: string | null;
}

export interface IQueueDispatch {
	readonly dispatch_id: string;
	readonly idempotency_key: string;
	readonly task_id: string;
	readonly role_id: string;
	readonly priority: HarnessTaskPriority;
	readonly handoff_type?: HarnessHandoffType;
	readonly metadata?: unknown;
}

export interface IDispatchTransition {
	readonly dispatch_id: string;
	readonly task_id: string;
	readonly role_id: string;
	readonly previous_state: string;
	readonly new_state: string;
	readonly metadata_json: string;
	readonly created_at: string;
}

export interface IObjectiveDetail {
	readonly objective: IObjectiveRecord;
	readonly task_graph: readonly ITaskNode[];
}

export interface IObjectiveUpdateNotification {
	readonly subscription_id: string;
	readonly seq: number;
	readonly objectives: readonly IObjectiveRecord[];
}

export interface IReviewCandidateRecord {
	readonly dispatch_id: string;
	readonly task_id: string;
	readonly role_id: string;
	readonly candidate_branch: string;
	readonly base_ref: string;
	readonly base_head_sha: string;
	readonly merge_base_sha: string;
	readonly reviewed_head_sha: string;
	readonly commit_shas: readonly string[];
	readonly artifact_bundle_dir: string;
	readonly result_packet_path: string;
	readonly handoff_path: string;
	readonly dispatch_run_path: string | null;
	readonly materialization_kind: string;
	readonly materialization_path: string;
	readonly commit_evidence_path: string;
	readonly working_tree_clean: boolean;
	readonly review_state: HarnessReviewState;
	readonly judge_decision: HarnessReviewDecision | null;
	readonly reviewed_by_role: string | null;
	readonly reviewed_at: string | null;
	readonly promotion_state: HarnessPromotionState;
	readonly promotion_authorized_at: string | null;
	readonly promotion_authorized_by_role: string | null;
	readonly integration_state: HarnessIntegrationState;
	readonly merged_sha: string | null;
	readonly merge_executor_id: string | null;
	readonly merged_at: string | null;
	readonly state_reason: string | null;
	readonly created_at: string;
	readonly updated_at: string;
}

export interface IReviewListParams {
	readonly task_id?: string;
	readonly review_state?: string;
	readonly integration_state?: string;
}

export interface IReviewListResult {
	readonly seq: number;
	readonly reviews: readonly IReviewCandidateRecord[];
}

export interface IReviewGetParams {
	readonly dispatch_id: string;
}

export interface IReviewGateVerdictParams {
	readonly dispatch_id: string;
	readonly decision: HarnessReviewDecision;
	readonly reviewed_by_role: string;
}

export interface IReviewAuthorizePromotionParams {
	readonly dispatch_id: string;
	readonly authorized_by_role: string;
}

export interface IReviewGateVerdictResult {
	readonly rid: string;
	readonly dispatch_id: string;
	readonly applied: boolean;
	readonly review: IReviewCandidateRecord;
}

export interface IReviewAuthorizePromotionResult {
	readonly rid: string;
	readonly dispatch_id: string;
	readonly applied: boolean;
	readonly review: IReviewCandidateRecord;
}

export interface IReviewDelta {
	readonly added: readonly IReviewCandidateRecord[];
	readonly changed: readonly IReviewCandidateRecord[];
	readonly removed: readonly string[];
}

export interface IReviewUpdateNotification extends IReviewDelta {
	readonly subscription_id: string;
	readonly seq: number;
}

export interface IMergeQueueRecord {
	readonly dispatch_id: string;
	readonly task_id: string;
	readonly worktree_path: string;
	readonly candidate_branch: string;
	readonly base_ref: string;
	readonly base_head_sha: string;
	readonly merge_base_sha: string;
	readonly reviewed_head_sha: string;
	readonly artifact_bundle_dir: string;
	readonly result_packet_path: string;
	readonly dispatch_run_path: string | null;
	readonly materialization_kind: string;
	readonly materialization_path: string;
	readonly commit_evidence_path: string;
	readonly priority: number;
	readonly enqueued_at: string;
	readonly status: string;
	readonly merge_sha: string | null;
	readonly conflict_details: string | null;
	readonly affected_paths: readonly string[] | null;
	readonly judge_decision: HarnessReviewDecision | null;
	readonly reviewed_by_role: string | null;
	readonly reviewed_at: string | null;
	readonly promotion_authorized_at: string | null;
	readonly promotion_authorized_by_role: string | null;
	readonly merge_executor_id: string | null;
	readonly merged_at: string | null;
	readonly blocked_reason: string | null;
}

export interface IMergeListParams {
	readonly status?: string;
}

export interface IMergeListResult {
	readonly seq: number;
	readonly entries: readonly IMergeQueueRecord[];
}

export interface IMergeGetParams {
	readonly dispatch_id: string;
}

export interface IReviewEnqueueMergeParams {
	readonly dispatch_id: string;
}

export interface IReviewEnqueueMergeResult {
	readonly rid: string;
	readonly dispatch_id: string;
	readonly inserted: boolean;
	readonly entry: IMergeQueueRecord;
}

export interface IMergeDelta {
	readonly added: readonly IMergeQueueRecord[];
	readonly changed: readonly IMergeQueueRecord[];
	readonly removed: readonly string[];
}

export interface IMergeUpdateNotification extends IMergeDelta {
	readonly subscription_id: string;
	readonly seq: number;
}

export interface ITaskGetParams {
	readonly task_id: string;
}

export interface ITaskListParams { }

export interface ITaskTreeParams {
	readonly root_task_id: string;
}

export interface ITaskRootEntry {
	readonly task: ITaskNode;
	readonly objective?: IObjectiveRecord;
	readonly latest_dispatch?: IQueueDispatch;
}

export interface ITaskListResult {
	readonly roots: readonly ITaskRootEntry[];
}

export interface ITaskTreeNodeDetail {
	readonly task: ITaskNode;
	readonly latest_dispatch?: IQueueDispatch;
}

export interface ITaskTreeResult {
	readonly root_task_id: string;
	readonly objective?: IObjectiveRecord;
	readonly nodes: readonly ITaskTreeNodeDetail[];
}

export interface ITaskDetail {
	readonly task: ITaskNode;
	readonly root_task_id?: string;
	readonly objective?: IObjectiveRecord;
	readonly latest_dispatch?: IQueueDispatch;
	readonly subtasks: readonly ITaskNode[];
	readonly latest_dispatch_timeline: readonly IDispatchTransition[];
}

export interface IControlDispatchParams {
	readonly dispatch_id: string;
}

export interface IControlResult {
	readonly rid: string;
	readonly action_id: number;
	readonly action: string;
	readonly delegated_action: string;
	readonly dispatch_id?: string;
	readonly semantics: string;
}

export interface IDispatchSubmitParams {
	readonly role_id: string;
	readonly task_id: string;
	readonly packet_path: string;
	readonly priority?: HarnessTaskPriority;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface IDispatchSubmitResult {
	readonly rid: string;
	readonly dispatch_id: string;
	readonly idempotency_key: string;
	readonly task_id: string;
	readonly role_id: string;
	readonly inserted: boolean;
	readonly packet_path: string;
}

export interface IEventEmitResult {
	readonly rid: string;
	readonly event_id: string;
}

export interface IHarnessTaskLineageNode {
	readonly taskId: string;
	readonly parentTaskId: string | undefined;
	readonly depth: number;
	readonly status: HarnessTaskNodeStatus;
	readonly aggregationStrategy: HarnessAggregationStrategy | undefined;
	readonly dispatchId: string | undefined;
	readonly roleId: string | undefined;
	readonly priority: HarnessTaskPriority | undefined;
	readonly handoffType: HarnessHandoffType | undefined;
	readonly createdAt: number;
	readonly completedAt: number | undefined;
}

export interface IHarnessTaskTree {
	readonly rootTaskId: string;
	readonly objectiveId: string | undefined;
	readonly nodes: readonly IHarnessTaskLineageNode[];
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

export type HarnessArtifactKind =
	| 'result_packet'
	| 'handoff'
	| 'commit_evidence'
	| 'dispatch_run'
	| 'other';

export interface IArtifactListParams {
	readonly dispatch_id: string;
	readonly limit?: number;
}

export interface IArtifactGetParams {
	readonly dispatch_id: string;
	readonly artifact_path: string;
	readonly max_bytes?: number;
}

export interface IHarnessArtifactEntry {
	readonly artifactPath: string;
	readonly absolutePath: string;
	readonly kind: HarnessArtifactKind;
	readonly sizeBytes: number;
}

export interface IArtifactListResult {
	readonly dispatch_id: string;
	readonly task_id: string;
	readonly objective_id?: string;
	readonly artifact_bundle_dir: string;
	readonly artifacts: readonly {
		readonly artifact_path: string;
		readonly absolute_path: string;
		readonly kind: HarnessArtifactKind;
		readonly size_bytes: number;
	}[];
	readonly truncated: boolean;
}

export interface IArtifactGetResult {
	readonly dispatch_id: string;
	readonly task_id: string;
	readonly objective_id?: string;
	readonly artifact_bundle_dir: string;
	readonly artifact: {
		readonly artifact_path: string;
		readonly absolute_path: string;
		readonly kind: HarnessArtifactKind;
		readonly size_bytes: number;
	};
	readonly text_preview?: string;
	readonly preview_truncated: boolean;
	readonly is_utf8_text: boolean;
}

export interface IHarnessArtifactInventory {
	readonly dispatchId: string;
	readonly taskId: string;
	readonly objectiveId: string | undefined;
	readonly artifactBundleDir: string;
	readonly artifacts: readonly IHarnessArtifactEntry[];
	readonly truncated: boolean;
}

export interface IHarnessArtifactPreview {
	readonly dispatchId: string;
	readonly taskId: string;
	readonly objectiveId: string | undefined;
	readonly artifactBundleDir: string;
	readonly artifact: IHarnessArtifactEntry;
	readonly textPreview: string | undefined;
	readonly previewTruncated: boolean;
	readonly isUtf8Text: boolean;
}

export interface IAgentActivityGetParams {
	readonly dispatch_id: string;
	readonly max_events?: number;
}

export interface IAgentActivityGetResult {
	readonly dispatch_id: string;
	readonly available: boolean;
	readonly run_manifest_path?: string;
	readonly activity_stream_path?: string;
	readonly events: readonly IWireAgentActivityEvent[];
}

export interface IMemoryGetParams {
	readonly record_id: string;
}

export interface IMemoryListParams {
	readonly root_task_id?: string;
	readonly task_id?: string;
	readonly limit?: number;
}

export interface IMemoryListResult {
	readonly records: readonly IWireMemoryRecord[];
}

export interface IResultGetParams {
	readonly dispatch_id: string;
}

export interface IResultGetResult {
	readonly dispatch_id: string;
	readonly result_packet_path: string;
	readonly result_packet: IWireResultPacket;
}

export interface ITranscriptGetParams {
	readonly dispatch_id: string;
	readonly max_turns?: number;
}

export interface ITranscriptGetResult {
	readonly dispatch_id: string;
	readonly available: boolean;
	readonly metadata?: unknown;
	readonly excerpt_jsonl?: string;
}

export interface IHarnessTranscriptSnapshot {
	readonly dispatchId: string;
	readonly available: boolean;
	readonly metadata: unknown | undefined;
	readonly excerptJsonl: string | undefined;
}

export interface IWorktreeGetParams {
	readonly dispatch_id: string;
}

export interface IWorktreeListParams {
	readonly root_task_id: string;
	readonly limit?: number;
}

export interface IWorktreeGetResult {
	readonly worktree_path: string;
	readonly dispatch_id: string;
	readonly task_id: string;
	readonly objective_id?: string;
	readonly branch?: string;
	readonly base_ref?: string;
	readonly head_sha?: string;
	readonly working_tree_clean?: boolean;
	readonly merge_ready?: boolean;
	readonly created_at?: string;
	readonly updated_at?: string;
}

export interface IWorktreeListResult {
	readonly root_task_id: string;
	readonly objective_id?: string;
	readonly worktrees: readonly IWorktreeGetResult[];
	readonly truncated: boolean;
}

export interface IReviewProvenanceListParams {
	readonly dispatch_id: string;
	readonly limit?: number;
	readonly before?: number;
}

export interface IReviewProvenanceEntry {
	readonly id: number;
	readonly dispatch_id: string;
	readonly method: string;
	readonly rid: string;
	readonly actor_role?: string;
	readonly client_id?: string;
	readonly identity?: string;
	readonly outcome: string;
	readonly created_at: string;
	readonly provenance: unknown;
}

export interface IReviewProvenanceListResult {
	readonly dispatch_id: string;
	readonly entries: readonly IReviewProvenanceEntry[];
	readonly truncated: boolean;
	readonly next_before?: number;
}
