# Atlas Phased Implementation Plan

> How to refactor the VS Code fork into a swarm-first software-factory control plane and couple it to the Syntropic Harness.

Fork cleanup is handled separately and not covered here. This plan assumes the fork is being cleaned in parallel and focuses exclusively on building the new Atlas architecture.

---

## Phase Map

| Phase | Name | Codebase | Depends On | Scope |
|-------|------|----------|------------|-------|
| 0a | Wire Contract Ratification | Both | — | ~2 files |
| 0b | State Model & Vocabulary | Atlas (TypeScript) | Phase 0a | ~25 files |
| 1 | Harness Daemon | Harness (Rust) | Phase 0a | ~15 files, new crate |
| 2 | Desktop Harness Bridge | Atlas (TypeScript) | Phase 0b | ~10 files |
| 3 | Swarm Derivation & Fleet State | Atlas (TypeScript) | Phase 0b, Phase 2 | ~12 files |
| 4 | Left Rail Navigation | Atlas (TypeScript) | Phase 3 | ~20 files |
| 5 | Fleet Command | Atlas (TypeScript) | Phase 3, Phase 4 | ~15 files |
| 6 | Review Surfaces | Atlas (TypeScript) | Phase 3, Phase 5 | ~20 files |
| 7 | Center Stage Modes | Atlas (TypeScript) | Phase 4, Phase 5, Phase 6 | ~25 files |
| 8 | Right Inspector | Atlas (TypeScript) | Phase 3 | ~12 files |
| 9 | Titlebar Redesign | Atlas (TypeScript) | Phase 3, Phase 5 | ~8 files |
| 10 | Multi-Monitor | Atlas (TypeScript) | Phase 7, Phase 8, Phase 9 | ~10 files |

Phase 0a ratifies the wire contract that both sides build against. Phases 0b and 1 then build in parallel — Phase 0b defines the TypeScript vocabulary Atlas consumes; Phase 1 builds the Rust daemon that produces it. Phase 2 connects them.

```
Phase 0a (wire contract) ──┬──▸ Phase 0b (TS model) ──▸ Phase 2 (bridge) ──▸ Phase 3 (fleet state) ──┬──▸ Phase 4 (left rail)
                           │                                                                          │
                           └──▸ Phase 1 (daemon) ──────────────────────────────────────────────────────┤
                                                                                                      ├──▸ Phase 5 (fleet cmd)
                                                                                                      │
                                                                                                      ├──▸ Phase 6 (review)
                                                                                                      │
                                                                                                      ├──▸ Phase 8 (inspector)
                                                                                                      │
                                                                                                      └──▸ Phase 9 (titlebar)
                                                                                                                 │
                                                                                           Phase 4+5+6 ──▸ Phase 7 (center stage)
                                                                                                                 │
                                                                                           Phase 7+8+9 ──▸ Phase 10 (multi-monitor)
```

---

## Phase 0a: Wire Contract Ratification

### Objective

Produce the authoritative wire contract that both the TypeScript model (Phase 0b) and the Rust daemon (Phase 1) build against. This is not a guessed vocabulary — it is a reviewed, agreed-upon mapping from actual harness table schemas and Rust struct fields to the JSON payloads the daemon will emit and Atlas will consume.

### Why First

Phase 0b (the TS model) and Phase 1 (the daemon) build in parallel and must agree on every field name, type, and cardinality. If the TS model guesses from current tables while the daemon serializes from Rust structs, the two will drift. A ratified contract prevents this by establishing one source of truth before either side begins implementation.

### Prerequisites

None. Requires reading the harness schema (defined in Rust `const` SQL strings) and the protocol crate types.

### Deliverables

```
syntropic-harness-fresh/docs/design/
└── WIRE_CONTRACT.md              The ratified contract

src/vs/sessions/common/model/
└── CONTRACT_REFERENCE.md         Pointer to the harness wire contract + deviation log
```

### Implementation Steps

#### 0a.1 — Audit every field the TS model will consume

Walk each harness source of truth and record exact field names, types, and nullability:

| Source | Harness Location | Key Fields |
|---|---|---|
| `worker_registry` | `pool.rs:15` | dispatch_id (TEXT PK), task_id, role_id, state, worktree_path, pid (INTEGER nullable), started_at, last_heartbeat_at — **no cost, no last_activity, no state_changed_at** |
| `dispatch_queue` | `pool.rs:26` | dispatch_id, idempotency_key, task_id, role_id, priority (TEXT), handoff_type, metadata (JSON), status, retry_count, enqueued_at, updated_at |
| `objectives` | `objective.rs:18` | objective_id, problem_statement, playbook_ids (JSON array), priority (TEXT: p0-p4), status, root_task_id (nullable), resume_count, max_resume_cycles, spec_json |
| `task_hierarchy` | `planner_hierarchy.rs:29` | task_id (PK), parent_task_id (nullable), depth, status, aggregation_strategy, created_at, completed_at |
| `review_candidates` | `merge_queue.rs:49` | dispatch_id, task_id, role_id, review_state, judge_decision, promotion_state, integration_state, reviewed_by_role, promotion_authorized_by_role + git/artifact fields |
| `merge_queue` | `merge_queue.rs:13` | dispatch_id, task_id, priority (INTEGER), status (pending/merge_started/merged/merge_blocked), judge_decision, merge_sha + git fields |
| `TaskPacket` | `workspace_types.rs:970` | acceptance: **Vec\<String\>**, constraints: **Vec\<String\>**, artifacts: Vec\<String\>, memory_keywords: Vec\<String\>, handoff_type: Option\<HandoffType\> |
| `ResultPacket` | `workspace_types.rs:1114` | status, decision: **Option**, acceptance_results: Vec, git fields — **no review_state, no promotion_state, no integration_state** |
| `PromotionRecord` | `workspace_types.rs:1074` | review_state, promotion_state, integration_state, judge_decision — **the authoritative gate wire type** |
| `ReviewQueueEntry` | `review.rs:20` | score, confidence, failed_checks — **advisory only, semantics: advisory_prioritization_only** |

#### 0a.2 — Define the daemon payload shapes

For each daemon notification and response, define the exact JSON shape. These are the wire types both sides implement.

Key corrections from naive table-mapping:

1. **Agent cost and activity are not in `worker_registry`.** The daemon must join or derive them:
   - `cost_spent` → computed from `dispatch_journal` token usage entries or `resource_snapshots`
   - `last_activity` → tailed from the agent's activity stream file (JSONL in the dispatch run directory)
   - `time_in_state` → computed client-side from `last_heartbeat_at` or `state_changed_at` (if the daemon adds a delta timestamp)

2. **TaskPacket.acceptance is `Vec<String>`, not `String`.** The wire payload must serialize as `string[]`.

3. **ResultPacket has no review/promotion/integration state.** Those live on `PromotionRecord` (derived from `review_candidates` and `merge_queue`). The daemon must serve them as a separate `promotion` sub-object, not flattened onto the result.

4. **Review state has three tiers** (see §0a.3).

#### 0a.3 — Ratify the three-tier review model

The harness has three distinct review/promotion structures that must NOT be collapsed into one `IReviewState`:

| Tier | Source | Semantics | Authoritative? |
|---|---|---|---|
| **Advisory Queue** | `review.rs:generate_review_queue()` → filesystem JSON | Heuristic prioritization: score, confidence, risk count. Used to rank what the operator looks at first. | No — `REVIEW_QUEUE_SEMANTICS = "advisory_prioritization_only"` |
| **Gate State** | `review_candidates` table | The authoritative review/promotion state machine: `review_state` (NotRequested→AwaitingReview→ReviewGo), `judge_decision` (Go/NoGo), `promotion_state` (NotRequested→PromotionRequested→PromotionAuthorized) | **Yes** — these fields are the actual gate |
| **Merge/Integration** | `merge_queue` table | Post-gate merge execution: status (pending→merge_started→merged\|merge_blocked), merge_sha, conflict_details | **Yes** — entries created only by `enqueue_promoted_candidate()` which validates all gate conditions |

The daemon wire contract must preserve this separation. The daemon emits:
- `review.advisory_queue` notifications (coalescible) — for prioritization UI
- `review.gate_state` notifications (loss-intolerant) — for gate verdicts and promotion state
- `merge.queue` notifications (loss-intolerant) — for merge execution state

#### 0a.4 — Produce the contract document

Write `WIRE_CONTRACT.md` in the harness docs with:
1. Every daemon method and its exact JSON request/response shapes
2. Every notification topic and its exact JSON payload shape
3. Field-level mapping table: daemon JSON field → harness Rust source (file:line)
4. Explicit list of derived/computed fields (not direct DB columns) with derivation source
5. The three-tier review model with which daemon topic serves which tier

Both the TypeScript model (Phase 0b) and the Rust daemon (Phase 1) implement from this document, not from each other.

### Validation

- Every field in the contract traces to a specific Rust struct field or SQL column (with file:line reference)
- Every computed/derived field documents its computation source
- The three-tier review model is explicitly preserved
- The contract is reviewed by both the Atlas and harness implementors before Phase 0b or Phase 1 begins

---

## Phase 0b: State Model & Vocabulary

### Objective

Define every first-class Atlas noun as a TypeScript interface, derived from the ratified wire contract (Phase 0a). These types are the shared contract that every view, service, and bridge consumes. No behavior — pure types and enums.

### Why First

Every subsequent phase imports from `sessions/common/model/`. Getting the vocabulary right before any behavior is built prevents churn across all consumers. This phase is also the cheapest to iterate on — changing an interface is cheaper than changing an implementation.

### Prerequisites

Phase 0a (wire contract ratified). The TS types are derived from the contract, not guessed from tables.

### Deliverables

```
src/vs/sessions/common/model/
├── types.ts              Re-exports all model types (barrel file)
├── objective.ts          IObjectiveState, ObjectiveStatus, IObjectiveBoard
├── swarm.ts              ISwarmState, ISwarmBoard, ISwarmLane, SwarmPhase
├── task.ts               ITaskState, ITaskQueue, TaskStatus, TaskHandoffType
├── agent.ts              IAgentState, IFleetState, AgentRole, AgentStatus
├── worktree.ts           IWorktreeState
├── run.ts                IRunState, ITranscriptEntry, IToolCall
├── artifact.ts           IArtifactRef, ArtifactKind
├── review.ts             Three-tier review model: IAdvisoryReviewEntry, IReviewGateState, IMergeEntry
├── policy.ts             IPolicyState
├── cost.ts               ICostState, ICostBreakdown
├── health.ts             IHealthState, PoolMode
├── attention.ts          IAttentionFlag, AttentionLevel, attention scoring algorithm
├── selection.ts          ISelectedEntity, EntityKind
└── wire.ts               Wire format types (TaskPacket, ResultPacket, WorkspaceEvent, DispatchCommand)
```

### Implementation Steps

#### 0.1 — Wire format types (`wire.ts`)

Map the harness protocol types to TypeScript. These are the raw shapes that come over the daemon socket or from SQLite polling. They mirror the Rust types in `syntropic-protocol/src/workspace_types.rs` and `syntropic-protocol/src/memory.rs`.

