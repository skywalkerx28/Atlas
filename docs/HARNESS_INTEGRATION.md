# Atlas ↔ Harness Integration

> How Atlas IDE connects to the Syntropic Harness (`axiom-harness`) to surface long-standing agentic work.

---

## Integration Model

### Topology

Atlas should treat the harness as **one shared orchestration fabric per project window**, not as a separate harness universe per task by default.

The current harness runtime already fits that shape:

- one router DB
- one repo root
- one artifact root
- one harness home
- one metrics stream
- many concurrent objectives, tasks, agents, and control actions multiplexed inside that shared domain

So the Atlas execution model should be:

- one project opened in Atlas
- one harness fabric backing that project
- many concurrent swarms inside that fabric
- each swarm rooted at an objective or root task
- each swarm composed from task hierarchy, agent graph, worktrees, memory, artifacts, reviews, and activity

This is important because it preserves shared fleet visibility, review control, merge control, memory promotion, and operator ergonomics. Spinning up a separate process, DB, and memory universe for every task too early would fragment the very things Atlas is meant to supervise.

Atlas connects to the harness through **two modes**, with automatic fallback:

### Primary: Daemon Mode (Real-Time)

The harness daemon (`axiom-harness serve`) is a long-running process that exposes a **JSON-RPC 2.0** protocol over a **Unix domain socket** (`~/.codex/harness.sock`). Atlas connects as a client with an `initialize` handshake (version negotiation, token auth, capability discovery), performs a post-initialize `daemon.ping` read check, and then subscribes only to the public notification streams the current daemon branch actually exposes. See `syntropic-harness-fresh/docs/design/DAEMON_ARCHITECTURE.md` for the broader target design including:

- **Authentication**: Token-based client identity, per-method capability model, audit attribution on all writes
- **Resumable streams**: Monotonic sequence numbers per topic, resume-from-seq on reconnect, `resync_required` for gap recovery
- **Stream classification**: Coalescible topics (fleet, health, cost) vs. loss-intolerant topics (reviews, journal, transcripts, activity)
- **Write delegation (future)**: once the daemon exposes write families, Atlas should route them through daemon methods such as `dispatch.submit`, `objective.submit`, and `event.emit` rather than bypassing harness validation
- **Failure isolation**: Daemon and orchestrator run as independent tokio tasks with bounded queues and panic containment

Important current-branch constraint: `streams.rs` already classifies future topics like `health`, `cost`, `review`, and `agent.activity:*`, but `session.rs` does not expose public subscribe methods for them yet. The current Atlas bridge must therefore treat those as internal daemon scaffolding, not as shipped API.

### Fallback: Read-Only Polling

Wave A Atlas does not implement the TUI's broader direct-mode IPC surface. When the daemon is absent, Atlas falls back only to:

1. **SQLite read** — Read-only connection to `router.db` for fleet-relevant polling.

JSONL tailing and CLI subprocess write paths are intentionally not implemented in the Atlas bridge. This preserves a single authenticated control plane instead of adding a second write surface beside the daemon.

### Write Contract

Atlas does **not** write directly to `dispatch_queue`, `workspace_event_queue`, or `objectives` tables. These tables have validation, idempotency, and journal recording logic in the harness service layer (`EventDispatcher`, `ObjectiveIntakeService`, `dispatch.rs`) that must not be bypassed.

Wave A Atlas ships **no write path**. In both daemon mode and polling mode:

- `writesEnabled` is `false`
- all `IHarnessService` write methods fail closed
- there is no CLI subprocess write fallback
- there is no direct SQLite write path

When later daemon method families exist, Atlas can delegate writes through the daemon only.

Atlas implements this as `IHarnessService` — a singleton service in `sessions/services/harness/` that manages a connection to one harness workspace and exposes harness state as observables. On the current daemon branch, only fleet and derived health populate from daemon/polling reads; the other observables remain explicit empty/default surfaces until public daemon methods land.

### Swarm Model

Atlas should expose a first-class `Task Swarm` abstraction built from existing harness primitives rather than inventing a new backend silo.

At the data layer, a swarm is derived from:

- one root objective or root task
- the descendant task DAG from `planner_hierarchy` and `task_hierarchy`
- the active and historical dispatches in `dispatch_queue` and `dispatch_journal`
- the owned worktrees in `worker_registry`
- the swarm memory lane in `memory_records`, `memory_reads`, `memory_links`, and `memory_promotions`
- the swarm event stream in `workspace_event_queue` and activity JSONL
- the swarm review and promotion state in `review_queue`, `review_candidates`, and `merge_queue`

The implication for Atlas is simple: the UI should group data by swarm first, then let the operator drill down to task, agent, run, diff, or file. Files and sessions are subordinate inspection surfaces, not the primary unit of navigation.

---

## IHarnessService

The central bridge between Atlas and the harness. Manages:

- **Connection lifecycle**: Attempts daemon socket at `$AXIOM_HARNESS_SOCK` or `~/.codex/harness.sock`; falls back to resolving `router.db` via the harness path resolution chain (see Environment Variables below)
- **Daemon mode (Wave A)**: Performs `initialize`, loads `fleet.snapshot`, subscribes to `fleet.delta`, and keeps unsupported observables empty/default
- **Polling mode** (fallback): Polls read-only SQLite tables for fleet-relevant state on an interval
- **Write operations (Wave A)**: All writes fail closed. Atlas does not shell out to `axiom-harness`, invoke `orchestrator-backend.sh`, or write `dispatch_control`
- **State aggregation**: Mirrors the TUI's `FleetSnapshot` pattern — assembles all data into a single reactive state tree

```typescript
interface IHarnessService {
    // Connection
    readonly connectionState: IObservable<IHarnessConnectionInfo>;
    connect(workspaceRoot: URI): Promise<void>;
    disconnect(): Promise<void>;
    readonly onDidDisconnect: Event<void>;

    // Fleet state
    readonly objectives: IObservable<readonly IObjectiveState[]>;
    readonly swarms: IObservable<readonly ISwarmState[]>;
    readonly tasks: IObservable<readonly ITaskState[]>;
    readonly fleet: IObservable<IFleetState>;
    readonly health: IObservable<IHealthState>;
    readonly cost: IObservable<ICostState>;

    // Three-tier review state
    readonly advisoryReviewQueue: IObservable<readonly IAdvisoryReviewEntry[]>;
    readonly reviewGates: IObservable<readonly IReviewGateState[]>;
    readonly mergeQueue: IObservable<readonly IMergeEntry[]>;

    // Inspection
    getObjective(objectiveId: string): Promise<IObjectiveState | undefined>;
    getSwarm(swarmId: string): Promise<ISwarmState | undefined>;
    getTask(taskId: string): Promise<ITaskState | undefined>;
    getAgent(dispatchId: string): Promise<IAgentState | undefined>;
    getReviewGate(dispatchId: string): Promise<IReviewGateState | undefined>;
    getTaskPacket(taskId: string): Promise<ITaskPacket | undefined>;
    getResultPacket(dispatchId: string): Promise<IResultPacket | undefined>;
    getTranscript(dispatchId: string): Promise<readonly ITranscriptEntry[]>;
    getMemoryRecords(swarmId: string): Promise<readonly IMemoryRecord[]>;
    getWorktreeState(dispatchId: string): Promise<IWorktreeState | undefined>;

    // Control actions (Wave A: fail closed in all modes)
    pauseAgent(dispatchId: string): Promise<void>;
    cancelAgent(dispatchId: string): Promise<void>;
    resumeAgent(dispatchId: string): Promise<void>;
    steerAgent(dispatchId: string, message: string): Promise<void>;
    pauseAll(): Promise<void>;
    resumeAll(): Promise<void>;

    // Dispatch (Wave A: fail closed until daemon exposes dispatch methods)
    submitObjective(problemStatement: string, options?: IObjectiveSubmitOptions): Promise<string>;
    submitDispatch(command: IWireDispatchCommand): Promise<string>;

    // Review actions (Wave A: fail closed until daemon exposes review methods)
    recordGateVerdict(dispatchId: string, decision: ReviewDecision, reviewedByRole: string): Promise<void>;
    authorizePromotion(dispatchId: string, authorizedByRole: string): Promise<void>;
    enqueueForMerge(dispatchId: string): Promise<void>;

    // Activity
    subscribeAgentActivity(dispatchId: string): IObservable<readonly ITranscriptEntry[]>;
    subscribeSwarmActivity(swarmId: string): IObservable<readonly ITranscriptEntry[]>;
}
```

