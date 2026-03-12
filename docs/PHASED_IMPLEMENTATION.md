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
	readonly phase: SwarmPhase;
	readonly taskIds: readonly string[];
	readonly agentDispatchIds: readonly string[];
	readonly worktreePaths: readonly string[];
	readonly reviewDispatchIds: readonly string[];
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
	readonly writesEnabled: boolean;   // Wave A / Wave B: false in all modes until daemon write families exist
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
	readonly selectedEntity: IObservable<ISelectedEntity | undefined>;
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

**Current merged Wave C bridge truthfully consumes the richer read-only daemon surface.** Atlas now reads:

- `initialize` with `fabric_identity`
- `daemon.ping`
- `fleet.snapshot`, `fleet.subscribe`, `fleet.unsubscribe`
- `health.get`, `health.subscribe`, `health.unsubscribe`
- `objective.list`, `objective.get`, `objective.subscribe`, `objective.unsubscribe`
- `review.list`, `review.get`, `review.subscribe`, `review.unsubscribe`
- `merge.list`, `merge.get`, `merge.subscribe`, `merge.unsubscribe`
- `task.get`, `task.list`, `task.tree`

Atlas validates `initialize.fabric_identity.repo_root` against the opened workspace and fails closed on mismatch. `task.list` is treated as root-task anchors only, and `task.tree` is the rooted lineage primitive that Phase 3 will later derive swarms from. Polling fallback remains intentionally narrow and read-only: it still only surfaces fleet and derived health from SQLite, because mirroring every daemon family locally would create a second privileged control plane.

The daemon branch currently exposes a few additional read methods (`cost.get`, `agent.activity.get`, and `transcript.get`) that Atlas still leaves intentionally unimplemented in Wave C. Those remain explicit empty/default surfaces until the next bridge wave adopts them truthfully.

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
                writesEnabled: false, // Wave A through Wave C: daemon is still read-only from Atlas
                ...
            });

            // Current merged bridge consumes the read-only daemon surface that actually exists.
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

    // Write methods still fail closed because the daemon does not yet expose them.
    async pauseAgent(dispatchId: string): Promise<void> {
        this.failClosedWrite('control methods');
    }

    async recordGateVerdict(dispatchId: string, decision: ReviewDecision, reviewedByRole: string): Promise<void> {
        this.failClosedWrite('review methods');
    }

    async authorizePromotion(dispatchId: string, authorizedByRole: string): Promise<void> {
        this.failClosedWrite('promotion methods');
    }

    async enqueueForMerge(dispatchId: string): Promise<void> {
        this.failClosedWrite('merge methods');
    }

    // ... all other write methods also fail closed in Wave A
}
```

The UI layer uses `connectionState.writesEnabled` to disable action buttons whenever writes are unavailable:

```typescript
// In any view that has write actions:
const canWrite = this.harnessService.connectionState.map(c => c.writesEnabled);
// Disable "Approve", "Pause", "Cancel" buttons when canWrite is false
// Show "Writes unavailable in current Wave A bridge" hint in the UI
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
- Integration test: start `axiom-harness serve`, open Atlas window, verify connection state shows "Connected (daemon)" with `writesEnabled: false`
- Integration test: verify `initialize.fabric_identity` is captured and validated against the opened workspace, and cross-project mismatch fails closed without degrading to polling
- Integration test: verify fleet, health, objective, review, merge, and rooted task state populate from the daemon methods above
- Integration test: verify `task.list` is treated as a root-task anchor list only and Atlas expands rooted lineage through `task.tree`
- **Read-only fallback test**: stop daemon, open Atlas window, verify connection state shows "Connected (polling)" with `writesEnabled: false`. Verify fleet/health observables populate from SQLite. Verify all write methods throw with deterministic read-only errors. Verify write action buttons are disabled in the UI.
- Disconnected test: no harness at all, verify graceful "Harness not connected" state
- **No CLI write path test**: verify that no code path in `DesktopHarnessService` shells out to `axiom-harness` CLI for write operations. The CLI is not a second control plane.

---

## Phase 3: Swarm Derivation & Fleet State

### Objective

Build the service layer that transforms raw harness state (flat lists of tasks, agents, worktrees, reviews) into swarm-first aggregates. This is where the conceptual shift from session-first to swarm-first becomes real in code.

### Prerequisites

Phase 0b (model types), Phase 2 (IHarnessService providing raw observables).

### Deliverables

```
src/vs/sessions/services/fleet/
├── common/
│   ├── fleetManagementService.ts    IFleetManagementService interface (from Phase 0b)
│   └── swarmDerivation.ts           Pure functions: derive swarms from flat harness state
├── browser/
│   └── fleetManagementService.ts    Implementation
└── test/
    └── browser/
        ├── fleetManagementService.test.ts
        └── swarmDerivation.test.ts
```

### Implementation Steps

#### 3.1 — Swarm derivation algorithm