```typescript
// wire.ts — maps to syntropic-protocol workspace_types.rs

export const enum HandoffType {
	Intake = 'intake',
	Planning = 'planning',
	Specification = 'specification',
	Implementation = 'implementation',
	Verification = 'verification',
	Review = 'review',
	Clarification = 'clarification',
}

export const enum DispatchStatus {
	Done = 'done',
	Blocked = 'blocked',
	Failed = 'failed',
	NeedsClarification = 'needs_clarification',
}

// Serialization must match workspace_types.rs:1003 exactly
export const enum ReviewDecision {
	Go = 'go',
	NoGo = 'no-go',              // Rust: #[serde(rename = "no-go")]
	NotApplicable = 'n/a',       // Rust: #[serde(rename = "n/a")]
}

export interface IWireTaskPacket {
	readonly task_id: string;
	readonly created_at: string;
	readonly from_role: string;
	readonly to_role: string;
	readonly summary: string;
	readonly acceptance: readonly string[];      // Vec<String> in Rust — multi-item criteria list
	readonly constraints: readonly string[];     // Vec<String> in Rust — multi-item constraints list
	readonly artifacts: readonly string[];
	readonly memory_keywords: readonly string[];
	readonly handoff_type: HandoffType | undefined;
	readonly git_branch: string | undefined;
	readonly git_base: string | undefined;
	readonly allow_push: boolean;
	readonly allow_merge: boolean;
}

// ResultPacket has NO review_state/promotion_state/integration_state.
// Those live on IWirePromotionRecord (from review_candidates / merge_queue).
export interface IWireResultPacket {
	readonly task_id: string;
	readonly from_role: string;
	readonly to_role: string;
	readonly status: DispatchStatus;
	readonly decision: ReviewDecision | undefined;  // Option<ResultPacketDecision> in Rust
	readonly acceptance_results: readonly IWireAcceptanceResult[];
	readonly git_branch: string | undefined;
	readonly head_sha: string | undefined;
	readonly commit_shas: readonly string[];
	readonly working_tree_clean: boolean;
	readonly merge_ready: boolean;
}

export interface IWireAcceptanceResult {
	readonly criterion: string;
	readonly met: boolean;
	readonly evidence: string | undefined;
}

// The authoritative gate state — from review_candidates table.
// This is the wire type for the review/promotion state machine.
export interface IWirePromotionRecord {
	readonly task_id: string;
	readonly dispatch_id: string;
	readonly review_state: WireReviewState;
	readonly judge_decision: ReviewDecision | undefined;
	readonly reviewed_by_role: string | undefined;
	readonly reviewed_at: string | undefined;
	readonly promotion_state: WirePromotionState;
	readonly promotion_authorized_at: string | undefined;
	readonly promotion_authorized_by_role: string | undefined;
	readonly integration_state: WireIntegrationState;
	readonly merged_sha: string | undefined;
	readonly merge_executor_id: string | undefined;
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

// The advisory prioritization snapshot — from generate_review_queue() filesystem scan.
// NOT authoritative. Used for sorting the review queue in the UI.
export interface IWireAdvisoryReviewEntry {
	readonly task_id: string;
	readonly score: number;
	readonly confidence: number;
	readonly failed_checks: number;
	readonly risks_count: number;
	readonly touched_surface: number;
	readonly decision: string;
	readonly summary: string;
}

export interface IWireDispatchCommand {
	readonly role_id: string;
	readonly task_id: string;
	readonly message: string;
}
```

Key principle: wire types use `snake_case` matching the JSON-RPC payloads. Presentation types (all other model files) use `camelCase` matching TypeScript convention. The bridge layer (Phase 2) maps between them.

#### 0.2 — Presentation model types

Each file defines the Atlas-facing interface for one noun. Every state interface must:

1. Extend or include an `id: string` field
2. Include an `attentionLevel: AttentionLevel` computed field
3. Be fully readonly (immutable snapshots, not live-mutated objects)
4. Map cleanly from one or more harness tables

**`objective.ts`** — Maps from `objectives` table + aggregated child state.

```typescript
export const enum ObjectiveStatus {
	Open = 'open',
	Planning = 'planning',
	Executing = 'executing',
	Reviewing = 'reviewing',
	Completed = 'completed',
	Failed = 'failed',
}

export interface IObjectiveState {
	readonly objectiveId: string;
	readonly problemStatement: string;
	readonly status: ObjectiveStatus;
	readonly rootTaskId: string | undefined;  // nullable in DB until objective is linked to a task
	readonly priority: string;                // TEXT in DB: 'p0'–'p4' (not number)
	readonly resumeCount: number;
	readonly maxResumeCycles: number;
	readonly costSpent: number;               // derived: sum of child swarm costs
	readonly costCeiling: number | undefined;
	readonly attentionLevel: AttentionLevel;
	readonly createdAt: number;  // unix ms
	readonly updatedAt: number;
}
```

**`swarm.ts`** — The first-class execution aggregate. Not a single harness table — derived by the swarm derivation algorithm (Phase 3) from the `task_hierarchy` rooted at one root task, plus the agent graph, memory lane, worktree set, and review state descended from that root.

A swarm is **root-task-first**: the `swarmId` is always the `rootTaskId`. Objectives are metadata attached to swarms when the root task was created via `ObjectiveIntakeService`, but a swarm can exist without an objective (e.g. ad-hoc dispatches). The harness exposes root-task lineage directly through `task_hierarchy.parent_task_id IS NULL` and `objectives.root_task_id`, so derivation starts from root tasks and attaches objective context when present.

```typescript
export const enum SwarmPhase {
	Planning = 'planning',
	Executing = 'executing',
	Reviewing = 'reviewing',
	Merging = 'merging',
	Completed = 'completed',
	Failed = 'failed',
}

export interface ISwarmState {
	readonly swarmId: string;              // = rootTaskId (always)
	readonly rootTaskId: string;           // task_hierarchy entry where parent_task_id IS NULL
	readonly objectiveId: string | undefined;  // attached when root task was created via objective intake; undefined for ad-hoc
	readonly objectiveStatus: IObjectiveState['status'] | undefined;
	readonly objectiveProblemStatement: string | undefined;
	readonly rootTaskStatus: ITaskState['status'];
	readonly phase: SwarmPhase;
	readonly taskIds: readonly string[];
	readonly agentDispatchIds: readonly string[];
	readonly worktreePaths: readonly string[];
	readonly reviewDispatchIds: readonly string[];
	readonly mergeDispatchIds: readonly string[];
	readonly reviewNeeded: boolean;
	readonly mergeBlocked: boolean;
	readonly hasFailures: boolean;
	readonly hasBlockedTasks: boolean;
	readonly memoryRecordCount: number;
	readonly costSpent: number;
	readonly costCeiling: number | undefined;
	readonly attentionLevel: AttentionLevel;
	readonly createdAt: number;
	readonly updatedAt: number;
}
```

**`task.ts`** — Maps from `dispatch_queue` + `task_hierarchy` + `dispatch_journal`.

```typescript
export const enum TaskStatus {
	Queued = 'queued',
	Executing = 'executing',
	Blocked = 'blocked',
	Reviewing = 'reviewing',
	Completed = 'completed',
	Failed = 'failed',
	Cancelled = 'cancelled',
}

export interface ITaskState {
	readonly taskId: string;
	readonly dispatchId: string | undefined;  // undefined if not yet dispatched
	readonly parentTaskId: string | undefined;
	readonly objectiveId: string | undefined;  // undefined for ad-hoc dispatches and sub-planner fan-out tasks; derived via objective.root_task_id linkage when present
	readonly roleId: string;
	readonly summary: string;
	readonly handoffType: HandoffType;
	readonly status: TaskStatus;
	readonly priority: number;
	readonly dependsOn: readonly string[];     // task IDs
	readonly assignedAgentId: string | undefined;  // dispatch_id of executing worker
	readonly costSpent: number;
	readonly attentionLevel: AttentionLevel;
	readonly enqueuedAt: number;
	readonly startedAt: number | undefined;
	readonly completedAt: number | undefined;
}
```

**`agent.ts`** — Maps from `worker_registry` (direct columns) + daemon-derived fields.

The `worker_registry` table stores only: `dispatch_id`, `task_id`, `role_id`, `state`, `worktree_path`, `pid`, `started_at`, `last_heartbeat_at`. It has **no cost, no last_activity, no state_changed_at**. Those fields are derived by the daemon or computed client-side:

| Presentation Field | Source |
|---|---|
| `dispatchId`, `taskId`, `roleId`, `state`, `worktreePath`, `pid`, `startedAt`, `lastHeartbeat` | Direct from `worker_registry` columns |
| `role` | Derived from `roleId` naming convention (e.g. `axiom-planner` → Planner) |
| `costSpent` | Daemon joins from `dispatch_journal` token usage or `resource_snapshots`; **not in worker_registry** |
| `lastActivity` | Daemon tails the agent's activity stream JSONL file; **not in worker_registry** |
| `timeInState` | Computed client-side: `Date.now() - lastHeartbeat` (or daemon provides `state_changed_at` delta) |
| `attentionLevel` | Computed client-side by `computeAgentAttention()` |

```typescript
export const enum AgentRole {
	Planner = 'planner',
	Worker = 'worker',
	Judge = 'judge',
}

export const enum AgentStatus {
	Spawning = 'spawning',
	Running = 'running',
	Idle = 'idle',
	Blocked = 'blocked',
	Completed = 'completed',
	Failed = 'failed',
	TimedOut = 'timed_out',
}

export interface IAgentState {
	// --- Direct from worker_registry ---
	readonly dispatchId: string;       // worker_registry PK
	readonly taskId: string;           // worker_registry.task_id
	readonly roleId: string;           // worker_registry.role_id
	readonly status: AgentStatus;      // mapped from worker_registry.state
	readonly worktreePath: string | undefined;  // worker_registry.worktree_path
	readonly pid: number | undefined;  // worker_registry.pid (nullable)
	readonly startedAt: number;        // worker_registry.started_at (unix ms)
	readonly lastHeartbeat: number;    // worker_registry.last_heartbeat_at (unix ms)

	// --- Derived by daemon (not in worker_registry) ---
	readonly role: AgentRole;          // derived from roleId naming convention
	readonly costSpent: number;        // daemon joins from dispatch_journal/resource_snapshots
	readonly lastActivity: string | undefined;  // daemon tails activity stream JSONL

	// --- Computed client-side ---
	readonly timeInState: number;      // ms since last state transition (client computes from heartbeat)
	readonly attentionLevel: AttentionLevel;  // computeAgentAttention()
}

export interface IFleetState {
	readonly agents: readonly IAgentState[];
	readonly activeCount: number;
	readonly idleCount: number;
	readonly blockedCount: number;
	readonly failedCount: number;
	readonly totalCostSpent: number;    // sum of all agent costSpent (daemon-derived)
}
```

**`review.ts`** — The review model preserves the harness's three-tier boundary between advisory prioritization, authoritative gate state, and merge execution. These are NOT collapsed into one interface.

