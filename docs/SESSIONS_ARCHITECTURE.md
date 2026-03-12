# Atlas Sessions Layer — Architecture & Extension Plan

> How the existing `src/vs/sessions/` layer becomes the foundation for Atlas's factory control plane.

The key architectural shift is this: the sessions layer should no longer optimize for one active chat session. It should become the shell for one project-level harness fabric supervising many concurrent objective/task swarms.

---

## What Exists Today

The sessions layer is a **177-file workbench** sitting above `vs/workbench` in the layering hierarchy. It provides a fixed-layout, chat-first shell optimized for agent session workflows.

### Current Shell

```
┌──────────────┬──────────────────────────────────────────┐
│              │              Titlebar                      │
│   Sidebar    ├─────────────────────────┬─────────────────┤
│              │        Chat Bar         │  Auxiliary Bar   │
│  Sessions    │                         │  (Changes View)  │
│  list        │  Chat / New Session     │  File diffs      │
│              ├─────────────────────────┴─────────────────┤
│              │              Panel (hidden)                │
└──────────────┴──────────────────────────────────────────┘
```

### Current Views

| Location | Container | View | Purpose |
|----------|-----------|------|---------|
| Sidebar | `agentic.workbench.view.sessionsContainer` | `AgenticSessionsViewPane` | Session list (grouped by date/repository) |
| ChatBar | `workbench.panel.chat` (re-registered) | `ChatViewPane` / `NewChatViewPane` | Active chat or new session creation |
| AuxiliaryBar | `workbench.view.agentSessions.changesContainer` | `ChangesViewPane` | File changes/diffs for active session |

### Current Services (Sessions-Specific)

| Service | Interface | Implementation | Purpose |
|---------|-----------|----------------|---------|
| Sessions Management | `ISessionsManagementService` | `SessionsManagementService` | Session lifecycle, active session tracking |
| Active Session | `IActiveSessionService` | `ActiveSessionService` | Observable active session state |
| Code Review | `ICodeReviewService` | `CodeReviewService` | PR review, CI status |
| Prompts | `IPromptsService` | `AgenticPromptsService` | Session-scoped prompt discovery |
| Configuration | `ISessionsConfigurationService` | `SessionsConfigurationService` | Session-specific settings |
| AI Customization | `IAICustomizationWorkspaceService` | `SessionsAICustomizationWorkspaceService` | Per-window customization behavior |

### Current Service Overrides (from vs/workbench)

| Original | Override | What Changes |
|----------|----------|-------------|
| `IPaneCompositePartService` | `AgenticPaneCompositePartService` | Sessions-specific parts: SidebarPart, ChatBarPart, AuxiliaryBarPart, PanelPart |
| `ITitleService` | Sessions `TitleService` | Three-section titlebar: left/center/right with session picker |
| `IWorkbenchLayoutService` | `Workbench` class | Fixed layout, no activity bar, no status bar, modal editor |
| `IWorkspaceContextService` | `SessionsWorkspaceContextService` | Dynamic workspace folders based on active session |
| `IWorkbenchConfigurationService` | Sessions `ConfigurationService` | Simplified (no workspace-level config) |

### Current Contributions (17 modules)

```
sessions/contrib/
├── accountMenu/              Account widget in sidebar footer
├── agentFeedback/            Editor overlays, hover widgets, review comments
├── aiCustomizationTreeView/  AI customization tree in sidebar
├── applyCommitsToParentRepo/ Push session commits to parent repo
├── changes/                  ChangesViewPane (file diffs in auxiliary bar)
├── chat/                     Chat actions, run script, prompts service
├── codeReview/               Code review service, toolbar
├── configuration/            Default settings for sessions
├── files/                    File-related actions
├── fileTreeView/             File tree view
├── git/                      Git sync for session worktree
├── github/                   GitHub API client, PR/CI integration
├── logs/                     Log file actions
├── sessions/                 Sessions view, title bar widget, active session service
├── terminal/                 Terminal actions
├── welcome/                  Sign-in overlay
└── workspace/                Dynamic workspace folder management
```

---

