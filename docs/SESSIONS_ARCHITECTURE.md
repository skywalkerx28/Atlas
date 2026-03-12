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
| Session list in sidebar | Unified Atlas left rail with `Tasks` / `Agents` / `Reviews` / `Fleet`, backed by swarms |
| Chat as primary interaction | Swarm board as the primary execution surface |
| File changes for one session | File changes scoped to any swarm or agent |
| Session picker in titlebar | Atlas sessions header with project/fabric identity, section breadcrumbs, quick pivots, and live status |

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

**Current sidebar** (sessions list) → **Atlas left rail** (`Tasks`, `Agents`, `Reviews`, `Fleet`, with swarms/objectives decorating `Tasks`)
**Current chat bar** (single agent chat) → **Atlas center stage** (objective board, swarm board, agent view, fleet grid, diff view, etc.)
**Current auxiliary bar** (changes view) → **Atlas right inspector** (context for selected entity)
**Current panel** (hidden) → **Atlas bottom ops strip** (terminals, logs, health)
**Current titlebar** (session picker) → **Atlas sessions header** (project/fabric identity, current section context, quick pivots, live status)

---

## Extension Plan

### Phase 1: State Model & Harness Bridge

**New service**: `IHarnessService` in `sessions/services/harness/`

This is the foundation. It connects to the harness daemon (or falls back to polling) and exposes harness state as observables that every view consumes.

**New module**: `sessions/common/model/`

TypeScript interfaces for the Atlas first-class nouns, mapping from harness wire types to Atlas presentation types.

**Layering note**: The harness bridge is **desktop-only** (Phase 1). It requires either a Unix socket connection (daemon mode) or native file system access (read-only SQLite polling fallback). The `browser/` layer gets a stub implementation that returns "not connected." Web support comes later via the daemon's optional WebSocket bridge.

Current merged scope note: the bridge still does not populate every `IHarnessService` observable, but it is no longer fleet-only. On the current harness daemon branch, Atlas now populates fleet, health, objectives, review gates, merge queue, rooted task lineage, and derived swarms from the public JSON-RPC surface, and Phase 8 adds on-demand inspector reads for worktrees, result packets, artifacts, memory, dispatch activity, transcripts, and review provenance. Advisory review queue and global cost adoption remain intentionally sparse until later bridge waves.

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

**Replace** the single sessions-history view in the sidebar with one unified Atlas navigation pane, then add a read-only center shell in the ChatBar:

```
sessions/contrib/
├── atlasNavigation/browser/
│   ├── atlasNavigationModel.ts
│   ├── atlasNavigationViewPane.ts
│   ├── atlasCenterShellViewPane.ts
│   └── atlasCenterShell.contribution.ts
sessions/services/fleet/browser/
└── fleetManagementService.ts
```

This shipped Phase 4 wave is intentionally narrower than the broader long-term vision. It exposes first-class `Tasks`, `Agents`, `Reviews`, and `Fleet` sections inside one Atlas pane instead of registering a large matrix of separate sidebar containers up front.

**Keep existing**: `sessions/` (rename to session management internals), `changes/` (extend for agent-scoped diffs), `git/`, `github/`, `codeReview/`, `terminal/`, `files/`, `fileTreeView/`

**Update titlebar/header**: Replace the generic sessions picker/chrome with an Atlas-specific sessions header that surfaces project/fabric identity, current section/selection breadcrumbs, quick pivots, and live read-only status.

### Phase 5: Fleet Command

The shipped Fleet Command wave lives inside the existing Atlas navigation center shell, not as a separate workbench contribution. It is a sessions-only, read-only operator surface backed directly by `IHarnessService` and the Phase 3 swarm state.

- Header strip surfaces:
  - connection mode/state
  - pool health mode
  - queue depth
  - running / blocked / failed agent counts
  - critical / needs-action swarm counts
  - live review / merge pressure count
- Live dispatches are grouped into deterministic slices:
  - `Needs review / merge attention`
  - `Running`
  - `Blocked`
  - `Failed`
  - `Idle / recent`
- Each row pivots through `IFleetManagementService` into the existing `Agent`, `Tasks`, or `Reviews` sections.
- No write controls, context menus, or deep inspector panes ship in this wave.

### Phase 6: Review Workspace

The shipped review wave stays inside the existing `sessions/contrib/atlasNavigation/` surface. Atlas does not add a separate `reviewService.ts` or dedicated pre/inflight/post review editor contribution yet.

What ships now:

- the `Reviews` left-rail section remains keyed by authoritative review-gate and merge-lane entries
- gate and merge targets for the same dispatch stay distinct via `dispatchId + reviewTargetKind`
- the center shell renders a focused actionable review workspace:
  - target summary
  - authoritative gate/merge state
  - swarm/task/agent pivots
  - local progress/error feedback
  - action bar gated by `connectionState.supportedWriteMethods`

Shipped review actions:

- `review.gate_verdict` via fixed `axiom-judge`
- `review.authorize_promotion` via fixed `axiom-planner`
- `review.enqueue_merge`

Polling mode and the browser stub remain read-only, and deeper review editors remain later work.

### Future Center Stage Modes

The Phase 4/5 shipped center shell is intentionally narrower than the longer-term product roadmap:

- `Tasks` now renders a dedicated swarm-rooted read-only workspace from current harness + Phase 3 swarm state
- `Agents` now renders a dedicated read-only execution workspace from current fleet / task / review state
- `Reviews` renders the dedicated actionable authoritative review / merge workspace
- `Fleet` renders the dedicated Fleet Command operator surface described above

The broader center-stage boards remain later work:

- **Objective Board**
- **Swarm Board**
- **Agent Execution View**
- **Diff View**
- **Code View** (already exists as a separate editor/modal surface)

### Phase 10A: Sessions Layout Profiles

The shipped Phase 10A wave does not introduce multi-window orchestration yet. It adds sessions-local layout profiles that reshape the existing Atlas shell for different working modes while preserving the same selection and harness state.

Shipped profiles:

- `Operator`
- `Execution`
- `Review`
- `Fleet`

What changes per profile:

- the Atlas header remains visible
- the left rail remains available through the existing sessions shell
- center-stage and inspector proportions rebalance via sessions-local CSS/layout composition
- no workbench-global layout/profile plumbing is introduced

Persistence:

- stored per workspace under `atlas.layoutProfile`
- selection survives profile changes unchanged
- `ReviewTargetKind` stays distinct across profile switches

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
    readonly selection: IObservable<INavigationSelection>;
    readonly layoutProfile: IObservable<AtlasLayoutProfile>;
    readonly selectedSection: IObservable<NavigationSection>;
    readonly selectedEntity: IObservable<ISelectedEntity | undefined>;
    readonly selectedEntityKind: IObservable<EntityKind | undefined>;

    selectLayoutProfile(profile: AtlasLayoutProfile): void;
    selectSection(section: NavigationSection): void;
    selectEntity(entity: ISelectedEntity | undefined): void;
    selectAgent(dispatchId: string): void;
    selectTask(taskId: string): void;
    selectObjective(objectiveId: string): void;
    selectSwarm(swarmId: string): void;
    selectReview(dispatchId: string, targetKind?: ReviewTargetKind): void;
    clearSelection(): void;

    openSwarmBoard(swarmId: string): Promise<void>;
    openObjectiveBoard(objectiveId: string): Promise<void>;
    openAgentView(dispatchId: string): Promise<void>;
    openFleetGrid(): Promise<void>;
    openReview(dispatchId: string, targetKind?: ReviewTargetKind): Promise<void>;
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