```typescript
// ─── Tier 1: Advisory Queue (from generate_review_queue() filesystem scan) ───
// NOT authoritative. Used only for sorting what the operator looks at first.
// Source: review.rs — semantics: "advisory_prioritization_only"

export interface IAdvisoryReviewEntry {
	readonly taskId: string;
	readonly score: number;            // heuristic ranking score
	readonly confidence: number;       // 0.0–1.0
	readonly failedChecks: number;
	readonly risksCount: number;
	readonly touchedSurface: number;   // number of files/modules affected
	readonly decision: string;         // raw decision string from result packet
	readonly summary: string;
	readonly updatedAt: number;
}

// ─── Tier 2: Gate State (from review_candidates table — AUTHORITATIVE) ───
// The actual review/promotion state machine. These fields are the gate.
// Source: merge_queue.rs:49 (review_candidates table)

export const enum GateReviewState {
	NotRequested = 'not_requested',
	AwaitingReview = 'awaiting_review',
	ReviewBlocked = 'review_blocked',
	ReviewGo = 'review_go',
}

export const enum GatePromotionState {
	NotRequested = 'not_requested',
	PromotionRequested = 'promotion_requested',
	PromotionAuthorized = 'promotion_authorized',
	Abandoned = 'abandoned',
}

export interface IReviewGateState {
	readonly dispatchId: string;       // review_candidates PK
	readonly taskId: string;
	readonly roleId: string;
	readonly reviewState: GateReviewState;
	readonly judgeDecision: ReviewDecision | undefined;
	readonly reviewedByRole: string | undefined;
	readonly reviewedAt: number | undefined;
	readonly promotionState: GatePromotionState;
	readonly promotionAuthorizedAt: number | undefined;
	readonly promotionAuthorizedByRole: string | undefined;
	readonly candidateBranch: string;
	readonly reviewedHeadSha: string;
	readonly attentionLevel: AttentionLevel;
	readonly createdAt: number;
	readonly updatedAt: number;
}

// ─── Tier 3: Merge/Integration State (from merge_queue table — AUTHORITATIVE) ───
// Post-gate merge execution. Entries exist only after enqueue_promoted_candidate()
// validates: review_state==ReviewGo, judge_decision==Go,
// promotion_state==PromotionAuthorized, reviewed_by_role=="axiom-judge",
// promotion_authorized_by_role=="axiom-planner".
// Source: merge_queue.rs:13

export const enum MergeExecutionStatus {
	Pending = 'pending',
	MergeStarted = 'merge_started',
	Merged = 'merged',
	MergeBlocked = 'merge_blocked',
}

export interface IMergeEntry {
	readonly dispatchId: string;       // merge_queue PK
	readonly taskId: string;
	readonly candidateBranch: string;
	readonly baseRef: string;
	readonly priority: number;
	readonly status: MergeExecutionStatus;
	readonly mergeSha: string | undefined;
	readonly conflictDetails: string | undefined;
	readonly mergeExecutorId: string | undefined;
	readonly mergedAt: number | undefined;
	readonly blockedReason: string | undefined;
	readonly attentionLevel: AttentionLevel;
	readonly enqueuedAt: number;
}

// ─── Convenience: UI review phase (presentation concept, not harness concept) ───

export const enum ReviewPhase {
	PreExecution = 'pre_execution',     // task has spec + plan but no agent yet
	InFlight = 'in_flight',             // agent executing, operator can steer
	PostExecution = 'post_execution',   // agent done, gate state pending verdict
}

export interface IDiffStats {
	readonly filesChanged: number;
	readonly insertions: number;
	readonly deletions: number;
}

export interface ITestResults {
	readonly passed: number;
	readonly failed: number;
	readonly skipped: number;
	readonly coveragePercent: number | undefined;
}

// ReviewDecision is re-exported from wire.ts (Go/NoGo/NotApplicable)
```

**`attention.ts`** — The attention model drives what surfaces at the top of every list across all views.

```typescript
export const enum AttentionLevel {
	Critical = 4,    // agent failed, over-budget, incident open
	NeedsAction = 3, // review pending, agent blocked, drift detected
	Active = 2,      // agent executing, task in progress
	Idle = 1,        // agent waiting, no work queued
	Completed = 0,   // done, merged, fades to history
}

export interface IAttentionFlag {
	readonly level: AttentionLevel;
	readonly reason: string;
	readonly entityKind: EntityKind;
	readonly entityId: string;
	readonly since: number;  // unix ms when this attention level was entered
}

/**
 * Compute attention level for an agent.
 *
 * Priority order:
 * 1. Failed/timed-out → Critical
 * 2. Blocked or idle beyond threshold → NeedsAction
 * 3. Running → Active
 * 4. Idle within threshold → Idle
 * 5. Completed → Completed
 */
export function computeAgentAttention(agent: IAgentState, idleThresholdMs: number): AttentionLevel;

/**
 * Compute attention level for a task.
 *
 * Priority order:
 * 1. Failed → Critical
 * 2. Blocked, or has pending gate review (AwaitingReview) → NeedsAction
 * 3. Executing → Active
 * 4. Queued → Idle
 * 5. Completed → Completed
 */
export function computeTaskAttention(task: ITaskState, gate: IReviewGateState | undefined): AttentionLevel;

/**
 * Compute attention level for a swarm.
 * Returns the highest attention level across all child tasks, agents, and gate states.
 */
export function computeSwarmAttention(swarm: ISwarmState, children: { tasks: ITaskState[]; agents: IAgentState[]; gates: IReviewGateState[] }): AttentionLevel;
```

**`selection.ts`** — The global selection model that every view reacts to.

```typescript
export const enum EntityKind {
	Agent = 'agent',
	Task = 'task',
	Objective = 'objective',
	Swarm = 'swarm',
	Review = 'review',
	Worktree = 'worktree',
	Artifact = 'artifact',
}

export interface ISelectedEntity {
	readonly kind: EntityKind;
	readonly id: string;
}
```

**Remaining files** (`health.ts`, `cost.ts`, `worktree.ts`, `artifact.ts`, `policy.ts`, `run.ts`) follow the same pattern — each maps from one or more harness tables to a readonly presentation interface with an attention level. Merge state is part of the three-tier review model in `review.ts`.

#### 0.3 — IHarnessService interface

This is the contract between the bridge (Phase 2) and all consumers (Phase 3+). Defined in `sessions/services/harness/common/harnessService.ts`.

```typescript
// sessions/services/harness/common/harnessService.ts

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IObservable } from 'vs/base/common/observable';
import { Event } from 'vs/base/common/event';

export const IHarnessService = createDecorator<IHarnessService>('harnessService');

export const enum HarnessConnectionState {
	Disconnected = 'disconnected',
	Connecting = 'connecting',
	Connected = 'connected',
	Reconnecting = 'reconnecting',
	Error = 'error',
}

export interface IHarnessConnectionInfo {
	readonly state: HarnessConnectionState;
	readonly mode: 'daemon' | 'polling' | 'none';
	readonly writesEnabled: boolean;   // Coarse: true only when some daemon writes are truly available
	readonly supportedWriteMethods: readonly HarnessSupportedWriteMethod[]; // Exact shipped write subset
	readonly daemonVersion: string | undefined;
	readonly schemaVersion: string | undefined;
	readonly grantedCapabilities: readonly string[];
	readonly errorMessage: string | undefined;
}

export interface IHarnessService {
	readonly _serviceBrand: undefined;

	// --- Connection lifecycle ---
	readonly connectionState: IObservable<IHarnessConnectionInfo>;
	connect(workspaceRoot: URI): Promise<void>;
	disconnect(): Promise<void>;
	readonly onDidDisconnect: Event<void>;

	// --- Observables (push from daemon, read-only from polling fallback) ---
	readonly objectives: IObservable<readonly IObjectiveState[]>;
	readonly swarms: IObservable<readonly ISwarmState[]>;
	readonly tasks: IObservable<readonly ITaskState[]>;
	readonly fleet: IObservable<IFleetState>;
	readonly health: IObservable<IHealthState>;
	readonly cost: IObservable<ICostState>;

	// --- Review observables (three-tier model) ---
	readonly advisoryReviewQueue: IObservable<readonly IAdvisoryReviewEntry[]>;  // Tier 1: prioritization
	readonly reviewGates: IObservable<readonly IReviewGateState[]>;              // Tier 2: authoritative verdicts
	readonly mergeQueue: IObservable<readonly IMergeEntry[]>;                    // Tier 3: merge execution

	// --- Inspection (pull) ---
	getObjective(objectiveId: string): Promise<IObjectiveState | undefined>;
	getSwarm(swarmId: string): Promise<ISwarmState | undefined>;
	getTask(taskId: string): Promise<ITaskState | undefined>;
	getAgent(dispatchId: string): Promise<IAgentState | undefined>;
	getReviewGate(dispatchId: string): Promise<IReviewGateState | undefined>;
	getTranscript(dispatchId: string): Promise<readonly ITranscriptEntry[]>;
	getMemoryRecords(swarmId: string): Promise<readonly IMemoryRecord[]>;
	getWorktreeState(dispatchId: string): Promise<IWorktreeState | undefined>;

	// --- Control (Wave A: fail closed in all modes until daemon control methods exist) ---
	pauseAgent(dispatchId: string): Promise<void>;
	resumeAgent(dispatchId: string): Promise<void>;
	cancelAgent(dispatchId: string): Promise<void>;
	steerAgent(dispatchId: string, message: string): Promise<void>;
	pauseAll(): Promise<void>;
	resumeAll(): Promise<void>;

	// --- Dispatch (Wave A: fail closed in all modes until daemon dispatch methods exist) ---
	submitObjective(problemStatement: string, options?: IObjectiveSubmitOptions): Promise<string>;
	submitDispatch(command: IWireDispatchCommand): Promise<string>;

	// --- Review actions (Wave A: fail closed in all modes until daemon review methods exist) ---
	// NOTE: The daemon does NOT expose a single "review.approve" that maps to a
	// nonexistent CoreStore::record_review_decision(). Instead, the daemon wraps
	// the actual stable harness mutation surface:
	// - Gate verdict → updates review_candidates.review_state + judge_decision
	//   via upsert_review_candidate() (merge_queue.rs)
	// - Promotion authorization → updates review_candidates.promotion_state
	//   via upsert_review_candidate() (merge_queue.rs)
	// - Merge enqueue → validates all gate conditions and inserts into merge_queue
	//   via enqueue_promoted_candidate() (merge_queue.rs)
	recordGateVerdict(dispatchId: string, decision: ReviewDecision, reviewedByRole: string): Promise<void>;
	authorizePromotion(dispatchId: string, authorizedByRole: string): Promise<void>;
	enqueueForMerge(dispatchId: string): Promise<void>;

	// --- Activity streams ---
	subscribeAgentActivity(dispatchId: string): IObservable<readonly ITranscriptEntry[]>;
	subscribeSwarmActivity(swarmId: string): IObservable<readonly ITranscriptEntry[]>;
}
```

#### 0.4 — IFleetManagementService interface

The selection and navigation service. Replaces `ISessionsManagementService` as the conceptual owner of "what is active/selected."

```typescript
// sessions/services/fleet/common/fleetManagementService.ts

export const IFleetManagementService = createDecorator<IFleetManagementService>('fleetManagementService');

export interface IFleetManagementService {
	readonly _serviceBrand: undefined;

	// --- Selection ---
	readonly selection: IObservable<INavigationSelection>;
	readonly selectedSection: IObservable<NavigationSection>;
	readonly selectedEntity: IObservable<ISelectedEntity | undefined>;
	selectSection(section: NavigationSection): void;
	selectEntity(entity: ISelectedEntity | undefined): void;
	selectAgent(dispatchId: string): void;
	selectTask(taskId: string): void;
	selectObjective(objectiveId: string): void;
	selectSwarm(swarmId: string): void;
	selectReview(dispatchId: string): void;
	clearSelection(): void;

	// --- Navigation ---
	openSwarmBoard(swarmId: string): Promise<void>;
	openObjectiveBoard(objectiveId: string): Promise<void>;
	openAgentView(dispatchId: string): Promise<void>;
	openFleetGrid(): Promise<void>;
	openReview(dispatchId: string): Promise<void>;

	// --- Context keys (for view visibility) ---
	readonly selectedEntityKind: IObservable<EntityKind | undefined>;
}
```

### Validation