A swarm is not a table in the harness DB. It is a computed aggregate rooted at one **root task** — a `task_hierarchy` entry where `parent_task_id IS NULL`. Objectives are metadata attached when present. This is root-task-first, not objective-only, because the harness exposes root-task lineage directly through `task_hierarchy` and ad-hoc dispatches may not have objectives.

```typescript
// common/swarmDerivation.ts

/**
 * Derive swarms from flat harness state.
 *
 * Algorithm (root-task-first):
 * 1. Find all root tasks: tasks where parentTaskId is undefined
 *    (task_hierarchy entries where parent_task_id IS NULL)
 * 2. For each root task, walk the task_hierarchy to collect all descendant task IDs
 * 3. Attach objective metadata: look up objectives where root_task_id matches
 *    (objective may be undefined for ad-hoc dispatches)
 * 4. For each task in the tree, find assigned agents (dispatch_queue entries)
 * 5. For each agent, find worktree paths (worker_registry)
 * 6. For each task, find review gate state (review_candidates)
 * 7. For each task, find merge entries (merge_queue)
 * 8. Count memory records scoped to this task tree
 * 9. Sum costs across all agents (daemon-derived field)
 * 10. Compute swarm phase from aggregate task/gate/merge state
 * 11. Compute attention level from worst-case child
 */
export function deriveSwarms(
    tasks: readonly ITaskState[],
    agents: readonly IAgentState[],
    reviewGates: readonly IReviewGateState[],
    mergeEntries: readonly IMergeEntry[],
    objectives: readonly IObjectiveState[],  // used for metadata attachment, not as root
): ISwarmState[] {
    // 1. Find root tasks (parentTaskId === undefined)
    const rootTasks = tasks.filter(t => t.parentTaskId === undefined);

    // 2. For each root task, build descendant tree
    // 3. Attach objective metadata via objectives.find(o => o.rootTaskId === rootTask.taskId)
    // 4-11. Aggregate agents, reviews, costs, compute phase and attention

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

#### 3.2 — FleetManagementService implementation

```typescript
// browser/fleetManagementService.ts

export class FleetManagementService extends Disposable implements IFleetManagementService {
    private readonly _selectedEntity = observableValue<ISelectedEntity | undefined>(this, undefined);
    readonly selectedEntity: IObservable<ISelectedEntity | undefined> = this._selectedEntity;

    private readonly _selectedEntityKind = observableValue<EntityKind | undefined>(this, undefined);
    readonly selectedEntityKind: IObservable<EntityKind | undefined> = this._selectedEntityKind;

    constructor(
        @IHarnessService private readonly harnessService: IHarnessService,
        @IContextKeyService private readonly contextKeyService: IContextKeyService,
        @IEditorService private readonly editorService: IEditorService,
    ) {
        super();

        // Bind selection to context keys for view visibility
        this._register(autorun(reader => {
            const entity = this._selectedEntity.read(reader);
            this.contextKeyService.createKey('atlas.selectedEntityKind', entity?.kind);
            this.contextKeyService.createKey('atlas.selectedEntityId', entity?.id);
        }));
    }

    selectAgent(dispatchId: string): void {
        this._selectedEntity.set({ kind: EntityKind.Agent, id: dispatchId }, undefined);
    }

    selectTask(taskId: string): void {
        this._selectedEntity.set({ kind: EntityKind.Task, id: taskId }, undefined);
    }

    // ... other select methods

    async openSwarmBoard(swarmId: string): Promise<void> {
        this.selectSwarm(swarmId);
        // Phase 7: open SwarmBoardEditorInput in the editor service
    }

    async openAgentView(dispatchId: string): Promise<void> {
        this.selectAgent(dispatchId);
        // Phase 7: open AgentViewEditorInput in the editor service
    }
}
```

#### 3.3 — Derived swarm observable

The fleet management service computes derived swarms reactively from root-task lineage:

```typescript
// Inside FleetManagementService constructor
this._register(autorun(reader => {
    const tasks = this.harnessService.tasks.read(reader);
    const fleet = this.harnessService.fleet.read(reader);
    const reviewGates = this.harnessService.reviewGates.read(reader);
    const mergeEntries = this.harnessService.mergeQueue.read(reader);
    const objectives = this.harnessService.objectives.read(reader);

    // Root-task-first: tasks drive swarm discovery, objectives attach as metadata
    const swarms = deriveSwarms(tasks, fleet.agents, reviewGates, mergeEntries, objectives);
    this._swarms.set(swarms, undefined);
}));
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

Replace the single "Sessions" sidebar view with swarm-first navigation. The sidebar becomes the operator's primary navigation tool with views for Swarms, Tasks, Agents, and Reviews.

### Prerequisites

Phase 3 (fleet state and derived swarms).

### Deliverables