---

## SQLite Schema (What Atlas Reads)

All tables live in a single `router.db`. In daemon mode, Atlas does not open SQLite directly — the daemon handles all reads and pushes deltas. In fallback mode, Atlas opens a **read-only** connection for polling only.

### Core Tables

| Table | Purpose | Key Columns | Atlas Surface |
|-------|---------|-------------|---------------|
| `worker_registry` | Live agent state | `dispatch_id`, `task_id`, `role_id`, `state` (queued/spawning/ready/executing/paused/completing/completed/failed/timed_out/killed), `worktree_path`, `pid`, `started_at`, `last_heartbeat_at` | Agents View, Fleet Command |
| `dispatch_queue` | Task pipeline | `dispatch_id`, `task_id`, `role_id`, `priority` (p0-p3/info), `handoff_type`, `status` (queued/paused/completed/failed/...), `metadata` (JSON), `enqueued_at` | Tasks View, Objective Board |
| `objectives` | Objective lifecycle | `objective_id`, `problem_statement`, `priority`, `status` (open/planning/executing/reviewing/completed/failed), `root_task_id`, `spec_json` | Objectives View |
| `dispatch_journal` | State transition log | `dispatch_id`, `task_id`, `role_id`, `previous_state`, `new_state`, `metadata_json`, `created_at` | Agent Execution View (replay) |
| `workspace_event_queue` | Event bus | `event_id`, `task_id`, `role_id`, `event_kind`, `payload_json`, `status` (pending/processing/acked/dead_letter) | Activity Stream |
| `review_queue` | Review entries | `task_id`, `state`, `decision`, `score`, `confidence`, `failed_checks`, `summary` | Reviews View |
| `pool_health` | Fleet health (singleton) | `mode` (normal/nats_down/disk_pressure/cost_ceiling/paused), `disk_usage_pct`, `memory_usage_pct`, `active_workers`, `queue_depth` | Fleet Command, Health Monitor |
| `dispatch_control` | Control commands | `action` (pause/cancel/pause_all/resume_all/reprioritize), `dispatch_id`, `new_priority` | Not used by Wave A Atlas bridge |
| `resource_snapshots` | Per-dispatch resources | `dispatch_id`, `cpu_utilization`, `memory_utilization`, `disk_utilization` | Agent Inspector |

These are not separate per-task databases. Atlas derives swarm boundaries by grouping records around objective/root-task lineage inside this shared project-level store.

### Extended Tables (Verified Against Harness Schema)

| Table | Source File | Purpose | Atlas Surface |
|-------|------------|---------|---------------|
| `collaboration_dispatches` | `schema.rs` | Inter-agent dispatch tracking with ACK | Objective Board (dependency view) |
| `review_queue` | `schema.rs` | Prioritized review items with scoring | Reviews View |
| `merge_queue` | `merge_queue.rs` | Git promotion / merge queue state | Merge Control |
| `review_candidates` | `merge_queue.rs` | Review candidate tracking | Reviews View |
| `memory_records` | `memory.rs` | Governed memory records (per scope) | Agent Inspector, Artifact Browser |
| `memory_links` | `memory.rs` | Cross-reference links between memory records | Agent Inspector |
| `memory_reads` | `memory.rs` | Memory read/query audit trail | Agent Inspector |
| `memory_promotions` | `memory.rs` | Memory promotion history (task → objective → workspace) | Agent Inspector |
| `planner_hierarchy` | `planner_hierarchy.rs` | Task tree (recursive CTE) | Objective Board (decomposition tree) |

### How Atlas Derives a Swarm

```text
Objective/root task
  -> task hierarchy descendants
  -> dispatch queue + journal entries for those tasks
  -> worker registry entries for active agents on those dispatches
  -> memory records scoped to those task_ids/dispatch_ids
  -> workspace events and activity stream entries for those tasks
  -> review and merge state linked to those tasks
```

