/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum WireDispatchPriority {
	P0 = 'p0',
	P1 = 'p1',
	P2 = 'p2',
	P3 = 'p3',
	Info = 'info',
}

export const enum HandoffType {
	Intake = 'intake',
	Planning = 'planning',
	Specification = 'specification',
	Implementation = 'implementation',
	Verification = 'verification',
	Review = 'review',
	Clarification = 'clarification',
}

export const enum ResultPacketStatus {
	Done = 'done',
	Blocked = 'blocked',
	Failed = 'failed',
	NeedsClarification = 'needs_clarification',
}

export const enum ReviewDecision {
	Go = 'go',
	NoGo = 'no-go',
	NotApplicable = 'n/a',
}

export const enum AcceptanceCheckStatus {
	Pass = 'pass',
	Fail = 'fail',
	NotRun = 'not_run',
}

export const enum WireReviewState {
	NotRequested = 'not_requested',
	AwaitingReview = 'awaiting_review',
	ReviewBlocked = 'review_blocked',
	ReviewGo = 'review_go',
}

export const enum WirePromotionState {
	NotRequested = 'not_requested',
	PromotionRequested = 'promotion_requested',
	PromotionAuthorized = 'promotion_authorized',
	Abandoned = 'abandoned',
}

export const enum WireIntegrationState {
	NotReady = 'not_ready',
	Queued = 'queued',
	MergeStarted = 'merge_started',
	Merged = 'merged',
	MergeBlocked = 'merge_blocked',
	Abandoned = 'abandoned',
}

export const enum ParallelizationMode {
	Serial = 'serial',
	Parallel = 'parallel',
}

export const enum ParallelMergeStrategy {
	PlannerFanIn = 'planner_fan_in',
	PlannerSequential = 'planner_sequential',
	SingleLane = 'single_lane',
}

export const enum ActivityEventKind {
	ToolUse = 'tool_use',
	ToolResult = 'tool_result',
	ToolError = 'tool_error',
	CommandStart = 'command_start',
	CommandResult = 'command_result',
	FileEdit = 'file_edit',
	FileCreate = 'file_create',
	FileRead = 'file_read',
	Reasoning = 'reasoning',
	AgentMessage = 'agent_message',
	Milestone = 'milestone',
	Decision = 'decision',
	Artifact = 'artifact',
	Error = 'error',
	SessionStart = 'session_start',
	TurnComplete = 'turn_complete',
	SessionEnd = 'session_end',
	Other = 'other',
}

export interface IWireTaskPacketVerification {
	readonly required: boolean;
	readonly commands: readonly string[];
	readonly required_roles: readonly string[];
	readonly allow_not_applicable: boolean;
}

export interface IWireTaskPacketReview {
	readonly required: boolean;
	readonly required_reviewers: readonly string[];
	readonly require_signed_decision: boolean;
}

export interface IWirePreauthorizedNextStep {
	readonly target_role: string;
	readonly handoff_type: string;
	readonly acceptance_criteria: readonly string[];
}

export interface IWireTaskPacketPushAuthorization {
	readonly remote: string;
	readonly branch: string;
	readonly refspec: string;
	readonly canonical_remote_only: boolean;
	readonly task_branch_only: boolean;
}

export interface IWireTaskPacketParallelization {
	readonly mode: ParallelizationMode;
	readonly group_id: string | undefined;
	readonly lane_id: string | undefined;
	readonly peer_roles: readonly string[];
	readonly owned_paths: readonly string[];
	readonly avoid_paths: readonly string[];
	readonly merge_strategy: ParallelMergeStrategy | undefined;
}

export interface IWireTaskPacketSubplannerContract {
	readonly scope_hint: string;
	readonly upstream_role: string;
	readonly single_handoff_required: boolean;
	readonly allow_follow_on_dispatch: boolean;
	readonly allowed_write_roots: readonly string[];
}

export interface IWireTaskPacketTemplateRefs {
	readonly plan: string | undefined;
	readonly spec: string | undefined;
	readonly result: string | undefined;
}