```
src/vs/sessions/contrib/
├── swarmsView/browser/
│   ├── swarmsView.contribution.ts     View container + view registration
│   ├── swarmsViewPane.ts              ViewPane with tree
│   └── swarmsTreeDataProvider.ts      Tree data: swarms grouped by objective/phase/attention
├── tasksView/browser/
│   ├── tasksView.contribution.ts
│   ├── tasksViewPane.ts
│   └── tasksTreeDataProvider.ts       Tree data: tasks grouped by status/swarm
├── agentsView/browser/
│   ├── agentsView.contribution.ts
│   ├── agentsViewPane.ts
│   └── agentsTreeDataProvider.ts      Tree data: agents grouped by role/status
├── reviewsView/browser/
│   ├── reviewsView.contribution.ts
│   ├── reviewsViewPane.ts
│   └── reviewsTreeDataProvider.ts     Tree data: reviews grouped by phase
```

### Implementation Steps

#### 4.1 — View container registration

Each view follows the existing sessions contribution pattern. Register view containers in the sidebar with `WindowVisibility.Sessions`:

```typescript
// swarmsView/browser/swarmsView.contribution.ts

const SWARMS_VIEW_CONTAINER_ID = 'atlas.workbench.view.swarmsContainer';

Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersModel)
    .registerViewContainer({
        id: SWARMS_VIEW_CONTAINER_ID,
        title: nls.localize2('swarmsView', "Swarms"),
        ctorDescriptor: new SyncDescriptor(ViewPaneContainer),
        icon: swarmsViewIcon,
        order: 1,
        windowVisibility: WindowVisibility.Sessions,
    }, ViewContainerLocation.Sidebar, { isDefault: true });

Registry.as<IViewsRegistry>(ViewExtensions.ViewsModel)
    .registerViews([{
        id: 'atlas.swarmsView',
        name: nls.localize2('swarms', "Swarms"),
        ctorDescriptor: new SyncDescriptor(SwarmsViewPane),
        containerID: SWARMS_VIEW_CONTAINER_ID,
        canToggleVisibility: false,
    }], SWARMS_VIEW_CONTAINER_ID);
```

Similarly for Tasks (order: 2), Agents (order: 3), Reviews (order: 4).

#### 4.2 — Tree data providers

Each view uses `WorkbenchCompressibleObjectTree` — the same pattern used by `AgenticSessionsViewPane` for the session list.

```typescript
// swarmsTreeDataProvider.ts

export class SwarmsTreeDataProvider extends Disposable {
    constructor(
        @IFleetManagementService private readonly fleetService: IFleetManagementService,
        @IHarnessService private readonly harnessService: IHarnessService,
    ) {
        super();
    }

    getElements(): ISwarmTreeElement[] {
        const swarms = this.fleetService.swarms;
        // Group by: objective (default), phase, or attention level
        // Each swarm node shows: name, phase badge, agent count, cost, attention indicator
        // Child nodes: tasks (summary view)
    }
}
```

Tree element types:

| View | Root Elements | Child Elements | Inline Stats |
|---|---|---|---|
| Swarms | Objective groups → Swarm entries | Task summary nodes | Phase badge, agent count, cost |
| Tasks | Status groups (Executing/Queued/Reviewing/Done) | Individual tasks | Priority, assigned agent, cost |
| Agents | Role groups (Planner/Worker/Judge) or status groups | Individual agents | Status dot, task, cost, time |
| Reviews | Phase groups (Pre/In-flight/Post) | Individual reviews | Verdict badge, age |

#### 4.3 — Badge system

View containers display badge counts on the sidebar tab even when not active:

```typescript
// In each contribution file, register badge provider
this._register(this.harnessService.reviews.map(reviews => {
    const pending = reviews.filter(r => r.verdict === ReviewVerdict.Pending).length;
    viewContainer.badge = pending > 0 ? { count: pending, tooltip: `${pending} reviews pending` } : undefined;
}));
```

Key badges:
- **Reviews**: count of pending reviews (most important — drives operator throughput)
- **Agents**: count of blocked/failed agents (needs attention)
- **Tasks**: count of executing tasks (activity indicator)
- **Swarms**: count of active swarms

#### 4.4 — Sidebar part update

Modify `sessions/browser/parts/sidebarPart.ts` to register the new view containers. The existing `AgenticSessionsViewPane` remains available but is no longer the default — Swarms becomes the default sidebar view.

#### 4.5 — Import registration

```typescript
// sessions.common.main.ts — add imports
import 'vs/sessions/contrib/swarmsView/browser/swarmsView.contribution.js';
import 'vs/sessions/contrib/tasksView/browser/tasksView.contribution.js';
import 'vs/sessions/contrib/agentsView/browser/agentsView.contribution.js';
import 'vs/sessions/contrib/reviewsView/browser/reviewsView.contribution.js';
```

### Validation

- View containers appear in sidebar with correct icons and ordering
- Trees populate from harness data via IFleetManagementService
- Clicking a tree item updates `IFleetManagementService.selectedEntity`
- Badge counts update reactively as harness state changes
- Views only appear in sessions window (not standard workbench) via `WindowVisibility.Sessions`

---

## Phase 5: Fleet Command

### Objective

Build the primary awareness surface — a live dashboard showing all agents with status, cost, time, and attention flags. Renders in both sidebar (compact list in Agents view) and center stage (full Fleet Grid).