## What Needs to Change

The current sessions layer is organized around **one active session** at a time. Atlas needs to be organized around **one project harness fabric** supervising **many concurrent objective/task swarms** simultaneously.

### Paradigm Shift

| Current | Atlas |
|---------|-------|
| One active session | One project harness fabric with many concurrent swarms |
| Session list in sidebar | Objectives/Swarms/Tasks/Agents/Reviews/Fleet in sidebar |
| Chat as primary interaction | Swarm board as the primary execution surface |
| File changes for one session | File changes scoped to any swarm or agent |
| Session picker in titlebar | Project/objective/swarm selector + fleet status |

### First-Class Unit

The first-class execution unit in Atlas is the **task swarm**.

A swarm is not a brand-new backend object that replaces the harness. It is the UI and service-layer assembly of existing harness primitives around one root objective or root task:

- descendant task DAG
- planner and worker agent graph
- governed memory lane
- worktrees and artifacts
- review lane
- merge/promotion state
- activity stream

`Session` should survive only as an implementation detail for transcript rendering and compatibility during the refactor. It should not remain the conceptual noun that new work is organized around.

### Shell Transformation

**Current sidebar** (sessions list) → **Atlas left rail** (Objectives, Swarms, Tasks, Agents, Reviews, Fleet, etc.)
**Current chat bar** (single agent chat) → **Atlas center stage** (objective board, swarm board, agent view, fleet grid, diff view, etc.)
**Current auxiliary bar** (changes view) → **Atlas right inspector** (context for selected entity)
**Current panel** (hidden) → **Atlas bottom ops strip** (terminals, logs, health)
**Current titlebar** (session picker) → **Atlas titlebar** (project/objective/swarm selector, fleet status, global controls)

---

## Extension Plan

### Phase 1: State Model & Harness Bridge

**New service**: `IHarnessService` in `sessions/services/harness/`

This is the foundation. It connects to the harness daemon (or falls back to polling) and exposes harness state as observables that every view consumes.

**New module**: `sessions/common/model/`

TypeScript interfaces for the Atlas first-class nouns, mapping from harness wire types to Atlas presentation types.

**Layering note**: The harness bridge is **desktop-only** (Phase 1). It requires either a Unix socket connection (daemon mode) or native file system access (read-only SQLite polling fallback). The `browser/` layer gets a stub implementation that returns "not connected." Web support comes later via the daemon's optional WebSocket bridge.

Current merged scope note: the bridge still does not populate every `IHarnessService` observable, but it is no longer fleet-only. On the current harness daemon branch, Atlas now populates fleet, health, objectives, review gates, merge queue, rooted task lineage, and derived swarms from the public JSON-RPC surface, while leaving advisory review queue, transcripts, memory, result packets, and worktree inspection empty/default until those daemon families land.

```
sessions/services/harness/
├── common/
│   ├── harnessService.ts          IHarnessService interface
│   ├── harnessTypes.ts            Wire format types (TaskPacket, ResultPacket, etc.)
│   └── harnessProtocol.ts         JSON-RPC 2.0 message types for daemon protocol
├── electron-browser/
│   ├── harnessService.ts          Desktop implementation (daemon client + read-only SQLite fallback)
│   ├── harnessDaemonClient.ts     Unix socket JSON-RPC client
│   └── harnessSqlitePoller.ts     Read-only SQLite polling fallback
└── browser/
    └── harnessService.ts          Stub: returns disconnected state (web not yet supported)

sessions/common/model/
├── objective.ts                   IObjectiveState, IObjectiveBoard
├── swarm.ts                       ISwarmState, ISwarmBoard, ISwarmLane
├── task.ts                        ITaskState, ITaskQueue
├── agent.ts                       IAgentState, IFleetState
├── worktree.ts                    IWorktreeState
├── run.ts                         IRunState, ITranscriptEntry
├── artifact.ts                    IArtifactRef
├── review.ts                      IReviewState, IReviewQueue
├── policy.ts                      IPolicyState
├── mergeLane.ts                   IMergeEntry, IMergeQueue
├── cost.ts                        ICostState, ICostBreakdown
├── health.ts                      IHealthState
└── attention.ts                   IAttentionFlag, attention model
```