This lets Atlas present one coherent execution board per swarm without requiring a new harness process for every task.

---

## JSONL Event Streams

### Activity Stream

**Path**: `<run_dir>/activity.jsonl` per dispatch.
**Read pattern**: `ActivityStreamReader` with seek-based incremental reads.

```typescript
interface IActivityEvent {
    ts: string;                          // ISO timestamp
    dispatch_id: string;
    task_id: string;
    objective_id?: string;
    role_id: string;
    handoff_type?: string;
    kind: ActivityEventKind;
    summary: string;
    tool?: string;
    file_path?: string;
    diff_stat?: { lines_added: number; lines_removed: number };
    command?: string;
    exit_code?: number;
    duration_ms?: number;
}

type ActivityEventKind =
    | 'ToolUse' | 'ToolResult' | 'ToolError'
    | 'CommandStart' | 'CommandResult'
    | 'FileEdit' | 'FileCreate' | 'FileRead'
    | 'Reasoning' | 'AgentMessage'
    | 'Milestone' | 'Decision' | 'Artifact'
    | 'Error'
    | 'SessionStart' | 'TurnComplete' | 'SessionEnd';
```

### Metrics Stream

**Path**: `~/.codex/workspace-comms/metrics.jsonl` (default).

```typescript
interface IMetricRecord {
    metric: string;       // e.g. 'dispatch_cost_usd', 'dispatches_total'
    value: number;
    priority?: string;
    task_id?: string;
    dispatch_id?: string;
    timestamp: string;
}
```

---

## Wire Formats

### Task Packet (What Gets Dispatched)

```typescript
interface ITaskPacket {
    task_id: string;
    created_at: string;
    from_role: string;
    to_role: string;                     // 'axiom-planner' | 'axiom-worker' | 'axiom-judge'
    summary: string;
    acceptance: string[];                // Acceptance criteria
    artifacts: string[];
    constraints?: string;
    handoff_type?: HandoffType;          // intake|planning|specification|implementation|verification|review|clarification
    execution_prompt?: string;           // Up to 16000 chars — the self-contained prompt for the agent
    verification?: {
        required: boolean;
        commands: string[];              // e.g. ['cargo test', 'npm run lint']
        required_roles?: string[];
    };
    parallelization?: {
        mode: 'serial' | 'parallel';
        group_id?: string;
        lane_id?: string;
        owned_paths?: string[];
        avoid_paths?: string[];
        merge_strategy?: string;
    };
    push_authorization?: {
        remote: string;
        branch: string;
        refspec: string;
    };
    budget_ceiling_usd?: number;
    memory_keywords?: string[];
    context_paths?: string[];
    git_branch?: string;
    git_base?: string;
}

type HandoffType = 'intake' | 'planning' | 'specification' | 'implementation' | 'verification' | 'review' | 'clarification';
```

### Result Packet (What Comes Back)

```typescript
interface IResultPacket {
    task_id: string;
    created_at: string;
    from_role: string;
    to_role: string;
    status: 'done' | 'blocked' | 'failed' | 'needs_clarification';
    summary: string;
    artifacts: string[];
    acceptance_results?: Array<{
        criterion: string;
        status: 'pass' | 'fail' | 'not_run';
        evidence: string;
    }>;
    decision?: 'go' | 'no-go' | 'n/a';          // Judge verdict
    review_state?: 'not_requested' | 'awaiting_review' | 'review_blocked' | 'review_go';
    promotion_state?: 'not_requested' | 'promotion_requested' | 'promotion_authorized' | 'abandoned';
    integration_state?: 'not_ready' | 'queued' | 'merge_started' | 'merged' | 'merge_blocked' | 'abandoned';
    git_branch?: string;
    head_sha?: string;
    commit_shas?: string[];
    working_tree_clean?: boolean;
    pushed?: boolean;
    merge_ready?: boolean;
    merged_sha?: string;
    risks?: string[];
    next_actions?: string[];
}
```

### Workspace Event (Inter-Agent Communication)