### Prerequisites

Phase 3 (fleet state observables), Phase 4 (view container infrastructure).

### Deliverables

```
src/vs/sessions/browser/widget/agentCard/
├── agentCard.ts              Reusable agent card widget
├── agentCard.css             Card styling with status colors
└── agentCardRenderer.ts      ITreeRenderer for tree views

src/vs/sessions/browser/widget/fleetGrid/
├── fleetGrid.ts              Grid widget: auto-layout agent cards
├── fleetGrid.css             Grid styling
└── fleetGridEditorInput.ts   EditorInput for center stage mode

src/vs/sessions/contrib/fleetCommand/browser/
├── fleetCommand.contribution.ts
└── fleetCommandService.ts    IFleetCommandService: attention sorting, idle detection
```

### Implementation Steps

#### 5.1 — Agent card widget

A self-contained widget that renders one agent's state. Used by both the sidebar tree renderer and the fleet grid.

```typescript
// browser/widget/agentCard/agentCard.ts

export class AgentCard extends Disposable {
    private readonly domNode: HTMLElement;

    constructor(
        container: HTMLElement,
        private readonly agent: IObservable<IAgentState>,
    ) {
        super();
        this.domNode = dom.append(container, dom.$('.agent-card'));
        this._register(autorun(reader => {
            const state = this.agent.read(reader);
            this.render(state);
        }));
    }

    private render(state: IAgentState): void {
        // Status dot (colored circle: green/gray/orange/red/blue)
        // Agent name (dispatch_id short form)
        // Role badge (planner/worker/judge)
        // Current task (task_id + summary truncated)
        // Cost ($X.XX)
        // Time in state (Xm Xs)
        // Last activity (truncated line)
        // Attention indicator (if NeedsAction or Critical)
    }
}
```

Status color mapping (consistent across all surfaces):

| Status | Color | CSS Variable |
|---|---|---|
| Running | Green | `--atlas-status-active` |
| Idle | Gray | `--atlas-status-idle` |
| Blocked | Orange | `--atlas-status-blocked` |
| Failed | Red | `--atlas-status-critical` |
| Reviewing | Blue | `--atlas-status-reviewing` |
| Completed | Dimmed | `--atlas-status-completed` |

#### 5.2 — Fleet grid widget

The center-stage fleet grid renders agent cards in a responsive grid layout.

```typescript
// browser/widget/fleetGrid/fleetGrid.ts

export class FleetGrid extends Disposable {
    constructor(
        container: HTMLElement,
        @IHarnessService private readonly harnessService: IHarnessService,
        @IFleetManagementService private readonly fleetService: IFleetManagementService,
    ) {
        super();
        this._register(autorun(reader => {
            const fleet = this.harnessService.fleet.read(reader);
            this.layout(fleet.agents);
        }));
    }

    private layout(agents: readonly IAgentState[]): void {
        // Sort by attention level (Critical first, then NeedsAction, etc.)
        // Render as CSS grid with auto-fill columns
        // Each cell is an AgentCard
        // Click card → fleetService.selectAgent(id) + open agent view
        // Right-click → context menu (pause, cancel, steer, open terminal)
    }
}
```

#### 5.3 — Fleet command service

Implements attention-based sorting, idle detection, and cost burn rate computation.

```typescript
// contrib/fleetCommand/browser/fleetCommandService.ts

export class FleetCommandService extends Disposable {
    constructor(
        @IHarnessService private readonly harnessService: IHarnessService,
    ) {
        super();
    }

    /**
     * Agents sorted by attention priority.
     * Critical and NeedsAction always surface to top.
     */
    readonly sortedAgents: IObservable<readonly IAgentState[]>;

    /**
     * Agents idle beyond the configurable threshold (default 5 minutes).
     */
    readonly idleAgents: IObservable<readonly IAgentState[]>;

    /**
     * Agents in blocked state or stuck in loops (no progress for N minutes).
     */
    readonly blockedAgents: IObservable<readonly IAgentState[]>;

    /**
     * Aggregate cost burn rate ($/minute over last 5 minutes).
     */
    readonly costBurnRate: IObservable<number>;
}
```

#### 5.4 — Fleet Grid as EditorInput

Register the fleet grid as an editor that opens in the center stage:

```typescript
// browser/widget/fleetGrid/fleetGridEditorInput.ts

export class FleetGridEditorInput extends EditorInput {
    static readonly ID = 'atlas.fleetGridEditorInput';
    readonly typeId = FleetGridEditorInput.ID;

    getName(): string { return nls.localize('fleetGrid', "Fleet Grid"); }
    getIcon(): ThemeIcon { return fleetGridIcon; }
}
```

### Validation

- Agent cards render with correct status colors, update in real-time
- Fleet grid auto-sizes to window dimensions
- Clicking a card selects the agent and opens the agent view
- Idle agents show warning indicator after threshold
- Blocked agents surface to top of sorted list
- Cost burn rate updates as agents execute

---