- `npm run compile-check-ts-native` passes with zero errors
- `npm run valid-layers-check` passes — all new files are in `vs/sessions/common/` or `vs/sessions/services/`, which is above `vs/workbench` in the layering hierarchy
- Every interface field traces to the ratified wire contract (Phase 0a WIRE_CONTRACT.md) — no guessed fields
- Every computed/derived field (e.g. `costSpent`, `lastActivity`, `timeInState` on agents) is annotated with its derivation source and is NOT assumed to come from a DB column
- The three-tier review model (advisory / gate / merge) is preserved — no collapsed `IReviewState`
- Wire types use `readonly string[]` for `acceptance` and `constraints` (matching `Vec<String>` in Rust), not `string | undefined`
- No runtime behavior yet — this phase is pure types

---

## Phase 1: Harness Daemon

### Objective

Build the `syntropic-daemon` crate — a long-running Rust process that exposes the harness state over JSON-RPC 2.0 on a Unix domain socket, per the approved `DAEMON_ARCHITECTURE.md` spec.

### Why Now

The daemon is the critical path for real-time push from harness to Atlas. Without it, Atlas is read-only — it can browse state via polling but cannot issue any writes (pause, steer, approve, dispatch). This is by design: the daemon is the single authenticated control plane. Building the daemon in parallel with Phase 0b (after the wire contract is ratified in Phase 0a) means Phase 2 can connect them immediately.

### Prerequisites

Phase 0a (wire contract ratified). The daemon implements the server side of the ratified contract.

### Deliverables

```
syntropic-harness-fresh/
├── Cargo.toml                        (add syntropic-daemon to workspace members)
└── crates/syntropic-daemon/
    ├── Cargo.toml
    └── src/
        ├── lib.rs                    Public API: start_daemon(), DaemonConfig
        ├── server.rs                 Socket listener, connection accept loop
        ├── session.rs                Per-client session: auth, capability, subscriptions
        ├── protocol.rs               JSON-RPC message types, serialize/deserialize
        ├── auth.rs                   Token registry, SHA-256 verification, peer credentials
        ├── reactor.rs                State reactor: polls CoreStore, computes deltas
        ├── subscriptions.rs          Subscription manager: topic routing, sequence tracking
        ├── streams.rs                Stream classification: coalescible vs loss-intolerant
        ├── methods/
        │   ├── mod.rs
        │   ├── initialize.rs         Handshake: version/capability/schema negotiation
        │   ├── daemon.rs             daemon.ping
        │   ├── fleet.rs              fleet.snapshot, fleet.subscribe, fleet.unsubscribe
        │   ├── health.rs             health.get, health.subscribe
        │   ├── objective.rs          objective.get, objective.list, objective.subscribe
        │   ├── review.rs             review.get, review.list, review.subscribe
        │   ├── merge.rs              merge.get, merge.list, merge.subscribe
        │   ├── task.rs               task.get, task.list, task.tree
        │   ├── cost.rs               cost.get
        │   ├── activity.rs           agent.activity.get
        │   └── transcript.rs         transcript.get
        └── audit.rs                  Audit log: rid correlation, structured logging
```

### Implementation Steps

#### 1.1 — Crate scaffolding and protocol types

Create `syntropic-daemon` crate depending on `syntropic-core` and `syntropic-protocol`. Define the JSON-RPC 2.0 message envelope:

```rust
// protocol.rs
#[derive(Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,        // always "2.0"
    pub method: String,
    pub params: Option<Value>,
    pub id: Option<Value>,      // None for notifications
}

#[derive(Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub result: Option<Value>,
    pub error: Option<JsonRpcError>,
    pub id: Value,
}

#[derive(Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    pub params: Value,
}
```

Framing: newline-delimited JSON (each message is one line terminated by `\n`). This matches LSP, MCP, and the Codex App Server pattern.

#### 1.2 — Socket server and connection lifecycle

The server listens on `~/.codex/harness.sock` (configurable via `AXIOM_HARNESS_SOCK` env var). Each incoming connection spawns a tokio task that:

1. Reads the first message, which must be `initialize`
2. Validates the client token against the token registry (`~/.codex/daemon-clients.yaml`)
3. Checks peer credentials (`SO_PEERCRED` on Linux, `LOCAL_PEERCRED` on macOS) as supplementary verification
4. Returns the `initialize` response with granted capabilities, server info, schema version, and limits
5. Enters the message loop: dispatch requests to method handlers, push notifications to subscriptions

Connection limits: max 16 concurrent clients (configurable). Backpressure: per-client bounded notification queue (4096 entries). If a slow client falls behind on a coalescible stream, coalesce. If it falls behind on a loss-intolerant stream, disconnect with `resync_required`.

#### 1.3 — Authentication and capability model

```rust
// auth.rs
pub struct TokenRegistry {
    entries: Vec<TokenEntry>,
}

pub struct TokenEntry {
    pub token_id: String,
    pub token_hash: [u8; 32],  // SHA-256 of the token string
    pub identity: String,       // e.g. "operator:xavier"
    pub capabilities: Vec<Capability>,
    pub issued_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

pub enum Capability {
    Read,       // Subscribe to streams, query state
    Control,    // Pause/resume/cancel agents
    Steer,      // Send steering messages to agents
    Dispatch,   // Submit new dispatches and objectives
    Event,      // Emit workspace events
}
```

Token issuance: `axiom-harness token issue --identity operator:xavier --capabilities read,control,steer,dispatch`. Prints plaintext token once to stdout. Stores SHA-256 hash in `~/.codex/daemon-clients.yaml` (file mode 0600).

Capability enforcement: each method handler checks required capabilities before executing. `fleet.subscribe` requires `read`. `control.pause` requires `control`. `dispatch.submit` requires `dispatch`.

#### 1.4 — State reactor

The reactor is the core innovation over direct polling. It runs as a dedicated tokio task that:

1. Polls `CoreStore` on a configurable interval (default 200ms for fleet, 500ms for health/cost)
2. Maintains the previous snapshot in memory
3. Computes deltas: new/changed/removed agents, tasks, objectives, reviews
4. Serializes deltas as JSON-RPC notifications
5. Pushes to the subscription manager, which routes to subscribed clients

```rust
// reactor.rs (simplified)
pub struct StateReactor {
    store: Arc<CoreStore>,
    prev_fleet: Option<FleetSnapshot>,
    prev_objectives: Option<Vec<ObjectiveRow>>,
    // ...per-topic previous state
}

impl StateReactor {
    pub async fn run(&mut self, tx: mpsc::Sender<TopicDelta>) {
        let mut fleet_interval = interval(Duration::from_millis(200));
        let mut health_interval = interval(Duration::from_millis(500));

        loop {
            tokio::select! {
                _ = fleet_interval.tick() => {
                    let snapshot = self.store.load_fleet_snapshot()?;
                    if let Some(delta) = self.diff_fleet(&snapshot) {
                        tx.send(TopicDelta::Fleet(delta)).await?;
                    }
                    self.prev_fleet = Some(snapshot);
                }
                _ = health_interval.tick() => {
                    // similar for health, cost, objectives, tasks, reviews
                }
            }
        }
    }
}
```

The reactor reuses the `FleetSnapshot` pattern from the TUI (`syntropic-cli/src/tui/data.rs`) — same `CoreStore` queries, same data, but now computing deltas instead of full repaints.

#### 1.5 — Subscription manager and stream classification

Subscriptions are per-client, per-topic. Each subscription tracks:

- Topic name (e.g. `fleet`, `agent.activity:{dispatch_id}`, `health`)
- Last sent sequence number (monotonic per topic)
- Stream classification: coalescible or loss-intolerant

```rust
// streams.rs
pub enum StreamClass {
    /// Stale snapshots can be replaced by newer ones.
    /// Fleet, health, cost — coalesce on slow client.
    Coalescible,
    /// Every event matters. Reviews, journal, transcripts —
    /// never silently drop. Disconnect with resync_required if client falls behind.
    LossIntolerant,
}

pub fn classify_topic(topic: &str) -> StreamClass {
    match topic {
        "fleet" | "health" | "cost" => StreamClass::Coalescible,
        _ if topic.starts_with("review") => StreamClass::LossIntolerant,
        _ if topic.starts_with("agent.activity") => StreamClass::LossIntolerant,
        _ if topic.starts_with("journal") => StreamClass::LossIntolerant,
        _ => StreamClass::Coalescible,
    }
}
```

Resumable streams: when a client reconnects and sends `subscribe` with `resume_from_seq`, the subscription manager replays from its per-topic history buffer (bounded ring buffer, default 1024 entries). If the requested sequence is too old, it sends `resync_required: true` and the client must do a full state fetch.

#### 1.6 — Write delegation

The daemon delegates all writes to existing harness APIs in `syntropic-core`. It never inserts rows directly.

| Daemon Method | Harness API | Entry Point | Notes |
|---|---|---|---|
| `control.pause` | `CoreStore::enqueue_control_action()` | `pool.rs` | |
| `control.resume` | `CoreStore::enqueue_control_action()` | `pool.rs` | |
| `control.cancel` | `CoreStore::enqueue_control_action()` | `pool.rs` | |
| `control.steer` | `CoreStore::enqueue_control_action()` | `pool.rs` | |
| `dispatch.submit` | `CoreStore::enqueue_dispatch()` | `pool.rs` | |
| `objective.submit` | `ObjectiveIntakeService::create_objective()` | `objective_service.rs` | |
| `review.gate_verdict` | `CoreStore::upsert_review_candidate()` | `merge_queue.rs` | Updates review_state + judge_decision on review_candidates |
| `review.authorize_promotion` | `CoreStore::upsert_review_candidate()` | `merge_queue.rs` | Updates promotion_state on review_candidates |
| `review.enqueue_merge` | `CoreStore::enqueue_promoted_candidate()` | `merge_queue.rs` | Validates all gate conditions, creates merge_queue entry |
| `event.emit` | `CoreStore::enqueue_workspace_event()` | `event_queue.rs` | |

**Important**: There is no `CoreStore::record_review_decision()`. The stable mutation surface for review verdicts is `upsert_review_candidate()` which updates the `review_candidates` table. The promotion gate is enforced by `enqueue_promoted_candidate()` which validates `review_state==ReviewGo`, `judge_decision==Go`, `promotion_state==PromotionAuthorized`, `reviewed_by_role=="axiom-judge"`, and `promotion_authorized_by_role=="axiom-planner"` before creating the `merge_queue` entry.

Every write generates a request ID (`rid`) that flows into the harness's `metadata_json` column for end-to-end provenance. Phase 1b of the harness adds the optional `metadata_json`/`provenance` parameters to these APIs (see DAEMON_ARCHITECTURE.md §Write Delegation).

#### 1.7 — CLI integration

Add `serve` subcommand to `syntropic-cli`:

```
axiom-harness serve [--socket <path>] [--config <path>]
axiom-harness token issue --identity <identity> --capabilities <caps>
axiom-harness token list
axiom-harness token revoke <token_id>
```

The `serve` command starts the daemon, which:
1. Opens the `CoreStore` (same DB the pool loop uses — WAL mode supports concurrent readers)
2. Starts the state reactor
3. Binds the Unix socket
4. Enters the accept loop

The daemon runs alongside the pool loop — same process or separate, both work because SQLite WAL mode supports multiple readers. Recommendation: same process (add `serve` as a mode alongside `run`), because it eliminates DB path resolution and simplifies deployment.

### Validation

- `cargo test -p syntropic-daemon` — unit tests for protocol parsing, auth, delta computation, subscription management
- `cargo test -p syntropic-daemon --test integration` — spin up daemon, connect a client, verify initialize handshake, subscribe to fleet, trigger a dispatch, verify push notification arrives
- Manual: `axiom-harness serve` + `nc -U ~/.codex/harness.sock` + paste JSON-RPC messages