```typescript
interface IWorkspaceEvent {
    event_id: string;
    idempotency_key: string;
    task_id: string;
    role_id: string;
    event_kind: WorkspaceEventKind;
    status: 'open' | 'in_progress' | 'blocked' | 'done' | 'failed';
    severity: 'info' | 'p3' | 'p2' | 'p1' | 'p0';
    summary: string;
    next_action: string;
    artifacts: string[];
    created_at: string;
    metadata?: {
        head_sha?: string;
        git_branch?: string;
        dispatch_id?: string;
        handoff_to_role?: string;
        handoff_message?: string;
        steer_target_role?: string;
        steer_message?: string;
        steer_urgency?: string;
        cycle_judge_reason?: string;
        cycle_judge_decision?: string;
        // ... many more
    };
}

type WorkspaceEventKind =
    | 'task_opened' | 'status_update' | 'plan_updated'
    | 'task_handoff' | 'steer' | 'spec_ready'
    | 'verification_passed' | 'verification_failed'
    | 'release_go' | 'release_no_go'
    | 'promotion_requested' | 'promotion_authorized'
    | 'memory_candidate' | 'memory_candidate_accepted' | 'memory_candidate_rejected' | 'memory_promoted'
    | 'merge_started' | 'merge_completed' | 'merge_blocked'
    | 'task_completed' | 'task_fan_out' | 'task_aggregation_complete';
```

---

## Checkpoint / Transcript Replay

Each dispatch has a checkpoint directory: `<harness_home>/.codex/orchestrator/checkpoints/<dispatch_id>/`

| File | Content |
|------|---------|
| `<dispatch_id>.json` | `WorkerCheckpoint`: last action, files modified, tests passed, acceptance status, git SHA |
| `conversation.jsonl` | Session transcript — the agent's full conversation |
| `conversation.metadata.json` | Metadata: dispatch_id, task_id, role_id, line count, byte count |

**Transcript streaming**: Read the last N lines from `conversation.jsonl` for live-updating Agent Execution View. The file is append-only during execution — new lines appear as the agent works.

**Replay**: `axiom-harness replay <dispatch_id>` returns the state transition timeline from `dispatch_journal`.

---

## Configuration Files Atlas Should Read

| File | Path (relative to harness root) | What Atlas Shows |
|------|-------------------------------|------------------|
| Agent roles | `codex/agent_roles.yaml` | Fleet Command (role definitions) |
| Cost budget | `codex/cost-budget.json` | Cost Monitor (ceiling, per-task limits, alert threshold) |
| Model pricing | `codex/model-pricing.json` | Cost Monitor (per-model cost calculations) |
| Router policy | `codex/agents/workspace-router-policy.json` | Ops/Policy (pool limits, cycle judge config, handoff map) |
| Dispatch policy | `codex/agents/workflows/dispatch-policy.json` | Ops/Policy (role-to-role ACL) |
| Exec-policy rules | `codex/execpolicy/axiom-{planner,worker,judge}.rules` | Pre-Execution Review (tool scope, command allow/forbid) |
| Playbooks | `codex/agents/playbooks/*.yaml` | Objective Board (SDLC phase definitions) |
| Behavioral contracts | `codex/agents/contracts/*.md` | Agent Inspector (what the agent was instructed to do) |

---

## Data Flow: Atlas Surface → Harness Source

### Daemon Mode (Primary, Wave A)

| Atlas Surface | Daemon Subscription | Daemon Request | Write Method |
|---------------|-------------------|----------------|--------------|
| Fleet Command | `fleet.delta` | `fleet.snapshot` | — |
| Agents View | `fleet.delta` | `fleet.snapshot` | — |
| Health Monitor | `fleet.delta` | `fleet.snapshot` | — |
| Cost Monitor | — | — | — |
| Tasks / Objectives / Reviews / Merge / Activity | — | — | — |
| Any write action | — | — | Fail closed |

Wave A / Wave B on the current harness branch consume the same public daemon surface: `initialize`, `shutdown`, `daemon.ping`, `fleet.snapshot`, `fleet.subscribe`, and `fleet.unsubscribe`. `daemon.ping` is used as a post-initialize compatibility check, while fleet state still comes from `fleet.snapshot` / `fleet.delta`. Later topic and write families remain future work until the daemon exposes public methods for them.