## Phase 6: Review Surfaces

### Objective

Build the three review surfaces (pre-execution, in-flight, post-execution) that are the highest-leverage operator interaction in the factory.

### Prerequisites

Phase 3 (review state observables), Phase 5 (agent card for in-flight view).

### Deliverables

```
src/vs/sessions/contrib/review/
├── common/
│   └── reviewService.ts              IAtlasReviewService (coordinates all review phases)
├── browser/
│   ├── review.contribution.ts
│   ├── preReview/
│   │   ├── preReviewEditor.ts        EditorPane: task spec, plan preview, risk, approve/reject
│   │   └── preReviewEditorInput.ts
│   ├── inflightReview/
│   │   ├── inflightReviewEditor.ts   EditorPane: live transcript + live diff split
│   │   └── inflightReviewEditorInput.ts
│   └── postReview/
│       ├── postReviewEditor.ts       EditorPane: criteria, verdict, diff, evidence, batch actions
│       ├── postReviewEditorInput.ts
│       └── batchReviewController.ts  Auto-advance through review queue
```

### Implementation Steps

#### 6.1 — IAtlasReviewService

The review service coordinates the three tiers and maps them to the three UI surfaces:

| UI Surface | Primary Data Tier | Secondary Data |
|---|---|---|
| Pre-Execution Review | Task spec + plan (from `ITaskState` + task hierarchy) | Advisory queue score (Tier 1) for risk/priority hint |
| In-Flight Review | Live agent activity stream | Gate state (Tier 2) for current review_state |
| Post-Execution Review | Gate state (Tier 2) — the authoritative verdict | Merge state (Tier 3) for post-approval merge progress |

```typescript
// common/reviewService.ts

export const IAtlasReviewService = createDecorator<IAtlasReviewService>('atlasReviewService');

export interface IAtlasReviewService {
    readonly _serviceBrand: undefined;

    // Sorted review queue (Tier 1 advisory ordering applied to Tier 2 gate entries)
    readonly pendingGates: IObservable<readonly IReviewGateState[]>;
    readonly reviewCount: IObservable<{ pre: number; inflight: number; post: number }>;

    // Open review surfaces
    openPreReview(taskId: string): Promise<void>;
    openInflightReview(dispatchId: string): Promise<void>;
    openPostReview(dispatchId: string): Promise<void>;

    // Gate actions (Tier 2 — delegated to IHarnessService, requires daemon)
    recordVerdict(dispatchId: string, decision: ReviewDecision): Promise<void>;
    authorizePromotion(dispatchId: string): Promise<void>;

    // Merge action (Tier 3 — delegated to IHarnessService, requires daemon)
    enqueueForMerge(dispatchId: string): Promise<void>;

    // Batch review
    advanceToNext(): Promise<boolean>;  // returns false if queue empty
    readonly batchProgress: IObservable<{ current: number; total: number }>;
}
```

#### 6.2 — Pre-execution review

Shows the task specification and plan before any agent starts working. Operator can approve, modify, or reject.

Content layout:
1. **Header**: Task ID, priority, cost cap
2. **Task spec**: Summary, acceptance criteria (checkbox list)
3. **Plan preview**: Subtask DAG (if planner has decomposed)
4. **Tool scope**: What the agent is allowed to do
5. **Model**: Which LLM, estimated cost
6. **Risk assessment**: Files touched, conflict potential
7. **Actions**: Approve Plan / Modify / Reject / Skip

Data source: `IHarnessService.getTask()` + task hierarchy + dispatch metadata.

#### 6.3 — In-flight review

Split view showing the live agent execution. Operator can steer, pause, or cancel.

**Left pane**: Live transcript — streams from `IHarnessService.subscribeAgentActivity(dispatchId)`. Shows thinking, tool calls, file edits in a scrolling log. Auto-scrolls to bottom.

**Right pane**: Live diff — shows file changes made so far. Updates as the agent makes edits. Uses the existing diff editor infrastructure from `ChangesViewPane`.

**Bottom bar**: Cost ($X.XX / $cap), time elapsed, progress estimate, action buttons (Steer, Pause, Cancel, Escalate).

Data source: `IHarnessService.subscribeAgentActivity()` for transcript, worktree diff for file changes.

#### 6.4 — Post-execution review

The primary review surface for completed work. Shows the authoritative gate state (Tier 2) and enables the operator to advance through the gate state machine.