---

## Phase 2: Desktop Harness Bridge

### Objective

Connect Atlas to the harness daemon. The bridge is the TypeScript client that speaks JSON-RPC 2.0 over the Unix socket and exposes harness state as observables conforming to the `IHarnessService` interface from Phase 0b.

### Prerequisites

Phase 0b (interfaces exist). Phase 1 (daemon running) is needed for full functionality but the bridge can be developed against mock data first.

### Deliverables

```
src/vs/sessions/services/harness/
├── common/
│   ├── harnessService.ts             IHarnessService interface (from Phase 0b)
│   ├── harnessTypes.ts               Re-export of wire types
│   └── harnessProtocol.ts            JSON-RPC envelope types for TypeScript
├── electron-browser/
│   ├── harnessService.ts             Desktop implementation (daemon client + read-only polling fallback)
│   ├── harnessDaemonClient.ts        Unix socket JSON-RPC client
│   ├── harnessMapper.ts              Wire → presentation type mapping
│   └── harnessSqlitePoller.ts        Read-only SQLite polling (fallback — no writes)
└── browser/
    └── harnessService.ts             Stub: returns disconnected state
```

### Implementation Steps

#### 2.1 — JSON-RPC client over Unix socket

```typescript
// electron-browser/harnessDaemonClient.ts

import * as net from 'net';

export class HarnessDaemonClient extends Disposable {
    private socket: net.Socket | undefined;
    private nextId = 1;
    private pending = new Map<number, { resolve: Function; reject: Function }>();

    async connect(socketPath: string, token: string): Promise<IInitializeResult> {
        this.socket = net.createConnection(socketPath);
        // Newline-delimited JSON framing
        // Send initialize request
        // Wait for initialize response
        // Start notification listener
    }

    async request<T>(method: string, params?: unknown): Promise<T> {
        const id = this.nextId++;
        // Send JSON-RPC request, return promise resolved by response handler
    }

    onNotification(handler: (method: string, params: unknown) => void): IDisposable {
        // Register notification handler
    }
}
```

The client handles:
- Connection establishment with automatic reconnection (exponential backoff, max 30s)
- The `initialize` handshake (send client info + token, receive capabilities + limits)
- Request/response correlation by JSON-RPC `id`
- Notification routing to subscription handlers
- Graceful disconnect on window close

#### 2.2 — Wire-to-presentation mapper

```typescript
// electron-browser/harnessMapper.ts

export function mapWireAgent(wire: IWireAgentState): IAgentState {
    return {
        dispatchId: wire.dispatch_id,
        taskId: wire.task_id,
        roleId: wire.role_id,
        role: deriveAgentRole(wire.role_id),
        status: mapAgentStatus(wire.state),
        worktreePath: wire.worktree_path,
        pid: wire.pid,
        costSpent: wire.cost_spent ?? 0,
        lastHeartbeat: Date.parse(wire.last_heartbeat),
        lastActivity: wire.last_activity,
        timeInState: Date.now() - Date.parse(wire.state_changed_at),
        attentionLevel: computeAgentAttention(/* mapped fields */, IDLE_THRESHOLD_MS),
        startedAt: Date.parse(wire.started_at),
    };
}

// Similar mappers for objectives, tasks, swarms, reviews, etc.
```

#### 2.3 — Desktop HarnessService implementation

**Critical design rule: polling mode is read-only.** When the daemon is absent, Atlas can browse cached/polled state but cannot issue writes. This ensures a single authenticated control plane — all writes flow through the daemon's token auth, capability model, and audit trail. There is no second privileged write path via CLI subprocess.

**Wave A was intentionally narrow.** The initial bridge only consumed `initialize`, `shutdown`, `daemon.ping`, `fleet.snapshot`, `fleet.subscribe`, and `fleet.unsubscribe`, while keeping `writesEnabled: false` even in daemon mode.

**Current merged Wave D bridge truthfully consumes the richer read surface plus the shipped daemon write subset.** Atlas now reads:

- `initialize` with `fabric_identity`
- `daemon.ping`
- `fleet.snapshot`, `fleet.subscribe`, `fleet.unsubscribe`
- `health.get`, `health.subscribe`, `health.unsubscribe`
- `objective.list`, `objective.get`, `objective.subscribe`, `objective.unsubscribe`
- `review.list`, `review.get`, `review.subscribe`, `review.unsubscribe`
- `merge.list`, `merge.get`, `merge.subscribe`, `merge.unsubscribe`
- `task.get`, `task.list`, `task.tree`

Atlas validates `initialize.fabric_identity.repo_root` against the opened workspace and fails closed on mismatch. `task.list` is treated as root-task anchors only, `task.tree` is the rooted lineage primitive, and Phase 3 now derives `IHarnessService.swarms` from that rooted state. Polling fallback remains intentionally narrow and read-only: it still only surfaces fleet and derived health from SQLite, because mirroring every daemon family locally would create a second privileged control plane.

The daemon branch already exposes additional read methods beyond the merged Wave D bridge. Atlas now consumes the inspector-scoped subset truthfully in Phase 8: `artifact.list`, `artifact.get`, `memory.get`, `memory.list`, `result.get`, `review.provenance.list`, `agent.activity.get`, `transcript.get`, `worktree.get`, and `worktree.list`. Atlas still leaves `task.subscribe`, `task.unsubscribe`, the deep inspector subscribe/unsubscribe families, and `cost.get` unconsumed until a later bridge wave adopts them truthfully.

Atlas now delegates only the shipped daemon write subset:

- `control.pause`
- `control.cancel`
- `dispatch.submit`
- `objective.submit`
- `review.gate_verdict`
- `review.authorize_promotion`
- `review.enqueue_merge`

Unshipped methods such as `control.resume`, `control.steer`, `pauseAll`, and `resumeAll` remain explicit fail-closed errors. `writesEnabled` is now a coarse "some daemon writes are available" bit, while `supportedWriteMethods` reports the exact subset the connected daemon both exposes and grants.

```typescript
// electron-browser/harnessService.ts

export class DesktopHarnessService extends Disposable implements IHarnessService {
    private daemonClient: HarnessDaemonClient | undefined;
    private sqlitePoller: HarnessSqlitePoller | undefined;

    // All observables
    private readonly _fleet = observableValue<IFleetState>(this, emptyFleetState);
    readonly fleet: IObservable<IFleetState> = this._fleet;
    // ... similarly for objectives, swarms, tasks, health, cost, reviewGates, mergeQueue

    async connect(workspaceRoot: URI): Promise<void> {
        try {
            this.daemonClient = this._register(new HarnessDaemonClient());
            const initResult = await this.daemonClient.connect(this.resolveDaemonSocketPath(workspaceRoot), this.getToken());
            this._connectionState.set({
                state: HarnessConnectionState.Connected,
                mode: 'daemon',
                writesEnabled: supportedWriteMethods.length > 0,
                supportedWriteMethods,
                ...
            });

            // Current merged bridge consumes the daemon surface that actually exists.
            await this.daemonClient.request('daemon.ping', {});
            this.daemonClient.onNotification((method, params) => {
                this.handleNotification(method, params);
            });
            await this.daemonClient.request('fleet.snapshot', {});
            await this.daemonClient.request('health.get', {});
            await this.daemonClient.request('objective.list', {});
            await this.daemonClient.request('review.list', {});
            await this.daemonClient.request('merge.list', {});
            const roots = await this.daemonClient.request('task.list', {});
            for (const root of roots.roots) {
                await this.daemonClient.request('task.tree', { root_task_id: root.task.task_id });
            }
            await this.daemonClient.request('fleet.subscribe', {});
            await this.daemonClient.request('health.subscribe', {});
            await this.daemonClient.request('objective.subscribe', {});
            await this.daemonClient.request('review.subscribe', {});
            await this.daemonClient.request('merge.subscribe', {});
        } catch (error) {
            if (!isDaemonUnavailable(error)) {
                throw error;
            }
            // Fallback to read-only SQLite polling — NO writes
            const dbPath = this.resolveRouterDbPath(workspaceRoot);
            this.sqlitePoller = this._register(new HarnessSqlitePoller(dbPath));
            this._connectionState.set({
                state: HarnessConnectionState.Connected,
                mode: 'polling',
                writesEnabled: false,  // polling mode: read-only
                supportedWriteMethods: [],
                ...
            });
            this.sqlitePoller.start();
        }
    }

    private handleNotification(method: string, params: unknown): void {
        switch (method) {
            case 'fleet.delta':
                this._fleet.set(mapWireFleet(params as IWireFleetDelta), undefined);
                break;
            case 'health.update':
            case 'objective.update':
            case 'review.update':
            case 'merge.update':
                // Map the daemon payload into the corresponding Atlas presentation observable.
                break;
            // Unsupported topic families still remain empty/default until the daemon exposes them.
        }
    }

    private failClosedWrite(capabilityLabel: string): never {
        if (this._connectionState.get().mode === 'daemon') {
            throw new Error(`Current harness daemon does not yet expose ${capabilityLabel}.`);
        }
        throw new Error('Harness daemon required; Atlas is in read-only mode.');
    }

    async pauseAgent(dispatchId: string): Promise<void> {
        await this.daemonClient.request('control.pause', { dispatch_id: dispatchId });
    }

    async recordGateVerdict(dispatchId: string, decision: ReviewDecision, reviewedByRole: string): Promise<void> {
        await this.daemonClient.request('review.gate_verdict', { dispatch_id: dispatchId, decision, reviewed_by_role: reviewedByRole });
    }

    async authorizePromotion(dispatchId: string, authorizedByRole: string): Promise<void> {
        await this.daemonClient.request('review.authorize_promotion', { dispatch_id: dispatchId, authorized_by_role: authorizedByRole });
    }

    async enqueueForMerge(dispatchId: string): Promise<void> {
        await this.daemonClient.request('review.enqueue_merge', { dispatch_id: dispatchId });
    }

    // Unsupported or unshipped write methods still fail closed.
}
```

The UI layer should use `connectionState.writesEnabled` as a coarse "some actions are available" signal and `connectionState.supportedWriteMethods` for per-action gating:

```typescript
// In any view that has write actions:
const connection = this.harnessService.connectionState;
const canPause = connection.map(c => c.supportedWriteMethods.includes('control.pause'));
const canMerge = connection.map(c => c.supportedWriteMethods.includes('review.enqueue_merge'));
// Disable only the actions that are not listed in supportedWriteMethods.
// If writesEnabled is false entirely, show the read-only daemon/polling hint.
```

#### 2.4 — Browser stub

```typescript
// browser/harnessService.ts

export class BrowserHarnessService extends Disposable implements IHarnessService {
    readonly connectionState = observableValue<IHarnessConnectionInfo>(this, {
        state: HarnessConnectionState.Disconnected,
        mode: 'none',
        daemonVersion: undefined,
        schemaVersion: undefined,
        grantedCapabilities: [],
        errorMessage: 'Harness connection requires desktop app',
    });

    // All observables return empty state
    // All methods throw or return empty results
}
```

#### 2.5 — Service registration

Register in the sessions entry points:

```typescript
// sessions.desktop.main.ts — add import
import 'vs/sessions/services/harness/electron-browser/harnessService.js';

// In the harnessService.ts file itself:
registerSingleton(IHarnessService, DesktopHarnessService, InstantiationType.Delayed);
```