export interface IWireTaskPacket {
	readonly task_id: string;
	readonly created_at: string;
	readonly from_role: string;
	readonly to_role: string;
	readonly summary: string;
	readonly acceptance: readonly string[];
	readonly constraints: readonly string[];
	readonly artifacts: readonly string[];
	readonly memory_keywords: readonly string[];
	readonly handoff_type: HandoffType | undefined;
	readonly playbook_id: string | undefined;
	readonly phase_refs: readonly string[];
	readonly context_paths: readonly string[];
	readonly execution_prompt: string | undefined;
	readonly template_refs: IWireTaskPacketTemplateRefs | undefined;
	readonly verification: IWireTaskPacketVerification | undefined;
	readonly review: IWireTaskPacketReview | undefined;
	readonly preauthorized_next_step: IWirePreauthorizedNextStep | undefined;
	readonly requires_prompt_engineering: boolean;
	readonly prompt_skill: string | undefined;
	readonly git_branch: string | undefined;
	readonly git_base: string | undefined;
	readonly allow_push: boolean;
	readonly allow_merge: boolean;
	readonly push_authorization: IWireTaskPacketPushAuthorization | undefined;
	readonly commit_message_template: string | undefined;
	readonly parallelization: IWireTaskPacketParallelization | undefined;
	readonly subplanner_contract: IWireTaskPacketSubplannerContract | undefined;
}

export interface IWireAcceptanceResult {
	readonly criterion: string;
	readonly status: AcceptanceCheckStatus;
	readonly evidence: string | undefined;
}

export interface IWirePromotionRecord {
	readonly task_id: string;
	readonly dispatch_id: string;
	readonly review_state: WireReviewState;
	readonly reviewed_branch: string | undefined;
	readonly reviewed_head_sha: string | undefined;
	readonly judge_decision: ReviewDecision | undefined;
	readonly promotion_state: WirePromotionState;
	readonly promotion_authorized_at: string | undefined;
	readonly integration_state: WireIntegrationState;
	readonly merged_sha: string | undefined;
	readonly merge_executor_id: string | undefined;
}

export interface IWireResultPacket {
	readonly task_id: string;
	readonly created_at: string;
	readonly from_role: string;
	readonly to_role: string;
	readonly status: ResultPacketStatus;
	readonly summary: string;
	readonly artifacts: readonly string[];
	readonly commands: readonly string[];
	readonly risks: readonly string[];
	readonly decision: ReviewDecision | undefined;
	readonly acceptance_results: readonly IWireAcceptanceResult[];
	readonly next_actions: readonly string[];
	readonly git_branch: string | undefined;
	readonly git_base: string | undefined;
	readonly head_sha: string | undefined;
	readonly commit_shas: readonly string[];
	readonly working_tree_clean: boolean;
	readonly pushed: boolean;
	readonly merge_ready: boolean;
	readonly workspace_events: readonly string[];
}

export interface IWireObjectiveSpec {
	readonly objective_id: string;
	readonly created_at: string;
	readonly problem_statement: string;
	readonly desired_outcomes: readonly string[];
	readonly constraints: readonly string[];
	readonly context_paths: readonly string[];
	readonly success_criteria: readonly string[];
	readonly playbook_ids: readonly string[];
	readonly priority: WireDispatchPriority;
	readonly budget_ceiling_usd: number | undefined;
	readonly max_parallel_workers: number | undefined;
	readonly operator_notes: readonly string[];
}

export interface IWireDispatchCommand {
	readonly role_id: string;
	readonly task_id: string | undefined;
	readonly from_role: string | undefined;
	readonly message: string;
	readonly subagent_nickname: string | undefined;
	readonly skip_gates: boolean;
}

export interface IWireWorkspaceEvent {
	readonly event_id: string;
	readonly idempotency_key: string;
	readonly task_id: string;
	readonly created_at: string;
	readonly role_id: string;
	readonly event_kind: string;
	readonly status: string;
	readonly severity: string;
	readonly summary: string;
	readonly next_action: string;
	readonly artifacts: readonly string[];
	readonly slack_channel: string | undefined;
	readonly slack_thread_ts: string | undefined;
	readonly notion_database_hint: string | undefined;
	readonly notion_page_id: string | undefined;
	readonly links: Readonly<Record<string, string>>;
	readonly metadata: Readonly<Record<string, string>>;
}

export interface IWireDiffStat {
	readonly lines_added: number;
	readonly lines_removed: number;
}