### Fallback Mode (SQLite Polling)

| Atlas Surface | Read From | Write To | Poll Interval |
|---------------|-----------|----------|---------------|
| Fleet Command | `worker_registry` + `dispatch_queue` + `pool_health` + queue tables | — | 1s |
| Agents View | `worker_registry` + `dispatch_queue` | — | 1s |
| Health Monitor | `pool_health` + queue tables | — | 1s |
| Cost / Tasks / Objectives / Reviews / Merge / Activity | — | — | — |
| Any write action | — | Fail closed | — |

---

## Environment Variables

### Daemon Socket (Primary)

| Variable | Purpose | Default |
|----------|---------|---------|
| `AXIOM_HARNESS_SOCK` | Path to daemon Unix socket | `~/.codex/harness.sock` |

Atlas tries the daemon socket first. If the socket is absent or unreachable, it falls back to read-only polling using the DB path resolution below. Protocol/auth/capability failures stay fail-closed rather than degrading to polling.

### DB Path Resolution Chain (Fallback)

The harness resolves `router.db` through a multi-step chain (see `helpers.rs:resolve_router_db_path`). Atlas must follow the same logic:

1. **Explicit CLI value** — If the user provides a path, use it.
2. **Environment variables** (first non-empty wins):
   - `AXIOM_FRONTIER_RUNNER_DB`
   - `AXIOM_WORKSPACE_ROUTER_STATE_DB`
   - `AXIOM_WORKSPACE_ROUTER_DB`
   - `AXIOM_INTEGRATION_DB_PATH`
3. **Active validation run** — Scans `$AXIOM_HARNESS_HOME/.codex/soak-runs/` for the latest active run directory (has `router.db`, no `report.json`, recent activity within 900s).
4. **Managed frontier env file** — Reads `$AXIOM_FRONTIER_ENV_FILE` (default `/etc/syntropic/frontier-runner.env`) and extracts `AXIOM_FRONTIER_RUNNER_DB`.
5. **Hardcoded fallback** — `~/.codex/workspace-comms/router.db`

### Other Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `AXIOM_FRONTIER_RUNNER_METRICS_FILE` | Path to `metrics.jsonl` | `~/.codex/workspace-comms/metrics.jsonl` |
| `AXIOM_FRONTIER_RUNNER_ARTIFACT_DIR` | Artifact output directory | `~/.codex/workspace-comms/artifacts/` |
| `AXIOM_FRONTIER_REPO_ROOT` | Target repository root | — |
| `AXIOM_HARNESS_HOME` | Harness installation root | — |
| `AXIOM_WORKSPACE_ROOT` | Workspace the harness operates on | — |
| `AXIOM_POOL_MAX_WORKERS` | Max concurrent workers | 32 |

---

## Long-Standing Agentic Sessions

The harness is designed for **long-running objectives** that span hours or days, with multiple agent cycles. Atlas surfaces this by:

1. **Persistent objective tracking** — Objectives have a lifecycle (open → planning → executing → reviewing → completed/failed) with `resume_count` and `max_resume_cycles`. Atlas shows the objective's journey across multiple planner-worker-judge cycles.

2. **Cross-session continuity** — When a planner resumes after workers complete, it receives a `PlannerResumeContext` with aggregated results from all subtasks. Atlas shows this in the Objective Board as the decomposition tree updating across cycles.

3. **Checkpoint-based recovery** — If a worker crashes, its checkpoint (`WorkerCheckpoint`) captures the last known state. Atlas can show "last known state" for failed agents and offer restart from checkpoint.

4. **Governed memory** — Memory records persist across sessions with scope boundaries (task, objective, workspace). Atlas shows memory in the Agent Inspector and allows browsing memory records in the Artifact Browser.

5. **Cost accumulation** — Cost accrues across the entire objective lifecycle, not just one dispatch. Atlas shows cumulative cost in the Objective Board and per-dispatch cost in the Agent Execution View.