```typescript
// sessions.web.main.ts — add import
import 'vs/sessions/services/harness/browser/harnessService.js';

// In the browser stub file:
registerSingleton(IHarnessService, BrowserHarnessService, InstantiationType.Delayed);
```

### Validation

- TypeScript compilation clean
- Layering check passes (new files in `vs/sessions/services/`, imports only from `vs/base/`, `vs/platform/`, `vs/sessions/common/model/`)
- Unit test: mock daemon socket, verify initialize handshake, verify notification → observable update flow
- Integration test: start `axiom-harness serve`, open Atlas window, verify connection state shows "Connected (daemon)" with truthful `writesEnabled` / `supportedWriteMethods` based on the daemon's granted capability subset
- Integration test: verify `initialize.fabric_identity` is captured and validated against the opened workspace, and cross-project mismatch fails closed without degrading to polling
- Integration test: verify fleet, health, objective, review, merge, and rooted task state populate from the daemon methods above
- Integration test: verify `task.list` is treated as a root-task anchor list only and Atlas expands rooted lineage through `task.tree`
- **Read-only fallback test**: stop daemon, open Atlas window, verify connection state shows "Connected (polling)" with `writesEnabled: false`. Verify fleet/health observables populate from SQLite. Verify all write methods throw with deterministic read-only errors. Verify write action buttons are disabled in the UI.
- Disconnected test: no harness at all, verify graceful "Harness not connected" state
- **No CLI write path test**: verify that no code path in `DesktopHarnessService` shells out to `axiom-harness` CLI for write operations. The CLI is not a second control plane.

---

## Phase 3: Swarm Derivation & Fleet State

### Objective

Build the pure derivation layer that transforms the bridge’s rooted task trees plus current objective/fleet/review/merge/health state into swarm-first aggregates. This is where the conceptual shift from session-first to swarm-first becomes real in code.

### Prerequisites

Phase 0b (model types), Phase 2 (IHarnessService providing raw observables).

### Deliverables

```
src/vs/sessions/services/harness/electron-browser/
├── harnessSwarmDerivation.ts        Pure functions: derive swarms from rooted harness state
└── harnessService.ts                Publishes derived swarms through IHarnessService

src/vs/sessions/services/harness/test/node/
├── harnessSwarmDerivation.test.ts
└── harnessService.test.ts
```

The separate `IFleetManagementService` runtime implementation remains a later selection/navigation phase. Phase 3’s shipped scope is model/service derivation only.

### Implementation Steps

#### 3.1 — Swarm derivation algorithm

A swarm is not a table in the harness DB. It is a computed aggregate rooted at one **root task** — a `task_hierarchy` entry where `parent_task_id IS NULL`. Objectives are metadata attached when present. This is root-task-first, not objective-only, because the harness exposes root-task lineage directly through `task_hierarchy` and ad-hoc dispatches may not have objectives.

```typescript
// electron-browser/harnessSwarmDerivation.ts

/**
 * Derive swarms from rooted harness state.
 *
 * Algorithm (root-task-first):
 * 1. Treat each task.tree root as one swarm anchor
 * 2. Collect every descendant taskId from that rooted lineage
 * 3. Attach objective metadata only when rootTaskId has one unique non-conflicting objective
 * 4. Attach agents/reviews/merge entries whose taskId is inside that rooted lineage
 * 5. Compute deterministic phase and attention summaries from task/review/merge/health state
 * 6. Omit unsupported memory/activity/artifact semantics rather than inventing them
 */
export function deriveSwarms(
    taskTrees: readonly IHarnessTaskTree[],
    tasks: readonly ITaskState[],
    objectives: readonly IObjectiveState[],
    fleet: IFleetState,
    reviewGates: readonly IReviewGateState[],
    mergeEntries: readonly IMergeEntry[],
    health: IHealthState,
): ISwarmState[] {
    // one swarm per task tree root
    // objective metadata attaches by rootTaskId only
    // membership comes only from rooted lineage
    // review/merge/failed/blocked summaries stay explicit
    // swarmId is always rootTaskId

    // Return sorted by attention level (highest first)
}
```

The key difference from the previous objective-only model: a swarm always has a `rootTaskId` but may have `objectiveId: undefined`. This correctly handles:
- Objective-driven swarms: `ObjectiveIntakeService.create_objective()` → root planner dispatch → `task_hierarchy` entry
- Ad-hoc dispatches: `CoreStore.enqueue_dispatch()` → worker dispatch without an objective
- Sub-planner trees: `planner_hierarchy` entries with their own root tasks (handled by walking `task_hierarchy.parent_task_id`)

The swarm phase is derived from the aggregate state of its children:

| Child States | Swarm Phase |
|---|---|
| All tasks queued, planner not started | Planning |
| Planner running or some tasks executing | Executing |
| All tasks completed, reviews pending | Reviewing |
| All reviews approved, merge entries pending | Merging |
| All merged | Completed |
| Any task failed, no recovery in progress | Failed |

#### 3.2 — HarnessService swarm publication

```typescript
// electron-browser/harnessService.ts

private publishSwarmState(): void {
    const taskTrees = this.rootedTaskIds
        .map(rootTaskId => this.taskTrees.get(rootTaskId))
        .filter((value): value is ITaskTreeResult => value !== undefined)
        .map(taskTree => toBridgeTaskTree(taskTree));

    this.swarms.set(deriveSwarms(
        taskTrees,
        this.tasks.get(),
        this.objectives.get(),
        this.fleet.get(),
        this.reviewGates.get(),
        this.mergeQueue.get(),
        this.health.get(),
    ), undefined, undefined);
}
```

#### 3.3 — Derived swarm observable

`HarnessService` computes derived swarms reactively from rooted task lineage:

```typescript
// publishReadState() / publish*State() call publishSwarmState()
// so swarms stay in sync with task trees, objectives, fleet, review, merge, and health
```

#### 3.4 — Context key integration

Register Atlas-specific context keys that drive view visibility throughout all subsequent phases:

```typescript
// In sessions/common/contextkeys.ts — add:
export const AtlasSelectedEntityKindContext = new RawContextKey<string>('atlas.selectedEntityKind', '');
export const AtlasSelectedEntityIdContext = new RawContextKey<string>('atlas.selectedEntityId', '');
export const AtlasHarnessConnectedContext = new RawContextKey<boolean>('atlas.harnessConnected', false);
export const AtlasHasActiveSwarms = new RawContextKey<boolean>('atlas.hasActiveSwarms', false);
export const AtlasReviewsPending = new RawContextKey<number>('atlas.reviewsPending', 0);
export const AtlasFleetBlockedCount = new RawContextKey<number>('atlas.fleetBlockedCount', 0);
```

#### 3.5 — Service registration

```typescript
// sessions/services/fleet/browser/fleetManagementService.ts (bottom)
registerSingleton(IFleetManagementService, FleetManagementService, InstantiationType.Delayed);

// sessions.common.main.ts — add import
import 'vs/sessions/services/fleet/browser/fleetManagementService.js';
```

### Validation

- Swarm derivation unit tests: given known task/agent/review configurations, verify correct swarm grouping, phase computation, and attention levels
- Integration test: connect to harness with active dispatches, verify swarms are derived and observables update when agents complete work
- Context key test: select an agent, verify `atlas.selectedEntityKind` is `'agent'`

---

## Phase 4: Left Rail Navigation

### Objective

Replace the single "Sessions" sidebar view with swarm-first navigation. The shipped Wave 1 implementation keeps the sidebar as one Atlas view pane with first-class sections for `Tasks`, `Agents`, `Reviews`, and `Fleet`, then routes the current selection into a read-only center shell in the ChatBar.

### Prerequisites

Phase 3 (fleet state and derived swarms).

### Deliverables

```
src/vs/sessions/contrib/
├── atlasNavigation/browser/
│   ├── atlasNavigationModel.ts        Pure section and center-shell view models
│   ├── atlasNavigationViewPane.ts     Unified sidebar left rail with Tasks/Agents/Reviews/Fleet sections
│   ├── atlasCenterShellViewPane.ts    Read-only center shell routed from current selection
│   └── atlasCenterShell.contribution.ts
src/vs/sessions/services/fleet/browser/
└── fleetManagementService.ts          Sessions-scoped navigation + selection runtime
```

### Implementation Steps

#### 4.1 — Unified Atlas navigation pane

Reuse the existing sessions sidebar container instead of registering multiple new sidebar containers. Replace the old sessions-history view with a single `AtlasNavigationViewPane` that renders explicit section buttons for `Tasks`, `Agents`, `Reviews`, and `Fleet`.

```typescript
// sessions/contrib/sessions/browser/sessions.contribution.ts

const agentSessionsViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: SessionsContainerId,
	title: localize2('atlasNavigation.view.label', "Atlas"),
	icon: atlasNavigationIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [SessionsContainerId, { mergeViewWithContainerWhenSingleView: true }]),
	windowVisibility: WindowVisibility.Sessions
}, ViewContainerLocation.Sidebar, { isDefault: true });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: AtlasNavigationViewId,
	name: localize2('atlasNavigation.view.label', "Atlas"),
	ctorDescriptor: new SyncDescriptor(AtlasNavigationViewPane),
	canToggleVisibility: false,
	canMoveView: false,
	windowVisibility: WindowVisibility.Sessions,
}], agentSessionsViewContainer);
```

#### 4.2 — Section view models and selection runtime

`IFleetManagementService` becomes the sessions-scoped selection owner. It holds the current `INavigationSelection`, tracks the selected top-level section, connects `IHarnessService` to the primary workspace root, and reveals the ChatBar center shell when the user chooses a swarm, agent, or review target.

```typescript
// sessions/services/fleet/browser/fleetManagementService.ts

export class FleetManagementService extends Disposable implements IFleetManagementService {
	readonly selection = observableValue<INavigationSelection>(this, {
		section: NavigationSection.Tasks,
		entity: undefined,
	});

	selectSection(section: NavigationSection): void { ... }
	selectSwarm(swarmId: string): void { ... }
	selectAgent(dispatchId: string): void { ... }
	selectReview(dispatchId: string): void { ... }
	openFleetGrid(): Promise<void> { ... }
}
```

The pure `atlasNavigationModel.ts` helpers derive the left-rail lists and the read-only center-shell summaries from current bridge state. In this shipped phase:

| Section | Source of truth | Primary list semantics | Secondary detail |
|---|---|---|---|
| Tasks | `HarnessService.swarms` + `tasks` | One entry per rooted swarm | Objective metadata is decoration only |
| Agents | `HarnessService.fleet` | One entry per visible dispatch | Linked back to owning swarm/task when possible |
| Reviews | `HarnessService.reviewGates` + `mergeQueue` | Authoritative gate + merge entries only | No advisory queue conflation |
| Fleet | `connectionState` + `fleet` + `health` | Read-only summary cards and top attention items | No write controls |

#### 4.3 — Center shell routing

The center surface is currently a read-only shell view in the ChatBar. It reacts to the current `INavigationSelection` and renders truthful summary/detail lists even when the downstream dedicated boards are not built yet.

```typescript
// sessions/contrib/atlasNavigation/browser/atlasCenterShell.contribution.ts

registerViews([{
	id: ATLAS_CENTER_SHELL_VIEW_ID,
	name: localize2('atlasCenterShell', "Atlas"),
	ctorDescriptor: new SyncDescriptor(AtlasCenterShellViewPane),
	windowVisibility: WindowVisibility.Sessions,
}], atlasCenterShellContainer);
```

#### 4.4 — Sidebar part update

No standard workbench changes are required. The sessions shell continues to use the existing sessions sidebar and ChatBar parts; Phase 4 only swaps the sidebar pane implementation and registers the sessions-only center shell.