Content layout:
1. **Header**: Dispatch ID, task summary, cost
2. **Gate state**: Current `reviewState` / `promotionState` / `integrationState` badges (Tier 2 — authoritative)
3. **Advisory hint**: Score, confidence, risk count from advisory queue (Tier 1 — informational only, explicitly labeled as heuristic)
4. **Acceptance criteria**: Checkmark list from `ResultPacket.acceptance_results` (met/not-met with evidence)
5. **Judge verdict**: `judge_decision` (Go/NoGo) with `reviewedByRole` and `reviewedAt` — from gate state, not advisory
6. **Diff**: File list with inline diff viewer (reuse `ChangesViewPane` diff infrastructure)
7. **Test evidence**: Test results, coverage delta
8. **Actions** (three-step gate flow):
   - If `reviewState == AwaitingReview`: **Record Verdict** (Go / NoGo) → calls `IHarnessService.recordGateVerdict()`
   - If `reviewState == ReviewGo` and `promotionState == NotRequested`: **Authorize Promotion** → calls `IHarnessService.authorizePromotion()`
   - If `promotionState == PromotionAuthorized`: **Enqueue for Merge** → calls `IHarnessService.enqueueForMerge()` (validates all gate conditions server-side)
   - **Next ▸** (batch advance)

The diff rendering reuses the existing `ChangesViewPane` contribution — it already renders file diffs with inline stats. Extend it to accept a task/dispatch scope parameter instead of always showing the active session's changes.

All write actions are disabled when `connectionState.writesEnabled` is false. In Wave A this is true in daemon mode, polling mode, and the browser stub, so the UI should explain that the current bridge is read-only rather than blaming polling alone.

#### 6.5 — Batch review controller

After a gate action, automatically advance to the next review item:

```typescript
// browser/postReview/batchReviewController.ts

export class BatchReviewController extends Disposable {
    private queue: IReviewGateState[] = [];
    private currentIndex = 0;

    readonly progress: IObservable<{ current: number; total: number }>;

    async advanceToNext(): Promise<boolean> {
        this.currentIndex++;
        if (this.currentIndex >= this.queue.length) {
            return false;
        }
        await this.reviewService.openPostReview(this.queue[this.currentIndex].dispatchId);
        return true;
    }
}
```

Counter in the review editor header: "3 of 7 reviews remaining."

### Validation

- Pre-review shows task spec, plan, risk assessment; action buttons disabled when writes are unavailable
- In-flight review streams live transcript and updates diff in real-time
- Post-review shows **gate state** (Tier 2) as the authoritative verdict, advisory score (Tier 1) as a labeled hint — never conflated
- Gate actions follow the three-step flow: verdict → promotion → merge
- All write actions disabled with a Wave A read-only hint when writes are unavailable
- Batch review auto-advances; counter updates correctly
- Review badges in left rail update when gate states change

---

## Phase 7: Center Stage Modes

### Objective

Extend the center area beyond chat to support all Atlas modes — boards, grids, agent views — using the VS Code editor infrastructure.

### Prerequisites

Phase 4 (left rail navigation for mode entry points), Phase 5 (fleet grid), Phase 6 (review editors).

### Deliverables

```
src/vs/sessions/browser/editors/
├── atlasEditorRegistry.ts           Register all Atlas EditorInputs
├── objectiveBoard/
│   ├── objectiveBoardEditor.ts      DAG visualization of objective decomposition
│   ├── objectiveBoardEditorInput.ts
│   └── dagRenderer.ts              Canvas-based DAG node/edge rendering
├── swarmBoard/
│   ├── swarmBoardEditor.ts          Live swarm execution board
│   ├── swarmBoardEditorInput.ts
│   └── swarmLanes.ts               Lane layout: agents, memory, worktrees, reviews
├── agentView/
│   ├── agentViewEditor.ts           Agent transcript + tool calls + diff + cost
│   └── agentViewEditorInput.ts
```

### Implementation Steps

#### 7.1 — Editor registration pattern

Each center stage mode is an `EditorInput` subclass that opens via `IEditorService`:

```typescript
// browser/editors/atlasEditorRegistry.ts

// Register editor pane descriptors
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane)
    .registerEditorPane(
        EditorPaneDescriptor.create(ObjectiveBoardEditor, ObjectiveBoardEditorInput.ID, 'Objective Board'),
        [new SyncDescriptor(ObjectiveBoardEditorInput)]
    );
// ... similarly for SwarmBoardEditor, AgentViewEditor, FleetGridEditor, review editors
```

#### 7.2 — Objective board

DAG visualization of an objective's task decomposition tree. Each node is a task with status, agent, and cost. Edges show dependencies.

The DAG renderer needs to:
1. Accept a tree of `ITaskState` nodes with dependency edges
2. Compute a layered layout (topological sort → layer assignment → crossing minimization)
3. Render on an HTML canvas or SVG
4. Support click-to-select (updates `IFleetManagementService.selectedEntity`)
5. Support zoom (objective-level → task-level → agent-level)
6. Update node states in real-time as agents complete work

Implementation approach: Use `<canvas>` with a lightweight layout algorithm. No external library dependency — keep it self-contained. The layout algorithm can be a simple Sugiyama-style layered graph drawing (the task DAGs are typically small, <50 nodes).

#### 7.3 — Swarm board

The default execution view for one swarm. Shows:
- **Agent lane**: Cards for all agents in this swarm (reuse AgentCard)
- **Task lane**: Pipeline view (queued → executing → reviewing → done)
- **Memory lane**: Recent governed memory records (decisions, invariants, findings)
- **Worktree lane**: Active branches and their status
- **Review lane**: Pending and completed reviews for this swarm

