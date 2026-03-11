# Atlas Design Needs

> What must be designed and built to turn the VS Code sessions layer into a software factory control plane.

---

## Design Priorities

Ordered by implementation phase. Each section describes what needs designing, what exists to build on, and what's new.

---

## 1. Harness Bridge (Phase 1)

### What Needs Designing

A service layer that connects Atlas to the Syntropic Harness via the harness daemon (JSON-RPC 2.0 over Unix socket), with SQLite + JSONL polling as fallback. This is the data foundation — every surface depends on it.

**Key decisions**:
- **Daemon-first, polling-fallback**: Primary transport is the harness daemon (`axiom-harness serve`) which pushes real-time deltas over a Unix socket. When the daemon is not running, Atlas falls back to direct SQLite polling + JSONL tailing (the TUI's model). See `syntropic-harness-fresh/docs/design/DAEMON_ARCHITECTURE.md`.
- **Connection model**: One `IHarnessService` per Atlas window, connected to one harness workspace or project fabric. Multi-workspace requires multiple windows.
- **Execution model**: The harness service exposes many concurrent swarms inside that one project fabric. Atlas should not assume one harness process or DB per task by default.
- **Write contract**: Atlas writes only to `dispatch_control` table directly (safe, harness expects this). All other writes (dispatch, objectives, workspace events, steering) go through CLI subprocess or daemon JSON-RPC — never direct SQLite inserts. The harness service layer performs validation, idempotency, and journal recording that must not be bypassed.
- **Desktop-only (Phase 1)**: The harness bridge requires native socket or filesystem access. The web/browser layer gets a stub implementation. Web support comes later via the daemon's optional WebSocket bridge.
- **Error handling**: Harness may not be running. Atlas should degrade gracefully — show "Harness not connected" state, still allow browsing cached data.

**Exists**: Nothing in Atlas. The daemon architecture is designed (`DAEMON_ARCHITECTURE.md`) and ready to implement in the harness.

**See**: [HARNESS_INTEGRATION.md](HARNESS_INTEGRATION.md) for wire formats and data flow.

---

## 2. State Model (Phase 1)

### What Needs Designing

TypeScript interfaces for all first-class nouns. These are the shared types every view consumes. Must map cleanly from harness wire types (task packets, result packets, workspace events) to presentation types.

**Key decisions**:
- **Swarm-first model**: `ISwarmState` is the primary execution aggregate. It groups tasks, agents, memory, worktrees, reviews, and costs under one root objective or root task.
- **Attention model**: Every entity has an `attentionLevel` computed from its state. This drives what surfaces at the top of every list. Design the attention scoring algorithm.
- **Reactivity**: All state must be observable. Use the existing `IObservable` pattern from `vs/base/common/observable`.
- **Selection model**: A global `ISelectedEntity` that all views react to. Selecting an agent in the fleet command updates the right inspector, changes the center stage, etc.
- **Time**: Agents have time-in-state, cost-over-time, and activity timestamps. Design how time-based computations flow (SLA timers, idle detection thresholds).

**Attention levels** (draft):

| Level | Condition | Visual |
|-------|-----------|--------|
| Critical | Agent failed, over-budget, incident open | Red badge, auto-surfaces to top |
| Needs Action | Review pending, agent blocked, drift detected | Orange badge |
| Active | Agent executing, task in progress | Green indicator |
| Idle | Agent waiting, no work queued | Gray indicator |
| Completed | Task done, merged, deployed | Checkmark, fades to history |

**Exists**: `IActiveSessionItem` provides a starting point for entity selection. The chat model's observable patterns are reusable.

---

## 3. Left Rail Navigation (Phase 2)

### What Needs Designing

Replace the single "Sessions" view with swarm-first navigation in the sidebar.

**Key decisions**:
- **View switching UX**: How does the user switch between Tasks, Agents, Reviews, etc.? Options:
  - Tab bar at top of sidebar (like VS Code's activity bar but horizontal)
  - Dropdown selector
  - Keyboard shortcuts (Cmd+1 for Tasks, Cmd+2 for Agents, etc.)
  - All views visible in a collapsible accordion
- **Badge system**: Review count, drift alert count, failed agent count visible on the view switcher even when that view isn't active.
- **Default view**: What opens when Atlas launches? Swarms or Fleet depending on current activity.

**View specifications**:

| View | Tree Pattern | Grouping | Sort | Actions |
|------|-------------|----------|------|---------|
| Swarms | `WorkbenchCompressibleObjectTree` | By objective, phase, or attention | Attention, cost, age | Open board, pause, reprioritize |
| Tasks | `WorkbenchCompressibleObjectTree` | By status (executing/queued/reviewing/done) or by swarm | Priority, age, cost | Open, pause, cancel, reprioritize |
| Agents | `WorkbenchCompressibleObjectTree` | By role (planner/worker/judge) or by status | Attention level, cost, age | Open, pause, cancel, steer, open terminal |
| Reviews | `WorkbenchCompressibleObjectTree` | By phase (pre/in-flight/post) | Priority, age | Open review, approve, reject |
| Objectives | `WorkbenchCompressibleObjectTree` | By status (planning/executing/reviewing/done) | Priority, cost | Open board, replan |
| Artifacts | `WorkbenchCompressibleObjectTree` | By type, by objective, by agent | Recency | Open, link |
| Merges | Flat list | By priority | Readiness | Merge, rollback |
| Deployments | Flat list | By pipeline | Status | Deploy, rollback |
| Fleet | Custom (dashboard-style) | — | — | Pause all, resume |
| Ops | Accordion sections | — | — | Configure |

**Exists**: `AgenticSessionsViewPane` with filters and grouping (reusable pattern). `WorkbenchCompressibleObjectTree` is the standard tree widget. `ChangesViewPane` demonstrates tree with inline stats and footer actions.

The navigation order should reinforce the new mental model:

`Project -> Objective -> Swarm -> Task -> Agent -> Artifact/Review`

not:

`Workspace -> File tree -> editor tab`

---

## 4. Fleet Command (Phase 3)

### What Needs Designing

The primary awareness surface. Shows all agents with live state, attention flags, cost burn, and SLA timers.

**Layout** (when rendered in center stage as Fleet Grid):
```
┌─────────────────┬─────────────────┬─────────────────┐
│ ● planner-main  │ ● worker.pool.0 │ ● worker.pool.1 │
│ Planning        │ Coding          │ Coding           │
│ obj-042         │ task-128        │ task-129          │
│ $4.20  12m      │ $2.40  8m       │ $1.80  5m        │
│ [last: decomp.] │ [last: edit]    │ [last: test]     │
├─────────────────┼─────────────────┼─────────────────┤
│ ● worker.pool.2 │ ○ worker.pool.3 │ ● judge-0       │
│ Testing         │ IDLE            │ Reviewing         │
│ task-127        │                 │ task-126          │
│ $0.90  3m       │                 │ $0.60  2m        │
│ [last: verify]  │ ⚠ idle 4m      │ [verdict pending]│
└─────────────────┴─────────────────┴─────────────────┘
```

**Key design needs**:
- **Card widget**: Reusable agent card showing name, role, state, task, cost, time, last activity. Must be live-updating.
- **Grid layout**: Flexible grid that auto-sizes. Support maximizing per monitor.
- **Swarm grouping**: Operators must be able to toggle between a global fleet view and grouped-by-swarm columns or cards.
- **Status colors**: Consistent color coding across all surfaces (active=green, idle=gray, blocked=orange, failed=red, reviewing=blue).
- **Click behavior**: Click card → expands to Agent Execution View. Right-click → context menu with actions.
- **Idle detection visual**: Agents idle beyond threshold get a warning indicator with time-idle counter.

**Exists**: Nothing directly. The `WorkbenchCompressibleObjectTree` can render the compact sidebar list. The grid widget is entirely new — closest analogy is `SerializableGrid` from `vs/base/browser/ui/grid/grid.ts` but for dynamic card layouts.

---

## 5. Three Review Surfaces (Phase 4)

### What Needs Designing

The highest-leverage feature. Three distinct but connected review experiences.

#### Pre-Execution Review

**Layout**:
```
┌──────────────────────────────────────────────┐
│ Task: auth refactor (task-128)    P1  $50 cap│
├──────────────────────────────────────────────┤
│ TASK SPEC                                    │
│ Summary: Refactor auth middleware to use...   │
│                                              │
│ ACCEPTANCE CRITERIA                           │
│ ☐ All existing auth tests pass               │
│ ☐ New OAuth2 flow added with tests           │
│ ☐ No breaking changes to API                 │
│                                              │
│ PLAN PREVIEW                                  │
│ ┌─task-128a (modify provider.ts)             │
│ ├─task-128b (add oauth2.ts)                  │
│ └─task-128c (update tests)                   │
│                                              │
│ TOOL SCOPE: git add/commit, cargo test ✓     │
│ MODEL: claude-opus-4-6 ($0.015/1K input)     │
│ RISK: touches 3 files, no conflicts          │
├──────────────────────────────────────────────┤
│ [Approve Plan]  [Modify]  [Reject]  [Skip]   │
└──────────────────────────────────────────────┘
```

#### In-Flight Review

**Layout** (split view):
```
┌──────────────────────┬───────────────────────┐
│ LIVE TRANSCRIPT      │ LIVE DIFF              │
│                      │                        │
│ Agent: thinking...   │ src/auth/provider.ts   │
│ Tool: edit file      │ @@ -42,6 +42,15 @@    │
│ > src/auth/provider  │ + import { OAuth2 }    │
│ Agent: now I need    │ + from './oauth2';     │
│ to add the OAuth2... │                        │
│                      │ src/auth/oauth2.ts     │
│ [auto-scrolling ↓]   │ + export class OAuth2  │
│                      │ + {                    │
├──────────────────────┤ +   async authorize()  │
│ Cost: $1.20 / $50    │                        │
│ Time: 4m 22s         │                        │
│ Progress: ████░░ 60% │                        │
├──────────────────────┴───────────────────────┤
│ [Steer ✏️]  [Pause ⏸]  [Cancel ✕]  [Escalate]│
└──────────────────────────────────────────────┘
```

#### Post-Execution Review

**Layout**:
```
┌──────────────────────────────────────────────┐
│ task-128: auth refactor      ✓ DONE  $2.40   │
├──────────────────────────────────────────────┤
│ ACCEPTANCE CRITERIA                           │
│ ✅ All existing auth tests pass              │
│ ✅ New OAuth2 flow added with tests          │
│ ✅ No breaking changes to API                │
│                                              │
│ JUDGE VERDICT: go ✅                         │
│ "All criteria met. Tests comprehensive."     │
│                                              │
│ DIFF (3 files, +127 -14)                     │
│ ▸ M src/auth/provider.ts    +15 -8           │
│ ▸ A src/auth/oauth2.ts      +98              │
│ ▸ M tests/auth.test.ts      +14 -6           │
│                                              │
│ TEST EVIDENCE                                 │
│ ✅ 42 tests passed, 0 failed                 │
│ Coverage: 87% (+3%)                          │
├──────────────────────────────────────────────┤
│ [Approve & Merge]  [Request Changes]  [Next ▸]│
└──────────────────────────────────────────────┘
```

**Batch review**: After approve/reject, auto-advance to next item. Counter shows "3 of 7 reviews remaining."

**Exists**: `ChangesViewPane` provides the diff rendering foundation. `CodeReviewService` provides the review toolbar pattern. `AgentFeedback` module provides inline comment/annotation infrastructure.

---

## 6. Objective and Swarm Boards (Phase 2-3)

### What Needs Designing

Two related but distinct boards:

- **Objective Board**: Strategic view showing how a product goal decomposes and where review gates or drift signals exist.
- **Swarm Board**: Execution view showing the live swarm running inside one objective/root-task boundary.

The current sessions layer has nothing like this. Both boards are new and both are first-class.

**Layout**:
```
OBJ-042: Add Payment Processing          $18.40 / $100

[Requirement: FEAT-012] → [Blueprint: payment-api]

  ┌──────────┐     ┌──────────┐     ┌──────────┐
  │ task-126  │────▸│ task-128  │────▸│ task-130  │
  │ ✅ done   │     │ ● coding  │     │ ○ queued  │
  │ spec      │     │ pool.0    │     │ migration │
  └──────────┘     └──────────┘     └──────────┘
                         │
                    ┌──────────┐
                    │ task-129  │
                    │ ● coding  │
                    │ pool.1    │
                    └──────────┘
                         │
                    ┌──────────┐
                    │ task-131  │
                    │ ○ queued  │
                    │ frontend  │
                    └──────────┘

Stage: 5/12 tasks executing    Review gate: task-126 approved
```

**Key design needs**:
- **DAG rendering**: Node-and-edge graph showing task dependencies. Nodes show status, agent, cost.
- **Interactive**: Click a node → selects that task, updates right inspector. Double-click → opens Agent Execution View.
- **Live updating**: Nodes update state in real-time as agents complete work.
- **Zoom levels**: Objective-level (all tasks as nodes) → task-level (subtask detail) → agent-level (execution detail).
- **Swarm overlays**: The execution board must also show memory lane, active worktrees, review state, and bottlenecks for the selected swarm.

**Exists**: Nothing for DAG visualization. VS Code has `SerializableGrid` for layout but nothing for graph rendering. May need a lightweight DAG layout library or custom canvas rendering.

---

## 7. Center Stage Mode Switching

### What Needs Designing

The center area needs to switch between multiple modes based on what the operator is doing.

**Options**:
- **Editor-group style**: Each mode opens in an "editor" tab (leveraging the existing editor infrastructure). Objective Board, Agent View, Fleet Grid, etc. are all editor inputs.
- **Custom mode switcher**: A dedicated mechanism outside the editor system.

**Recommendation**: Use the editor infrastructure. Each center stage mode is an `EditorInput` subclass that opens in the modal editor. This leverages existing keyboard navigation, tab management, and focus handling. The `ChatViewPane` is already in the ChatBar, so chat stays there — the center stage handles everything else.

---

## 8. Right Inspector Design

### What Needs Designing

A context-sensitive detail panel in the auxiliary bar. Shows different content based on `ISelectedEntity`.

**Implementation**: Multiple view containers registered in `ViewContainerLocation.AuxiliaryBar`, each with `when` clauses that activate based on the selected entity kind. VS Code's view visibility system handles this natively.

```typescript
// Agent inspector shows when an agent is selected
registerViewContainer({
    id: 'atlas.inspector.agent',
    when: ContextKeyExpr.equals('atlas.selectedEntityKind', 'agent'),
    ...
});

// Task inspector shows when a task is selected
registerViewContainer({
    id: 'atlas.inspector.task',
    when: ContextKeyExpr.equals('atlas.selectedEntityKind', 'task'),
    ...
});
```

**Exists**: The auxiliary bar and `ChangesViewPane` provide the pattern. Context key-driven visibility is native to the view system.

---

## 9. Titlebar Redesign

### What Needs Designing

Replace the session picker with factory-wide controls.

**Current**: `[toggle sidebar]` `[session picker]` `[run script] [open] [toggle aux]`

**Atlas**:
```
[toggle rail] [4● 1○ 2⚠] │ OBJ-042: Payment Processing ▾ │ [$47.20/$500] [⏸ Pause All] [●] [avatar]
     ↑ fleet badges              ↑ objective selector          ↑ cost     ↑ health  ↑ account
```

**Exists**: `SessionsTitleBarWidget` provides the custom widget pattern. `MenuWorkbenchToolBar` provides the three-section layout. Badges and indicators are new.

---

## 10. Multi-Monitor (Phase 6)

### What Needs Designing

Named window profiles that control which surfaces are visible in each window.

| Profile | Left Rail | Center | Right | Bottom |
|---------|-----------|--------|-------|--------|
| Operator | Objectives, Tasks, Fleet | Objective Board / Fleet Grid | Objective Inspector | Health, Activity Stream |
| Executor | Agents, Tasks | Agent Execution View | Agent Inspector | Terminals, Logs |
| Reviewer | Reviews, Merges | Post-Execution Review | Review Inspector | Test Evidence, CI |
| Ops | Fleet, Deployments, Ops | Fleet Grid / Deployment Pipeline | Policy Inspector | Health, Incidents, Audit |

**Key design need**: The Electron main process must support opening multiple windows with different profiles. Each window owns its own `IHarnessService` instance connected to its selected project fabric, but different windows may point at the same underlying harness workspace and show different views.

**Exists**: VS Code already supports multi-window. The sessions layer has `electron-browser/sessions.ts` as the window entry point. Multiple windows with different view configurations would extend this.