#### 4.5 — Import registration

```typescript
// sessions.common.main.ts
import 'vs/sessions/services/fleet/browser/fleetManagementService.js';

// sessions.desktop.main.ts and sessions.web.main.ts
import 'vs/sessions/contrib/atlasNavigation/browser/atlasCenterShell.contribution.js';
```

### Validation

- The sessions sidebar now renders a single Atlas left rail with `Tasks`, `Agents`, `Reviews`, and `Fleet`
- Lists populate from current harness state via `IHarnessService` and Phase 3 derived swarms
- Clicking a left-rail item updates `IFleetManagementService.selection`
- The ChatBar center shell updates to the selected section/entity without fabricating later-phase detail panes
- All new surfaces remain sessions-only via `WindowVisibility.Sessions`

---

## Phase 5: Fleet Command

### Objective

Turn the `Fleet` section in the Atlas sessions shell into a real read-only operator command surface. The shipped Phase 5 wave lives inside the existing Atlas center shell, is backed only by current harness observables, and lets operators pivot into swarm, agent, and review context without introducing write controls.

### Prerequisites

Phase 3 (fleet state observables), Phase 4 (view container infrastructure).

### Deliverables

```
src/vs/sessions/contrib/atlasNavigation/browser/
├── atlasNavigationModel.ts         Fleet Command view-model builder
├── atlasCenterShellViewPane.ts     Dedicated Fleet renderer inside the sessions center shell
└── media/atlasCenterShellViewPane.css

src/vs/sessions/contrib/atlasNavigation/test/node/
└── atlasNavigationModel.test.ts    Fleet grouping / header / pivot regressions
```

### Implementation Steps

#### 5.1 — Header / status strip

Expose the current operator posture from shipped bridge state:

- harness connection mode/state
- pool health mode
- queue depth
- running / blocked / failed agent counts
- critical / needs-action swarm counts
- live review / merge pressure count

#### 5.2 — Grouped live dispatch slices

Build a dedicated Fleet Command model from current `IHarnessService` state and group live agent rows into deterministic slices:

- `Needs review / merge attention`
- `Running`
- `Blocked`
- `Failed`
- `Idle / recent`

Each row stays read-only and shows only current truthful state:

- role label
- dispatch id
- task id
- linked swarm id when known
- current status
- heartbeat recency
- time in state
- last activity
- direct review / merge pressure when the same dispatch is carrying it

#### 5.3 — Read-only pivots

Each Fleet row must pivot through the existing sessions selection model only:

- `Agent`
- owning `Swarm` or `Task`
- `Gate` when the same dispatch has an outstanding review gate
- `Merge` when the same dispatch is in the merge lane

No write buttons, pause/cancel/review/merge actions, or fake deep inspector panes land in this wave.

### Validation

- Fleet renders as a dedicated read-only operator surface inside the sessions center shell
- Header counts reflect live connection, health, queue, agent, and swarm attention state
- Running / blocked / failed / idle / review-pressure groups stay deterministic
- Pivot buttons route through existing sessions selection state
- No write controls or standard workbench leakage are introduced

---

## Phase 6: Review Surfaces

### Objective

Turn the existing `Reviews` section in the sessions window into the first real actionable review workspace, backed by the authoritative review-gate and merge-lane state plus the shipped daemon review write subset.

### Prerequisites

Phase 4 (swarm-first navigation shell), Phase 5 (Fleet Command), Phase 2 Wave D (review/merge write delegation).

### Deliverables

```
src/vs/sessions/contrib/atlasNavigation/browser/
├── atlasNavigationModel.ts           Actionable review workspace view-model + per-target action state
├── atlasCenterShellViewPane.ts       Reviews center-shell renderer + local progress/error feedback
├── atlasReviewWorkspaceActions.ts    Sessions-only review action controller (fixed canonical roles)
└── media/
    └── atlasCenterShellViewPane.css  Review workspace layout and action styling
```

### Implementation Steps

#### 6.1 — Actionable review workspace model

Reuse the existing `Reviews` left-rail section and the existing Atlas center shell. The actionable workspace remains inside `sessions/contrib/atlasNavigation/`; no separate `reviewService.ts` or standalone review editor contribution ships in this wave.

The workspace must derive its content from current Atlas bridge state only:

- authoritative review gates (`reviewState`, `promotionState`, `integrationState`)
- authoritative merge-lane entries
- rooted swarm/task linkage
- current fleet agent linkage for the selected dispatch
- daemon connection state and `supportedWriteMethods`

#### 6.2 — Distinct gate vs merge targets

Review rows remain keyed by `dispatchId + reviewTargetKind`:

- `gate:<dispatchId>`
- `merge:<dispatchId>`

The same dispatch may surface both a gate row and a merge row simultaneously. Selection must preserve that target identity end-to-end so the left rail and center shell do not collapse both rows onto the same target.

#### 6.3 — Shipped action bar

The center shell becomes the first real actionable review workspace:

1. **Target summary**: dispatch, task, swarm, gate state, promotion state, merge state, role/branch
2. **Links**: read-only pivots to owning swarm, task, and live agent when available
3. **Action bar**: only the shipped daemon subset, and only when the selected connection advertises the exact method
4. **Queue list**: all authoritative gate/merge entries, with the selected target highlighted

Shipped actions in this wave:

- **Record Go** → `IHarnessService.recordGateVerdict(dispatchId, ReviewDecision.Go, 'axiom-judge')`
- **Record No-Go** → `IHarnessService.recordGateVerdict(dispatchId, ReviewDecision.NoGo, 'axiom-judge')`
- **Authorize Promotion** → `IHarnessService.authorizePromotion(dispatchId, 'axiom-planner')`
- **Enqueue for Merge** → `IHarnessService.enqueueForMerge(dispatchId)`

Do not ship a broader role picker in this wave. The UI uses the truthful fixed canonical roles that the current daemon write surface accepts.

#### 6.4 — Capability gating and local feedback

All action gating must use `connectionState.supportedWriteMethods`, not just `writesEnabled`.

- Polling mode remains read-only.
- Browser stub remains read-only.
- A connected daemon that omits a specific review method must keep that action disabled with a deterministic reason.
- Failed actions surface the daemon error locally inside the review workspace.
- Unsupported actions must stay disabled and fail closed; no fallback write path exists.

This wave intentionally stops at the actionable review workspace. The broader pre-review, inflight review, post-review editor stack remains later work.

### Validation

- Gate and merge rows remain distinct even when they share the same `dispatchId`
- The center shell reflects the selected target kind correctly
- `Record Go`, `Record No-Go`, `Authorize Promotion`, and `Enqueue for Merge` are enabled only when their exact daemon methods appear in `supportedWriteMethods`
- Polling and browser modes stay visibly read-only
- Action failures surface deterministic local error state inside the review workspace
- No deep inspector/editor surfaces or unrelated write affordances ship in this wave

---

## Phase 7: Center Stage Modes

### Objective

Phase 7 now lands in slices. The currently shipped `7A` wave turns the existing sessions center shell into first-class read-only work surfaces for `Tasks` and `Agents`, backed by the current harness bridge and Phase 3 swarms. Broader editor-style boards and transcript-heavy agent execution panes remain later slices.

### Prerequisites

Phase 4 (left rail navigation for mode entry points), Phase 5 (Fleet Command), Phase 6 (actionable review workspace).

### Deliverables

```
src/vs/sessions/contrib/atlasNavigation/browser/
├── atlasNavigationModel.ts          Dedicated Tasks / Agents workspace models
├── atlasCenterShellViewPane.ts      Center-shell routing + rendering for Tasks / Agents / Reviews / Fleet
└── media/atlasCenterShellViewPane.css

src/vs/sessions/contrib/atlasNavigation/test/node/
└── atlasNavigationModel.test.ts     Focused Tasks / Agents workspace regressions
```

### Implementation Steps

#### 7A.1 — Tasks workspace

The shipped `Tasks` mode is swarm-rooted and read-only:

- section-level selection renders a rooted-swarm overview instead of a generic placeholder
- selected swarm/task/objective renders:
  - swarm summary and metadata
  - rooted task lineage
  - related live agents
  - authoritative review / merge pressure linked to that rooted lineage
- objective metadata decorates the workspace but does not replace root-task identity

#### 7A.2 — Agents workspace

The shipped `Agents` mode is execution-focused and read-only:

- section-level selection renders grouped live execution slices (`Running`, `Blocked`, `Failed`, `Idle / recent`)
- selected agent renders:
  - dispatch/task/swarm/status/heartbeat summary
  - current known worktree / activity / cost only when Atlas already has that bridge state
  - dispatch-scoped review / merge pressure
  - pivots back to swarm, task, reviews, and fleet

#### 7A.3 — Preserve dedicated Review and Fleet workspaces

Phase 7A does not collapse the already-shipped center-stage work:

- `Reviews` stays the actionable authoritative review / merge workspace
- `Fleet` stays the read-only operator command surface

#### 7A.4 — Later Phase 7 slices

The broader long-term center-stage roadmap remains later work:

- Objective board / DAG view
- Swarm board
- Transcript-heavy agent execution view
- Other editor-backed center-stage modes that depend on deeper inspector / transcript substrate

### Validation

- Selecting `Tasks` opens a substantive swarm-rooted work surface, not a generic summary placeholder
- Selecting a swarm/task/objective shows rooted task lineage, related agents, and review / merge pressure truthfully
- Selecting `Agents` opens a substantive execution surface, not a generic summary placeholder
- Selecting an agent shows dispatch/task/swarm linkage plus current known heartbeat / worktree / pressure state
- `Reviews` and `Fleet` continue to route to their already-shipped dedicated workspaces without regression

---

## Phase 8: Deep Inspector

### Objective

Ship a sessions-scoped, read-only, selection-aware deep inspector inside the existing Atlas center shell. The inspector updates from the current selected swarm, task, agent, or review target and exposes only the daemon reads Atlas now truthfully consumes.

### Prerequisites

Phase 3 (selection model), Phase 4 (left rail), Phase 6 (distinct review target identity), and the Phase 8 bridge adoption of the shipped inspector read families.

### Deliverables

```
src/vs/sessions/contrib/atlasNavigation/browser/
├── atlasCenterShellViewPane.ts        Existing center shell extended with right-side inspector region
├── atlasInspectorModel.ts             Selection-aware async inspector model builder
└── media/atlasCenterShellViewPane.css Inspector layout and card styles

src/vs/sessions/services/harness/
├── common/harnessProtocol.ts          Adopted inspector read methods
├── common/harnessTypes.ts             Inspector read payload types
└── electron-browser/harnessService.ts On-demand daemon reads for inspector sections
```

### Implementation Steps

#### 8.1 — Selection-aware inspector model

The merged Phase 8 implementation keeps the inspector inside the current sessions center shell rather than introducing a separate auxiliary-bar contribution. `atlasInspectorModel.ts` resolves the selected entity and loads only the truthful read scope for that selection:

- `Swarm`
  - overview
  - rooted worktree list via `worktree.list`
  - rooted memory via `memory.list(root_task_id)`
  - sparse result / artifact / activity / transcript / provenance sections
- `Task`
  - overview
  - task-scoped memory via `memory.list(task_id)`
  - dispatch-scoped result / worktree / artifact / activity / transcript only when the selected task has a current dispatch
- `Agent`
  - overview
  - dispatch-scoped worktree via `worktree.get`
  - dispatch-scoped result via `result.get`
  - dispatch-scoped artifacts via `artifact.list` + `artifact.get`
  - dispatch-scoped activity via `agent.activity.get`
  - dispatch-scoped transcript via `transcript.get`