The desktop implementation auto-detects the daemon:

```typescript
// electron-browser/harnessService.ts (simplified)
class HarnessService implements IHarnessService {
    async connect(workspaceRoot: URI): Promise<void> {
        const socketPath = env.get('AXIOM_HARNESS_SOCK') || '~/.codex/harness.sock';
        try {
            this.transport = await HarnessDaemonClient.connect(socketPath);
            this.mode = 'daemon';
        } catch {
            const dbPath = resolveRouterDbPath(); // follows harness resolution chain
            this.transport = new HarnessSqlitePoller(dbPath);
            this.mode = 'polling';
        }
    }
}
```

The important product constraint is that `IHarnessService` represents **one project fabric**, not one task. Swarms are derived inside that fabric and exposed as first-class observables for the UI.

### Phase 2: Left Rail Navigation

**Replace** the single sessions container in the sidebar with multiple view containers:

```
sessions/contrib/
├── swarmsView/browser/            Swarm boards and grouped execution lanes
│   ├── swarmsView.contribution.ts
│   └── swarmsViewPane.ts
├── tasksView/browser/             Tasks pipeline (queued/executing/reviewing/done)
│   ├── tasksView.contribution.ts
│   └── tasksViewPane.ts
├── agentsView/browser/            Fleet agent list with live status
│   ├── agentsView.contribution.ts
│   └── agentsViewPane.ts
├── reviewsView/browser/           Pending review queue with batch actions
│   ├── reviewsView.contribution.ts
│   └── reviewsViewPane.ts
├── artifactsView/browser/         Artifact browser
│   ├── artifactsView.contribution.ts
│   └── artifactsViewPane.ts
├── fleetView/browser/             Fleet overview (capacity, health, cost)
│   ├── fleetView.contribution.ts
│   └── fleetViewPane.ts
├── objectivesView/browser/        Objectives list
│   ├── objectivesView.contribution.ts
│   └── objectivesViewPane.ts
├── mergesView/browser/            Merge queue
│   ├── mergesView.contribution.ts
│   └── mergesViewPane.ts
└── deploymentsView/browser/       Deployment pipelines
    ├── deploymentsView.contribution.ts
    └── deploymentsViewPane.ts
```

**Keep existing**: `sessions/` (rename to session management internals), `changes/` (extend for agent-scoped diffs), `git/`, `github/`, `codeReview/`, `terminal/`, `files/`, `fileTreeView/`

**Update titlebar**: Replace session picker with project/objective/swarm selector + fleet status badge + global controls (pause all, cost indicator).

### Phase 3: Fleet Command

**New contribution**: `sessions/contrib/fleetCommand/browser/`

The primary awareness surface. Can render in both sidebar (compact) and center stage (full).

- Reads `IHarnessService.agents` observable
- Implements attention model: sorts agents by needs-attention priority
- Idle detection: agents with no heartbeat update > threshold
- Blocked detection: agents in `blocked` state or stuck in loops
- Cost burn: rate-of-spend indicators per agent and aggregate

### Phase 4: Review Surfaces

**New contribution**: `sessions/contrib/review/`

```
sessions/contrib/review/
├── common/
│   └── reviewService.ts           IAtlasReviewService (coordinates all review phases)
├── browser/
│   ├── review.contribution.ts
│   ├── preReview/                 Task spec, plan preview, risk, policy
│   ├── inflightReview/            Live transcript, steering, cost
│   └── postReview/                Diff, verdict, spec compliance, batch workflow
```

The existing `changesView` and `codeReview` contributions provide a foundation for the diff and review toolbar.

### Phase 5: Center Stage Modes

Extend the center area beyond chat to support multiple modes:

- **Objective Board**: DAG visualization of an objective's decomposition tree
- **Swarm Board**: The default execution board for one root objective/task and its active agents, memory lane, worktrees, artifacts, and reviews
- **Agent Execution View**: Extends the existing chat widget to show transcript + tool calls + diffs + cost for any agent (not just the active session)
- **Fleet Grid**: New widget in `sessions/browser/widget/fleetGrid/` — tmux-style card grid of live agents
- **Diff View**: Extends existing changes view to be agent-scoped and linkable to task/review
- **Code View**: Already exists as modal editor

### Phase 6: Right Inspector

Extend the auxiliary bar to show context for whatever entity is selected:

- Agent detail (role, cost, reasoning, files, policy)
- Task detail (spec, criteria, dependencies, assigned agent)
- Worktree detail (branch, commits, diff summary)
- Review detail (verdict history, approval chain)

The existing auxiliary bar infrastructure (`AuxiliaryBarPart` with card appearance) supports this. Add multiple view containers that activate based on selection context.

---

## Existing Code to Reuse

| Existing Component | Reuse For |
|-------------------|-----------|
| `ISessionsManagementService` / `ActiveSessionService` | Transitional compatibility layer while session-first state is carved into swarm/task/agent state |
| `AgenticSessionsViewPane` | Agents View (similar list pattern with filters/grouping) |
| `ChangesViewPane` | Post-Execution Review (diff view foundation) |
| `ChatViewPane` | Agent Execution View (transcript rendering) |
| `NewChatViewPane` | Objective intake (model picker, mode picker patterns) |
| `SessionsTitleBarWidget` | Fleet status widget in titlebar |
| `AgentSessionsControl` | Agent list rendering in Fleet Command |
| `SidebarPart` with footer | Left rail with action shortcuts |
| `AuxiliaryBarPart` with card appearance | Right inspector panels |
| `PanelPart` | Bottom ops strip |
| `MenuWorkbenchButtonBar` (from changes footer) | Review action bars |
| `CIStatusWidget` | Deployment Control CI integration |
| Code Review service | Post-Execution Review judge verdicts |
| GitHub integration | Merge Control PR queue |
| Git sync contribution | Agent worktree sync monitoring |
| Agent feedback module | In-Flight Review comment/annotation system |

---

## Sessions Data Model Evolution

### Current: Single Active Session

```typescript
interface IActiveSessionItem {
    resource: URI;
    isUntitled: boolean;
    label: string | undefined;
    repository: URI | undefined;
    worktree: URI | undefined;
    worktreeBranchName: string | undefined;
    providerType: string;
}
```

### Atlas: Fleet of Agents on Multiple Objectives

```typescript
// The active session concept becomes "selected entity"
interface ISelectedEntity {
    kind: 'agent' | 'task' | 'objective' | 'review' | 'worktree' | 'artifact';
    id: string;
}

// Session management becomes fleet management
interface IFleetManagementService {
    readonly selectedEntity: IObservable<ISelectedEntity | undefined>;
    readonly fleet: IObservable<IFleetState>;

    selectAgent(dispatchId: string): void;
    selectTask(taskId: string): void;
    selectObjective(objectiveId: string): void;
    selectReview(dispatchId: string): void;
}
```

The `ISessionsManagementService` can evolve into `IFleetManagementService` — the concept is the same (managing what's active/selected), just broader in scope.

---

## Registration Pattern

All new views follow the existing sessions contribution pattern:

```typescript
// In sessions.desktop.main.ts and sessions.common.main.ts
import 'vs/sessions/contrib/agentsView/browser/agentsView.contribution.js';
import 'vs/sessions/contrib/tasksView/browser/tasksView.contribution.js';
import 'vs/sessions/contrib/reviewsView/browser/reviewsView.contribution.js';
// ...

// In each contribution file
Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersModel)
    .registerViewContainer({
        id: AGENTS_VIEW_CONTAINER_ID,
        title: nls.localize2('agentsView', "Agents"),
        ctorDescriptor: new SyncDescriptor(ViewPaneContainer),
        icon: agentsViewIcon,
        order: 2,
        windowVisibility: WindowVisibility.Sessions,
    }, ViewContainerLocation.Sidebar, { isDefault: false });
```

Each view uses `WindowVisibility.Sessions` to ensure it only appears in the sessions window, not the standard workbench.