Layout: horizontal lanes stacked vertically, each scrollable independently.

#### 7.4 — Agent execution view

Extends the existing chat transcript rendering for any agent (not just the "active session"). Shows:
- Live or historical transcript
- Tool calls with expandable details
- File diffs inline
- Cost and time metrics
- Steer/pause/cancel controls

This reuses the existing `ChatViewPane` rendering infrastructure — the chat widget already knows how to render agent transcripts. The key extension is making it work for any dispatch ID, not just the active session.

### Validation

- Double-clicking a swarm in the left rail opens the swarm board in center stage
- Double-clicking an agent opens the agent execution view
- DAG visualization renders correctly for objectives with 1-50 tasks
- Node states update in real-time
- Mode switching is smooth (no flash, no layout jank)

---

## Phase 8: Right Inspector

### Objective

Context-sensitive detail panel in the auxiliary bar. Shows different content based on `ISelectedEntity`.

### Prerequisites

Phase 3 (selection model with context keys).

### Deliverables

```
src/vs/sessions/contrib/inspector/browser/
├── inspector.contribution.ts          Register all inspector view containers
├── agentInspector/
│   └── agentInspectorViewPane.ts      Agent detail: role, cost, reasoning, files, policy
├── taskInspector/
│   └── taskInspectorViewPane.ts       Task detail: spec, criteria, deps, agent, progress
├── reviewInspector/
│   └── reviewInspectorViewPane.ts     Review detail: verdict history, approval chain
├── worktreeInspector/
│   └── worktreeInspectorViewPane.ts   Worktree detail: branch, commits, diff summary
```

### Implementation Steps

#### 8.1 — View container registration with `when` clauses

```typescript
// inspector.contribution.ts

// Agent inspector — shows when an agent is selected
Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersModel)
    .registerViewContainer({
        id: 'atlas.inspector.agent',
        title: nls.localize2('agentInspector', "Agent Inspector"),
        ctorDescriptor: new SyncDescriptor(ViewPaneContainer),
        icon: agentInspectorIcon,
        when: ContextKeyExpr.equals('atlas.selectedEntityKind', 'agent'),
        windowVisibility: WindowVisibility.Sessions,
    }, ViewContainerLocation.AuxiliaryBar);

// Task inspector — shows when a task is selected
Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersModel)
    .registerViewContainer({
        id: 'atlas.inspector.task',
        title: nls.localize2('taskInspector', "Task Inspector"),
        ctorDescriptor: new SyncDescriptor(ViewPaneContainer),
        icon: taskInspectorIcon,
        when: ContextKeyExpr.equals('atlas.selectedEntityKind', 'task'),
        windowVisibility: WindowVisibility.Sessions,
    }, ViewContainerLocation.AuxiliaryBar);

// Similarly for review, worktree, objective inspectors
```

The auxiliary bar already has card-style appearance in the sessions layer (`AuxiliaryBarPart`). Each inspector panel fills the auxiliary bar when its `when` clause is active.

#### 8.2 — Inspector panes

Each inspector reads from `IHarnessService` using the selected entity ID:

```typescript
// agentInspector/agentInspectorViewPane.ts

export class AgentInspectorViewPane extends ViewPane {
    constructor(...) {
        super(...);
    }

    protected override renderBody(container: HTMLElement): void {
        this._register(autorun(reader => {
            const entity = this.fleetService.selectedEntity.read(reader);
            if (entity?.kind !== EntityKind.Agent) { return; }
            const agent = this.harnessService.fleet.read(reader)
                .agents.find(a => a.dispatchId === entity.id);
            if (agent) {
                this.renderAgentDetail(container, agent);
            }
        }));
    }

    private renderAgentDetail(container: HTMLElement, agent: IAgentState): void {
        // Role and status
        // Current task (linked — click to select task)
        // Cost breakdown
        // Time in state
        // Last N activity lines
        // Worktree path and branch
        // Memory records authored by this agent
        // Actions: Steer, Pause, Cancel, Open Terminal
    }
}
```

### Validation

- Selecting an agent in the fleet grid or left rail shows the agent inspector in the auxiliary bar
- Selecting a task shows the task inspector
- Switching selection type transitions smoothly between inspector panels
- Inspector content updates reactively as harness state changes

---

## Phase 9: Titlebar Redesign

### Objective

Replace the session picker in the titlebar with factory-wide controls: objective selector, fleet status badges, cost indicator, global controls.

### Prerequisites

Phase 3 (fleet state), Phase 5 (fleet command service for aggregates).

### Deliverables

```
src/vs/sessions/browser/parts/titlebarPart.ts    (modify existing)
src/vs/sessions/browser/widget/
├── fleetStatusWidget.ts              Fleet badges in titlebar (active/idle/blocked counts)
├── objectiveSelectorWidget.ts        Dropdown: select active objective
├── costIndicatorWidget.ts            Live cost display ($X.XX / $cap)
└── globalControlsWidget.ts           Pause All, health dot
```