export interface IWireAgentActivityEvent {
	readonly ts: string;
	readonly dispatch_id: string;
	readonly task_id: string;
	readonly objective_id: string | undefined;
	readonly role_id: string;
	readonly handoff_type: HandoffType | undefined;
	readonly kind: ActivityEventKind;
	readonly summary: string;
	readonly tool: string | undefined;
	readonly file_path: string | undefined;
	readonly diff_stat: IWireDiffStat | undefined;
	readonly command: string | undefined;
	readonly exit_code: number | undefined;
	readonly duration_ms: number | undefined;
	readonly raw: unknown;
	readonly payload: unknown;
}

export const enum MemoryRecordType {
	Decision = 'decision',
	Invariant = 'invariant',
	Finding = 'finding',
	FailurePattern = 'failure_pattern',
	Procedure = 'procedure',
	OpenQuestion = 'open_question',
}

export const enum MemoryScope {
	DispatchLocal = 'dispatch_local',
	TaskLocal = 'task_local',
	PlannerTree = 'planner_tree',
	WorkspaceGlobal = 'workspace_global',
	ReleaseLineage = 'release_lineage',
}

export const enum MemoryAuthority {
	Proposed = 'proposed',
	EvidenceAccepted = 'evidence_accepted',
	ScopePromoted = 'scope_promoted',
	Retired = 'retired',
}

export const enum MemoryLifecycleState {
	Candidate = 'candidate',
	Accepted = 'accepted',
	Promoted = 'promoted',
	Superseded = 'superseded',
	Rejected = 'rejected',
	Retired = 'retired',
	Answered = 'answered',
	Expired = 'expired',
}

export interface IWireMemoryReleaseLineage {
	readonly base_ref: string;
	readonly reviewed_head_sha: string;
	readonly merged_sha: string | undefined;
}

export interface IWireMemoryScopeContext {
	readonly anchor_task_id: string | undefined;
	readonly planner_id: string | undefined;
	readonly release_lineage: IWireMemoryReleaseLineage | undefined;
}

export interface IWireMemoryRecordHeader {
	readonly record_id: string;
	readonly memory_type: MemoryRecordType;
	readonly scope: MemoryScope;
	readonly scope_context: IWireMemoryScopeContext;
	readonly authority: MemoryAuthority;
	readonly lifecycle: MemoryLifecycleState;
	readonly task_id: string;
	readonly dispatch_id: string | undefined;
	readonly source_artifact_path: string;
	readonly source_digest: string;
	readonly created_by_role: string;
	readonly created_by_actor: string;
	readonly created_at: string;
	readonly supersedes_record_id: string | undefined;
	readonly derived_from_record_id: string | undefined;
}

export interface IWireMemoryDecisionBody {
	readonly decision_text: string;
	readonly scope_paths: readonly string[];
	readonly rationale: string | undefined;
}

export interface IWireMemoryInvariantBody {
	readonly invariant_text: string;
	readonly applies_to_paths: readonly string[];
	readonly rationale: string | undefined;
}

export interface IWireMemoryFindingBody {
	readonly finding_text: string;
	readonly evidence_summary: string | undefined;
}

export interface IWireMemoryFailurePatternBody {
	readonly pattern_text: string;
	readonly trigger_summary: string | undefined;
	readonly remediation_hint: string | undefined;
}

export interface IWireMemoryProcedureBody {
	readonly procedure_text: string;
	readonly applicability: string | undefined;
	readonly verification_hint: string | undefined;
}

export interface IWireMemoryOpenQuestionBody {
	readonly question_text: string;
	readonly blocking_reason: string | undefined;
	readonly expires_at: string | undefined;
}

export type IWireMemoryRecordBody =
	| { readonly memory_type: MemoryRecordType.Decision; readonly body: IWireMemoryDecisionBody }
	| { readonly memory_type: MemoryRecordType.Invariant; readonly body: IWireMemoryInvariantBody }
	| { readonly memory_type: MemoryRecordType.Finding; readonly body: IWireMemoryFindingBody }
	| { readonly memory_type: MemoryRecordType.FailurePattern; readonly body: IWireMemoryFailurePatternBody }
	| { readonly memory_type: MemoryRecordType.Procedure; readonly body: IWireMemoryProcedureBody }
	| { readonly memory_type: MemoryRecordType.OpenQuestion; readonly body: IWireMemoryOpenQuestionBody };

export interface IWireMemoryRecord {
	readonly header: IWireMemoryRecordHeader;
	readonly body: IWireMemoryRecordBody;
}