- `Review`
  - the same dispatch-scoped worktree / result / artifacts / activity / transcript reads
  - review-target-scoped provenance via `review.provenance.list`, filtered by `ReviewTargetKind`

#### 8.2 — Inspector sections shipped

The merged inspector exposes these read-only sections:

- `Overview`
- `Worktree`
- `Result`
- `Artifacts`
- `Memory`
- `Activity`
- `Transcript`
- `Provenance`

Hard edges:

- no fake swarm-global activity or transcript replay
- no fake rooted aggregate result list
- no binary artifact transport UI
- provenance remains distinct for gate vs. merge targets on the same dispatch
- sparse state is preferred over invented detail whenever the current selection lacks truthful scope

### Validation

- Selecting a swarm, task, agent, or review target shows a right-side inspector region inside the sessions center shell
- Gate and merge targets with the same `dispatchId` still render distinct provenance
- Swarm and task selections do not invent dispatch-scoped result / artifact / transcript truth when no current dispatch exists
- Agent and review selections show truthful dispatch-scoped worktree / result / artifact / activity / transcript state when the daemon exposes it
- Polling and browser stub modes remain read-only and sparse for the deep inspector surfaces

---

## Phase 9: Titlebar Redesign

### Objective

Replace the generic sessions header/chrome with an Atlas-specific sessions-shell header that surfaces:

- current project / workspace identity
- current harness fabric identity when available
- current section / selection breadcrumbs
- live connection / health / queue / attention status
- read-only quick pivots among `Tasks`, `Agents`, `Reviews`, and `Fleet`

This wave is sessions-only and read-only. It does not override the standard workbench titlebar, and it does not add write controls.

### Prerequisites

Phase 3 (fleet state), Phase 5 (fleet command service for aggregates), Phase 8 (inspector shell already present in the same center-shell wrapper).

### Deliverables

```
src/vs/sessions/contrib/atlasNavigation/browser/
├── atlasCenterShellViewPane.ts       Header rendering inside the sessions shell wrapper
├── atlasHeaderModel.ts               Pure header view-model builder
└── media/atlasCenterShellViewPane.css
```

### Implementation Steps

#### 9.1 — Identity block

Render a left-aligned Atlas identity block in the sessions shell header:

- product label (`Atlas`)
- current workspace / project name
- current `fabric_identity.fabric_id` when available from the daemon
- truthful sparse state when disconnected or polling without daemon identity

#### 9.2 — Context breadcrumbs

Render a center-aligned context block that reflects the current selection model:

- current section (`Tasks`, `Agents`, `Reviews`, `Fleet`)
- selected entity breadcrumbs when present
- distinct review target kind (`Gate` vs `Merge`) preserved in the breadcrumb path

#### 9.3 — Live status chips

Render right-aligned read-only status chips sourced from the current sessions state:

- connection mode/state
- pool health mode
- queue depth
- active / blocked / failed agent counts
- critical / needs-action swarm counts

#### 9.4 — Quick pivots

Add read-only top-level pivot buttons wired through the existing `IFleetManagementService.selectSection(...)` flow:

- `Tasks`
- `Agents`
- `Reviews`
- `Fleet`

Each pivot shows the current section count and selection state, but no write actions.

### Layout

Render the header inside the existing sessions center-shell wrapper:

```
[Atlas / project / fabric] │ [section / selection breadcrumb] │ [status chips]
[Tasks] [Agents] [Reviews] [Fleet]
```

### Validation

- Project/fabric identity is truthful when the daemon is attached and sparse when it is not
- Current section and selected entity context update deterministically
- Review gate and merge targets for the same `dispatchId` stay distinct in the header context
- Status chips reflect live connection / health / queue / swarm counts
- Quick pivots route through the existing sessions navigation state

---

## Phase 10: Multi-Monitor Readiness

### Objective

Ship sessions-local layout profiles that let operators reshape the existing Atlas shell for different working modes without touching the standard workbench or attempting OS-level monitor automation.

### Prerequisites

Phase 7 (all center stage modes), Phase 8 (inspector), Phase 9 (titlebar).

### Deliverables

```
src/vs/sessions/common/model/
└── layout.ts                         AtlasLayoutProfile enum

src/vs/sessions/services/fleet/
├── common/
│   └── fleetManagementService.ts     layoutProfile observable + selector contract
└── browser/
    └── fleetManagementService.ts     workspace-local profile persistence

src/vs/sessions/contrib/atlasNavigation/browser/
├── atlasLayoutProfileModel.ts        profile descriptors + frame-class layout mapping
├── atlasHeaderModel.ts               profile selector state in the Atlas header
├── atlasCenterShellViewPane.ts       profile-aware header rendering + layout composition
└── media/
    └── atlasCenterShellViewPane.css  sessions-local profile layout styles
```

### Implementation Steps

#### 10A.1 — Sessions-local layout profiles

```typescript
export const enum AtlasLayoutProfile {
    Operator = 'operator',
    Execution = 'execution',
    Review = 'review',
    Fleet = 'fleet',
}
```

Ship these four explicit profiles:

- `Operator`
- `Execution`
- `Review`
- `Fleet`

Each profile reshapes only the existing sessions surfaces:

- Atlas header
- left rail
- center-stage workspace
- deep inspector

#### 10A.2 — Sessions-local persistence

Persist the selected profile locally for the current workspace:

- storage key: `atlas.layoutProfile`
- scope: `StorageScope.WORKSPACE`
- target: `StorageTarget.MACHINE`

Profile switching must preserve the current `INavigationSelection`, including distinct `ReviewTargetKind` identity for gate vs merge targets.

#### 10A.3 — Header selector and layout composition

Add a sessions-local profile selector to the Atlas header and drive CSS/layout composition from it:

```
[Atlas / project / fabric] │ [section / selection breadcrumb] │ [status chips]
[Tasks] [Agents] [Reviews] [Fleet]                     [Operator] [Execution] [Review] [Fleet]
```

Shipped profile intent:

- `Operator`: balanced default with center-stage and inspector both visible
- `Execution`: emphasize center-stage and inspector for following one swarm/agent deeply
- `Review`: bias the shell toward review workspaces plus supporting inspector context
- `Fleet`: bias the shell toward fleet scanning and operational overview

### Validation

- The sessions shell supports `Operator`, `Execution`, `Review`, and `Fleet`
- Profile switching is deterministic and read-only
- Selected profile persists locally per workspace
- Current selection survives profile changes
- Review target kind stays distinct across profile changes
- Existing `Tasks`, `Agents`, `Reviews`, `Fleet`, and inspector surfaces do not regress

### Not Shipped In 10A

- OS-level monitor assignment
- automatic window movement
- standard workbench layout/profile integration
- any new write controls
- any multi-window orchestration

### Future Multi-Window Phase

Actual multi-window orchestration remains later work. When Atlas reaches that phase, it can reuse the same `AtlasLayoutProfile` model rather than inventing a second layout taxonomy.

---

## Parallel Work Streams

Phase 0a is the gate — the wire contract must be ratified before anything else starts. Then 0b and 1 run in parallel. After Phase 3, the view phases (4, 5, 6, 8, 9) can be partially parallelized:

| Stream | Phases | Focus |
|--------|--------|-------|
| **Contract** | 0a | Wire contract ratification (gate for all other work) |
| **Data** | 0b + 1 → 2 → 3 | Types, daemon, bridge, fleet state |
| **Navigation** | 4 → 9 | Left rail, titlebar |
| **Awareness** | 5 → 7 (fleet grid + boards) | Fleet command, center stage |
| **Review** | 6 → 7 (review editors) | Review surfaces (three-tier model), center stage |
| **Context** | 8 | Right inspector |
| **Multi-window** | 10 | Last — needs everything else |

Minimum critical path: **0a → 0b → 2 → 3 → 4 → 5 → 7 → 10** (8 sequential phases).

With parallelism: **0a → [0b + 1] → 2 → 3 → [4 + 5 + 6 + 8 + 9] → 7 → 10** (7 sequential stages).

---

## Compatibility Notes

### Session Layer Survival

The existing `ISessionsManagementService`, `ChatViewPane`, and session list (`AgenticSessionsViewPane`) survive through the entire refactor. They are not deleted — they continue to work for:

- Rendering agent transcripts (the chat widget is reused by the Agent Execution View in Phase 7)
- Session list as a secondary navigation option (operators who prefer the old model)
- Session-scoped file changes (the `ChangesViewPane` is extended, not replaced)

The conceptual shift is that these are no longer the primary nouns. They become implementation details behind the swarm-first surfaces.

### ISessionsManagementService → IFleetManagementService

`IFleetManagementService` does not replace `ISessionsManagementService` at the code level. Both exist:

- `ISessionsManagementService` continues to manage the chat/session lifecycle (opening sessions, managing worktrees, committing files)
- `IFleetManagementService` manages the factory-level selection and navigation

Over time, the session management logic may be absorbed into per-agent or per-swarm management, but this is not required for any phase in this plan.

### Existing Contributions

All 18 existing contrib modules remain. New modules are added alongside them:

```
sessions/contrib/
├── accountMenu/              (keep)
├── agentFeedback/            (keep — reused by in-flight review)
├── agentsView/               (NEW — Phase 4)
├── aiCustomizationTreeView/  (keep)
├── applyCommitsToParentRepo/ (keep)
├── changes/                  (keep — extended for agent-scoped diffs)
├── chat/                     (keep — chat actions, prompts)
├── codeReview/               (keep — reused by review surfaces)
├── configuration/            (keep)
├── files/                    (keep)
├── fileTreeView/             (keep)
├── fleetCommand/             (NEW — Phase 5)
├── git/                      (keep)
├── github/                   (keep)
├── inspector/                (NEW — Phase 8)
├── logs/                     (keep)
├── review/                   (NEW — Phase 6)
├── reviewsView/              (NEW — Phase 4)
├── sessions/                 (keep — session management internals)
├── swarmsView/               (NEW — Phase 4)
├── tasksView/                (NEW — Phase 4)
├── terminal/                 (keep)
├── welcome/                  (keep)
└── workspace/                (keep)
```

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Wire contract drift between TS and Rust | Cascading type mismatches | Phase 0a ratifies a single contract document; both sides implement from it, not from each other |
| Daemon not ready when Atlas bridge is built | Phase 2 blocked on real data | Build bridge against mock daemon (record/replay from TUI FleetSnapshot) |
| Swarm derivation too slow for large task graphs | UI lag on reactive updates | Memoize derivation, debounce at 100ms, compute in web worker if needed |
| DAG rendering performance | Janky objective boards | Start with SVG for small graphs (<20 nodes), switch to canvas if needed |
| IHarnessService interface churn | Cascading changes across consumers | Phase 0a + 0b get thorough review before any consumer is built |
| Partial daemon write surface UX | Operator confusion about which actions are really live | Gate each action on `supportedWriteMethods`, keep unsupported methods explicit, and keep polling/browser modes clearly read-only |
| Review model confusion (advisory vs authoritative) | Operator makes decisions on heuristic data | Advisory scores explicitly labeled as "heuristic" in UI; gate state clearly distinguished as "authoritative verdict" |
| Multi-window state sync | Stale data in secondary windows | Each window has its own IHarnessService connected to the same daemon — daemon handles state, not Atlas |
| Fork cleanup conflicts with new code | Merge conflicts | Coordinate with cleanup agent — new code goes in `sessions/`, cleanup targets `workbench/` and `extensions/` — orthogonal directories |