### Implementation Steps

#### 9.1 — Fleet status widget

Replaces the session picker area. Shows badge counts:

```
[4● 1○ 2⚠]
```

- `4●` = 4 active agents (green)
- `1○` = 1 idle agent (gray)
- `2⚠` = 2 agents needing attention (orange)

Click opens the Agents view in the sidebar. Tooltip shows per-status breakdown.

#### 9.2 — Objective selector

Dropdown that shows all active objectives. Selecting one filters the left rail views to show only swarms/tasks/agents for that objective. "All" shows everything.

```
OBJ-042: Payment Processing ▾
```

#### 9.3 — Cost indicator

Live cost readout with budget context:

```
[$47.20/$500]
```

Color-coded: green (<50% budget), yellow (50-80%), orange (80-95%), red (>95%).

#### 9.4 — Global controls

- **Pause All**: Emergency stop. Sends `pauseAll()` through `IHarnessService`.
- **Health dot**: Green/yellow/red based on `IHealthState.mode` (Normal/DiskPressure/CostCeiling).

### Layout

Modify the existing `SessionsTitleBarWidget` (or `TitleService`) to replace the three-section layout:

```
[toggle rail] [fleet status] │ [objective selector] │ [cost] [pause all] [health] [avatar]
     left                         center                         right
```

### Validation

- Fleet badges update in real-time as agents change state
- Objective selector filters all views correctly
- Cost indicator color changes at budget thresholds
- Pause All actually pauses all agents (via harness)
- Health dot reflects harness mode

---

## Phase 10: Multi-Monitor

### Objective

Support multiple Atlas windows with different view profiles pointing at the same harness fabric.

### Prerequisites

Phase 7 (all center stage modes), Phase 8 (inspector), Phase 9 (titlebar).

### Deliverables

```
src/vs/sessions/services/windowProfile/
├── common/
│   └── windowProfileService.ts       IWindowProfileService: named profiles
└── browser/
    └── windowProfileService.ts       Implementation

src/vs/sessions/electron-browser/
    └── sessions.main.ts              (modify: support opening multiple windows with profiles)
```

### Implementation Steps

#### 10.1 — Window profiles

```typescript
export interface IWindowProfile {
    readonly name: string;
    readonly leftRailViews: readonly string[];     // view container IDs to show
    readonly centerStageMode: string;               // default editor to open
    readonly rightInspector: boolean;               // show auxiliary bar
    readonly bottomOps: boolean;                    // show panel
}

export const BUILTIN_PROFILES: readonly IWindowProfile[] = [
    {
        name: 'Operator',
        leftRailViews: ['atlas.swarmsContainer', 'atlas.tasksContainer', 'atlas.fleetContainer'],
        centerStageMode: 'atlas.objectiveBoard',
        rightInspector: true,
        bottomOps: true,
    },
    {
        name: 'Executor',
        leftRailViews: ['atlas.agentsContainer', 'atlas.tasksContainer'],
        centerStageMode: 'atlas.agentView',
        rightInspector: true,
        bottomOps: true,
    },
    {
        name: 'Reviewer',
        leftRailViews: ['atlas.reviewsContainer', 'atlas.mergesContainer'],
        centerStageMode: 'atlas.postReview',
        rightInspector: true,
        bottomOps: false,
    },
    {
        name: 'Ops',
        leftRailViews: ['atlas.fleetContainer', 'atlas.deploymentsContainer'],
        centerStageMode: 'atlas.fleetGrid',
        rightInspector: true,
        bottomOps: true,
    },
];
```

#### 10.2 — Multi-window support

Each window gets its own `IHarnessService` instance, but they can connect to the same harness workspace. Different windows show different profiles (different view configurations) of the same underlying data.

The Electron main process (`sessions.ts` / `sessions.main.ts`) already supports the sessions window. Extend it to accept a profile parameter when opening additional windows:

```typescript
// Command: "Atlas: Open New Window with Profile..."
// Opens a QuickPick of available profiles
// Creates a new BrowserWindow with the selected profile
// The new window connects to the same harness fabric
```

### Validation

- Open two windows with different profiles (Operator + Reviewer)
- Both windows show live data from the same harness
- Actions in one window (approve review) reflect in the other window
- Each window shows the correct views for its profile

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
| Wave A read-only bridge UX | Operator frustration (cannot act yet) | Clear "Writes unavailable in current Wave A bridge" messaging; daemon and polling still surface fleet state truthfully |
| Review model confusion (advisory vs authoritative) | Operator makes decisions on heuristic data | Advisory scores explicitly labeled as "heuristic" in UI; gate state clearly distinguished as "authoritative verdict" |
| Multi-window state sync | Stale data in secondary windows | Each window has its own IHarnessService connected to the same daemon — daemon handles state, not Atlas |
| Fork cleanup conflicts with new code | Merge conflicts | Coordinate with cleanup agent — new code goes in `sessions/`, cleanup targets `workbench/` and `extensions/` — orthogonal directories |
