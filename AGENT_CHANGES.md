# Agent Changes

## Phase 6

### What landed

- Turned the `Reviews` section in the sessions window into the first actionable review workspace inside the existing Atlas center shell.
- Kept review target identity distinct end-to-end:
  - gate rows are keyed as `dispatchId + gate`
  - merge rows are keyed as `dispatchId + merge`
  - the center shell now reflects the selected target kind correctly even when the same dispatch has both rows
- Added a sessions-only review action controller at `src/vs/sessions/contrib/atlasNavigation/browser/atlasReviewWorkspaceActions.ts` for local progress/error state.
- The actionable review workspace now shows:
  - authoritative gate state
  - authoritative merge-lane state
  - rooted swarm/task linkage
  - live agent linkage when the dispatch is currently visible in fleet state
  - read-only explanatory state when review writes are unavailable
- Shipped the truthful write subset only:
  - `Record Go` / `Record No-Go` -> `review.gate_verdict` as fixed `axiom-judge`
  - `Authorize Promotion` -> `review.authorize_promotion` as fixed `axiom-planner`
  - `Enqueue for Merge` -> `review.enqueue_merge`

### Action gating shipped

- The review workspace gates every action on `connectionState.supportedWriteMethods`, not just `writesEnabled`.
- Gate-only actions now also gate on `ReviewTargetKind.Gate`:
  - merge-selected workspaces no longer enable or dispatch `Record Go`, `Record No-Go`, or `Authorize Promotion` just because the same dispatch also has a gate
- Polling mode remains read-only.
- The browser stub remains read-only.
- A connected daemon that lacks a specific review method now leaves only that action disabled, with a deterministic reason shown in the review workspace.
- Failed review actions surface the daemon error locally in the center shell instead of silently failing.

### Tests added or updated

- `src/vs/sessions/contrib/atlasNavigation/test/node/atlasNavigationModel.test.ts`
- `src/vs/sessions/contrib/atlasNavigation/test/node/atlasReviewWorkspaceActions.test.ts`

### Verification

- `git diff --check`: passed
- `node build/checker/layersChecker.ts`: passed
- `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run compile-check-ts-native`: failed only on pre-existing unrelated noise in `src/vs/server/node/webClientServer.ts`
  - `src/vs/server/node/webClientServer.ts(17,84)` `TS6133` `builtinExtensionsPath`
  - `src/vs/server/node/webClientServer.ts(29,10)` `TS6133` `IExtensionManifest`
- Focused Phase 6 navigation/review tests:
  - `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run test-node -- --runGlob "vs/sessions/contrib/atlasNavigation/test/node/*.test.js"`: passed (`17 passing`)
  - In this isolated worktree, the stock node runner needed a temporary shared `node_modules` symlink plus a temporary local `out/` overlay composed of the main repo baseline build and a branch-local transpile of the touched atlas-navigation files. Those temporary artifacts were removed after verification.

### Intentionally unimplemented

- Any broader pre-review / inflight-review / post-review editor stack
- Any advisory review queue action surface
- Any deep inspector coupling for artifacts, worktrees, memory, transcript, or result packets
- Any role picker beyond the truthful fixed canonical roles accepted by the current daemon
- Titlebar redesign, multi-monitor work, or other later UI phases

## Phase 2 Wave D

### What landed

- Adopted the shipped harness daemon write subset in the Atlas desktop bridge instead of keeping all write methods fail-closed.
- `IHarnessConnectionInfo` now reports:
  - coarse `writesEnabled` for "some daemon writes are available"
  - exact `supportedWriteMethods` for per-method truth
- Desktop daemon mode now delegates the shipped subset end-to-end through the daemon:
  - `control.pause`
  - `control.cancel`
  - `dispatch.submit`
  - `objective.submit`
  - `review.gate_verdict`
  - `review.authorize_promotion`
  - `review.enqueue_merge`
- Polling mode and the browser stub remain read-only with `writesEnabled: false` and `supportedWriteMethods: []`.
- `submitDispatch()` now materializes a deterministic repo-local task packet under `.codex/atlas-dispatch-packets/` because the daemon truthfully accepts validated packet files, not an in-memory logical command object.

### Still intentionally unsupported

- `resumeAgent()` -> `control.resume`
- `steerAgent()` -> `control.steer`
- `pauseAll()`
- `resumeAll()`
- Any CLI subprocess write fallback
- Any direct SQLite write path
- Any public `event.emit` caller path in `IHarnessService`

### Contract notes

- Atlas `IWireDispatchCommand.task_id` is still optional at the model layer, but daemon-backed `dispatch.submit` currently requires it. The service now rejects missing `task_id` fail-closed.
- Atlas `skip_gates` exists on the logical dispatch command, but the current daemon `dispatch.submit` surface does not honor it. The service rejects `skip_gates: true` fail-closed instead of pretending it worked.
- `event.emit` is now typed in the protocol/client surface because the daemon ships it, but Atlas still has no truthful bridge caller for it in this wave.
- The daemon already exposes additional read families (`task.subscribe`, `task.unsubscribe`, `memory.get`, `memory.list`, `result.get`, `worktree.get`, `cost.get`, `agent.activity.get`, `transcript.get`) that Atlas still does not consume in this wave.

### Tests added or updated

- `src/vs/sessions/services/harness/test/node/harnessService.test.ts`
- `src/vs/sessions/services/harness/test/node/harnessTestUtils.ts`
- `src/vs/sessions/services/fleet/test/node/fleetManagementService.test.ts`
- `src/vs/sessions/contrib/atlasNavigation/test/node/atlasNavigationModel.test.ts`

### Verification

- `git diff --check`: passed
- `node build/checker/layersChecker.ts`: passed
- `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run compile-check-ts-native`: failed only on pre-existing unrelated noise in `src/vs/server/node/webClientServer.ts`
  - `src/vs/server/node/webClientServer.ts(17,84)` `TS6133` `builtinExtensionsPath`
  - `src/vs/server/node/webClientServer.ts(29,10)` `TS6133` `IExtensionManifest`
- `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run test-node -- --runGlob "vs/sessions/services/harness/test/node/*.test.js"`: passed (`31 passing`)

## Phase 5

### What landed

- Turned the `Fleet` section in the sessions window into a real read-only operator surface inside the existing Atlas center shell.
- Added a dedicated Fleet Command view-model builder in `src/vs/sessions/contrib/atlasNavigation/browser/atlasNavigationModel.ts`.
- Replaced the lightweight Fleet summary center shell with grouped live dispatch slices and an operational header strip in `src/vs/sessions/contrib/atlasNavigation/browser/atlasCenterShellViewPane.ts`.
- The shipped Fleet Command surface now shows:
  - harness connection mode/state
  - pool health mode
  - queue depth
  - running / blocked / failed agent counts
  - critical / needs-action swarm counts
  - direct review / merge pressure count
- Live agent rows are grouped into deterministic read-only slices:
  - `Needs review / merge attention`
  - `Running`
  - `Blocked`
  - `Failed`
  - `Idle / recent`

### Read-only pivots shipped

- Fleet rows now pivot through the existing sessions selection model only:
  - `Agent`
  - owning `Swarm` when Atlas can map the dispatch back to a derived swarm
  - root `Task` when no swarm mapping is available
  - `Gate` when the same dispatch has an outstanding review gate
  - `Merge` when the same dispatch is in the merge lane
- Review / merge pressure stays dispatch-scoped. Atlas does not smear a task-level review entry across unrelated live agents in the same rooted lineage.
- No pause / cancel / review / merge buttons or hidden write affordances were added.

### Tests added or updated

- `src/vs/sessions/contrib/atlasNavigation/test/node/atlasNavigationModel.test.ts`

### Verification

- `git diff --check`: passed
- `node build/checker/layersChecker.ts`: passed
- `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run compile-check-ts-native`: failed only on pre-existing unrelated noise in `src/vs/server/node/webClientServer.ts`
  - `src/vs/server/node/webClientServer.ts(17,84)` `TS6133` `builtinExtensionsPath`
  - `src/vs/server/node/webClientServer.ts(29,10)` `TS6133` `IExtensionManifest`
- Focused sessions Fleet tests:
  - `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run test-node -- --runGlob "vs/sessions/contrib/atlasNavigation/test/node/*.test.js"`: passed

### Intentionally unimplemented

- Deep inspector panes for agent internals, worktree details, transcript, memory, or result packets
- Any write/control actions from Fleet
- Titlebar redesign, review editor flows, or multi-monitor work
- Cost/activity/transcript-specific Fleet enrichments beyond the current truthful bridge state

## Phase 4

### What landed

- Replaced the old sessions-history sidebar pane with a sessions-only Atlas navigation pane that is swarm-first and read-only.
- The shipped left rail now exposes four first-class sections:
  - `Tasks`
  - `Agents`
  - `Reviews`
  - `Fleet`
- Added a real runtime `IFleetManagementService` implementation at `src/vs/sessions/services/fleet/browser/fleetManagementService.ts`.
- `IFleetManagementService` now owns:
  - `selection`
  - `selectedSection`
  - `selectedEntity`
  - `selectedEntityKind`
  - deterministic `select*` and `open*` navigation methods
- `FleetManagementService` now connects `IHarnessService` to the primary workspace root inside the sessions shell and keeps that connection scoped to the sessions window.
- Added a read-only Atlas center shell in the ChatBar so left-rail selection changes have a truthful destination even before later board/editor phases land.
- Phase 4 stayed read-only:
  - no write controls
  - no review/merge action buttons
  - no standard workbench leakage

### Selection and navigation model shipped

- Sidebar identity stays swarm-first:
  - `Tasks` renders one row per derived swarm
  - swarm identity is still `rootTaskId`
  - objective metadata decorates swarm rows but does not replace identity
- Selection is represented explicitly as `INavigationSelection`:
  - `section`
  - `entity | undefined`
- Section routing is deterministic:
  - swarm/task/objective selections route to `Tasks`
  - agent selections route to `Agents`
  - review selections route to `Reviews`
  - `Fleet` is a section-level selection without a required entity
- The left rail and center shell both read from current harness state; no fake detail panes were added when data was not available yet.

### Tests added

- `src/vs/sessions/contrib/atlasNavigation/test/node/atlasNavigationModel.test.ts`
- `src/vs/sessions/services/fleet/test/node/fleetManagementService.test.ts`

### Verification

- `git diff --check`: passed
- `node build/checker/layersChecker.ts`: passed
- `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run compile-check-ts-native`: failed only on pre-existing unrelated noise in `src/vs/server/node/webClientServer.ts`
  - `src/vs/server/node/webClientServer.ts(17,84)` `TS6133` `builtinExtensionsPath`
  - `src/vs/server/node/webClientServer.ts(29,10)` `TS6133` `IExtensionManifest`
- `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run test-node -- --runGlob "vs/sessions/**/test/node/*.test.js"`: passed (`32 passing`)
  - In this isolated worktree, the stock node test runner needed a temporary local `out/` emit of the repo before the sessions node tests could execute the Phase 4 JS from this branch.

### Intentionally unimplemented

- Dedicated swarm boards, agent views, review editors, and fleet grid detail surfaces
- Right inspector redesign
- Titlebar redesign
- All write/control plane interactions
- Any UI that depends on memory, transcript/activity, result packet, or worktree-inspection reads that Atlas still does not surface truthfully

### Follow-up hardening

- Review selection identity is now stable even when a single `dispatchId` has both a gate row and a merge row:
  - selection now carries `dispatchId + reviewTargetKind`
  - gate and merge rows no longer co-select or collapse onto the same center-shell target
- The sessions-scoped `FleetManagementService` now retries harness attachment with a bounded deterministic schedule after:
  - transient startup connection failures
  - real `IHarnessService.onDidDisconnect` events
- Explicit workspace-empty disconnects stay suppressed so the sessions shell does not loop reconnect attempts when there is no workspace to attach.

### Follow-up verification

- `git diff --check`: passed
- `node build/checker/layersChecker.ts`: passed
- `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run compile-check-ts-native`: failed only on pre-existing unrelated noise in `src/vs/server/node/webClientServer.ts`
  - `src/vs/server/node/webClientServer.ts(17,84)` `TS6133` `builtinExtensionsPath`
  - `src/vs/server/node/webClientServer.ts(29,10)` `TS6133` `IExtensionManifest`
- Focused sessions node tests:
  - `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run test-node -- --runGlob "vs/sessions/**/test/node/*.test.js"`: passed (`10 passing`)
  - In this isolated worktree, the stock node runner still needed a temporary local `out/` overlay for the touched sessions slice so the updated Phase 4 JS could execute from this branch.

## Phase 3

### What landed

- Added a pure, deterministic swarm derivation layer at `src/vs/sessions/services/harness/electron-browser/harnessSwarmDerivation.ts`.
- `HarnessService.swarms` is now populated from current bridge state instead of remaining empty/default.
- Swarm identity is root-task-first:
  - `swarmId = rootTaskId`
  - `task.list` stays root-only in semantics
  - Atlas expands each root with `task.tree` and derives one swarm per rooted lineage
- Objective linkage is attached as metadata only and fails closed on ambiguity:
  - Atlas attaches objective metadata only when exactly one objective matches `rootTaskId` and task/tree references do not conflict
  - ambiguous or conflicting objective linkage is omitted instead of guessed
- The derived swarm contract now carries the minimum truthful Phase 3 summaries Atlas needs for later UI work:
  - `objectiveStatus`
  - `objectiveProblemStatement`
  - `rootTaskStatus`
  - `mergeDispatchIds`
  - `reviewNeeded`
  - `mergeBlocked`
  - `hasFailures`
  - `hasBlockedTasks`
- `HarnessService.getSwarm()` now resolves from the derived swarm cache rather than pretending the daemon has a swarm authority.

### Derivation rules shipped

- One swarm per rooted task tree.
- Tasks belong to a swarm iff they are in that rooted lineage.
- Agents belong to a swarm iff their `taskId` belongs to that rooted lineage.
- Review gates and merge entries belong to a swarm iff their `taskId` belongs to that rooted lineage.
- Objective metadata attaches iff there is a unique non-conflicting objective for `rootTaskId`.
- Swarm phase is derived deterministically:
  - `failed` if any task failed/cancelled or any merge is blocked
  - `reviewing` if any review gate awaits review / is review-blocked, any task is reviewing, or the attached objective is reviewing
  - `merging` if merge entries are pending or merge-started
  - `completed` if all known leaf work is complete and no incomplete tasks remain
  - `planning` if all known tasks are queued
  - otherwise `executing`
- Swarm attention is derived deterministically:
  - start from the highest child attention across tasks, agents, review gates, and merge entries
  - raise to `critical` for task/objective failure or merge-blocked state
  - raise to `needsAction` for review-needed, blocked tasks/agents, or degraded pool health
  - return `completed` only when the swarm is completed and no higher attention applies
  - otherwise keep an `active` floor for running agents, queued/executing tasks, or merges in flight, then fall back to `idle`

### Tests added or updated

- `src/vs/sessions/services/harness/test/node/harnessSwarmDerivation.test.ts`
- `src/vs/sessions/services/harness/test/node/harnessService.test.ts`

### Daemon methods consumed

- No new daemon methods beyond Phase 2 Wave C
- Swarm derivation consumes already-cached results from:
  - `initialize`
  - `daemon.ping`
  - `fleet.snapshot`, `fleet.subscribe`, `fleet.unsubscribe`
  - `health.get`, `health.subscribe`, `health.unsubscribe`
  - `objective.list`, `objective.get`, `objective.subscribe`, `objective.unsubscribe`
  - `review.list`, `review.get`, `review.subscribe`, `review.unsubscribe`
  - `merge.list`, `merge.get`, `merge.subscribe`, `merge.unsubscribe`
  - `task.get`, `task.list`, `task.tree`

### Intentionally unimplemented

- Phase 4+ UI surfaces beyond the Phase 3 service/model layer (review panes, inspector, titlebar)
- `IFleetManagementService` runtime implementation and selection/navigation wiring
- Cost/activity/transcript adoption
- Memory, result packet, and worktree inspection reads
- All write/control families remain fail-closed and `writesEnabled` remains `false`

### Verification

- `git diff --check`: passed
- `node build/checker/layersChecker.ts`: passed
- `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run compile-check-ts-native`: failed only on pre-existing unrelated noise in `src/vs/server/node/webClientServer.ts`
  - `src/vs/server/node/webClientServer.ts(17,84)` `TS6133` `builtinExtensionsPath`
  - `src/vs/server/node/webClientServer.ts(29,10)` `TS6133` `IExtensionManifest`
- Focused harness tests:
- `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run test-node -- --runGlob "vs/sessions/services/harness/test/node/*.test.js"`: passed (`26 passing`)
  - In this isolated worktree, the stock node test runner needed a temporary local `out/` overlay backed by the main repo’s compiled `out/` plus a narrow TypeScript transpile of `src/vs/sessions/common/model/**` and `src/vs/sessions/services/harness/**` so the harness tests executed real JS instead of an empty glob

### Atlas vs daemon contract mismatches

- The daemon still does not expose a first-class swarm authority. Atlas correctly derives swarms from rooted task lineage instead of asking the daemon for swarm objects.
- The daemon still exposes no public `task.subscribe`, so rooted lineage refresh remains best-effort from adjacent daemon activity and explicit reads.
- Current bridge state still lacks truthful memory/activity/artifact/worktree semantics for swarm lanes, so Phase 3 keeps those out of the derivation instead of inventing them.

## Phase 2 Wave C

### What landed

- Expanded the desktop harness bridge to consume the current daemon read surface instead of the older fleet-only bridge contract.
- `HarnessDaemonClient` now requires `initialize.fabric_identity`, surfaces it to the desktop service, and forwards the new public notification families: `health.update`, `objective.update`, `review.update`, and `merge.update`.
- `HarnessService` now validates daemon/workspace affinity against `fabric_identity.repo_root` and fails closed on cross-project mismatch instead of silently attaching Atlas to the wrong harness fabric.
- Daemon mode now populates:
  - fleet from `fleet.snapshot` / `fleet.delta`
  - health from `health.get` / `health.update`
  - objectives from `objective.list` / `objective.get` / `objective.update`
  - review gates from `review.list` / `review.get` / `review.update`
  - merge queue from `merge.list` / `merge.get` / `merge.update`
  - rooted task lineage from `task.list`, `task.tree`, and `task.get`
- `task.list` is kept root-only in semantics. Atlas expands each root with `task.tree` and stores that rooted lineage primitive; Phase 3 now derives swarms from it.
- Polling fallback stays narrow and read-only. It still surfaces only fleet and derived health from SQLite; there is no polling mirror for objectives, reviews, merge state, or rooted task lineage.
- Added focused Wave C node tests for fabric-identity validation, new daemon read families, notification handling, and rooted task mapping.

### Tests added or updated

- `src/vs/sessions/services/harness/test/node/harnessTestUtils.ts`
- `src/vs/sessions/services/harness/test/node/harnessDaemonClient.test.ts`
- `src/vs/sessions/services/harness/test/node/harnessService.test.ts`
- `src/vs/sessions/services/harness/test/node/harnessMapper.test.ts`

### Daemon methods consumed

- `initialize`
- `shutdown`
- `daemon.ping`
- `fleet.snapshot`
- `fleet.subscribe`
- `fleet.unsubscribe`
- `health.get`
- `health.subscribe`
- `health.unsubscribe`
- `objective.list`
- `objective.get`
- `objective.subscribe`
- `objective.unsubscribe`
- `review.list`
- `review.get`
- `review.subscribe`
- `review.unsubscribe`
- `merge.list`
- `merge.get`
- `merge.subscribe`
- `merge.unsubscribe`
- `task.get`
- `task.list`
- `task.tree`

### Intentionally unimplemented

- All write/control families remain fail-closed and `writesEnabled` remains `false`
- Any CLI subprocess write path
- Any direct SQLite write path
- Dedicated swarm derivation beyond the current Phase 3 model/service layer
- Advisory review queue derivation
- Transcript / activity streaming
- Memory inspection
- Result packet / worktree inspection
- Public daemon subscription for task lineage; the daemon still has no `task.subscribe`, so Atlas refreshes rooted task state best-effort from adjacent daemon activity

### Verification

- `git diff --check`: passed
- `node build/checker/layersChecker.ts`: passed
- `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run compile-check-ts-native`: failed only on pre-existing unrelated noise in `src/vs/server/node/webClientServer.ts`
  - `src/vs/server/node/webClientServer.ts(17,84)` `TS6133` `builtinExtensionsPath`
  - `src/vs/server/node/webClientServer.ts(29,10)` `TS6133` `IExtensionManifest`
- Focused harness tests:
  - `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run test-node -- --runGlob "vs/sessions/services/harness/test/node/*.test.js"`: passed (`20 passing`)
  - In this isolated worktree, the repo’s stock `test-node` runner needed a temporary narrow TypeScript emit of the harness slice into `out/` before running, because the worktree did not ship with compiled `out/` artifacts

### Atlas vs daemon contract mismatches

- The daemon now exposes richer read families than the older Atlas Wave A / Wave B docs assumed; Wave C closes that bridge gap for health, objectives, review gates, merge queue, and rooted task lineage.
- The daemon still exposes no public write/control families, so daemon mode remains read-only and `writesEnabled` stays `false`.
- The daemon already exposes `cost.get`, `agent.activity.get`, and `transcript.get`, but Wave C intentionally leaves cost/activity/transcript surfaces empty/default rather than partially mapping them without the next wave’s contract review.
- The daemon exposes no public `task.subscribe`, so Atlas cannot maintain task lineage via a first-class push stream yet.
- The current Phase 0b task presentation contract still expects fields that `task.*` daemon payloads do not always expose directly (`summary`, `acceptance`, `constraints`, `artifacts`, `memoryKeywords`, `contextPaths`, `dependsOn`, and sometimes dispatch-derived priority/role metadata). The bridge fills those with deterministic empty/default values rather than inventing semantics.

## Phase 2 Hardening

### What landed

- Added focused node-side bridge coverage for `HarnessDaemonClient`, `HarnessService`, and `harnessMapper` without broadening the daemon data plane beyond the shipped Wave B surface.
- Proved daemon-first, fail-closed behavior:
  - `HarnessDaemonClient` now has regressions for initialize + `daemon.ping`, required-method validation, protocol/schema mismatch, invalid ping payloads, and unavailable-vs-protocol error classification.
  - `HarnessService` now has regressions for daemon-mode selection, polling fallback only on unavailable-class failures, non-degrading auth/protocol failures, read-only `writesEnabled` in both daemon and polling modes, and deterministic fail-closed write errors.
  - `harnessMapper` now has regressions for fleet snapshot shaping, fleet delta application, and fail-closed handling of unknown/degraded raw health.
- Fixed a real production lifecycle leak in `electron-browser/harnessService.ts` by tracking per-connection daemon client/listener/poller disposables in a connection-scoped `DisposableStore` and clearing them during teardown.
- Tightened the mock fleet snapshot helper typing so partial `snapshot` overrides stay aligned with the daemon payload contract.

### Tests added

- `src/vs/sessions/services/harness/test/node/harnessTestUtils.ts`
- `src/vs/sessions/services/harness/test/node/harnessDaemonClient.test.ts`
- `src/vs/sessions/services/harness/test/node/harnessService.test.ts`
- `src/vs/sessions/services/harness/test/node/harnessMapper.test.ts`

### Daemon methods covered

- `initialize`
- `shutdown`
- `daemon.ping`
- `fleet.snapshot`
- `fleet.subscribe`
- `fleet.unsubscribe`

### Intentionally unimplemented

- Public daemon read families for `health`, `cost`, `objective`, `task`, `review`, `merge`, `agent.activity`, transcript, memory, and worktree inspection
- All write/control families remain fail-closed and `writesEnabled` remains `false`
- Any CLI subprocess write path
- Any direct SQLite write path
- Browser-side desktop emulation
- Focused `HarnessSqlitePoller` execution coverage; a deterministic native-SQLite fixture path would add more harness than signal in this lane

### Verification

- `git diff --check`: passed
- `node build/checker/layersChecker.ts`: passed
- `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run compile-check-ts-native`: failed only on pre-existing unrelated noise in `src/vs/server/node/webClientServer.ts`
  - `src/vs/server/node/webClientServer.ts(17,84)` `TS6133` `builtinExtensionsPath`
  - `src/vs/server/node/webClientServer.ts(29,10)` `TS6133` `IExtensionManifest`
- Focused harness tests:
  - `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run test-node -- --runGlob "vs/sessions/services/harness/test/node/*.test.js"`: passed (`16 passing`)
  - In this isolated worktree, the repo’s stock `transpile-client` path was blocked because `esbuild` was unavailable in the shared dependency tree, so the test run used a local TypeScript `transpileModule` emit of the harness slice into `out/` instead of changing production code or broadening build plumbing

### Atlas vs daemon contract mismatches

- Atlas hardening stayed intentionally narrow around the shipped bridge surface even though the current daemon now exposes additional public read families: `health.*`, `objective.*`, `review.*`, `merge.*`, and `task.get`.
- The remaining meaningful Atlas coverage gap is now bridge adoption, not daemon availability: until Atlas expands beyond fleet, those newer daemon-backed observables should stay empty/default and writes should remain fail closed.

## Phase 2 Wave B

### What landed

- Tightened the desktop harness bridge around the actual public daemon surface on the inspected harness branch.
- `HarnessDaemonClient` now requires and consumes `daemon.ping` during connect, alongside `initialize`, and fails closed on invalid ping payloads or schema drift.
- `harnessProtocol.ts` now centralizes the required public daemon methods and documents the hard edge that future topics mentioned in `streams.rs` are not public subscribe surfaces yet.
- Atlas docs were aligned so they no longer imply that Wave B gained public `health`, `cost`, `objective`, `task`, `review`, `merge`, or `activity/transcript` daemon families on this harness branch.

### Daemon methods consumed

- `initialize`
- `shutdown`
- `daemon.ping`
- `fleet.snapshot`
- `fleet.subscribe`
- `fleet.unsubscribe`

### Intentionally unimplemented

- Public daemon read families for `health`, `cost`, `objective`, `task`, `review`, `merge`, `agent.activity`, transcript, memory, and worktree inspection
- All write/control families
- Any CLI subprocess write path
- Any direct SQLite write path
- Any browser-side desktop emulation

### Verification

- `git diff --check`: passed
- `node build/checker/layersChecker.ts`: passed
- `env PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run compile-check-ts-native`: failed only on pre-existing unrelated noise in `src/vs/server/node/webClientServer.ts`
  - `src/vs/server/node/webClientServer.ts(17,84)` `TS6133` `builtinExtensionsPath`
  - `src/vs/server/node/webClientServer.ts(29,10)` `TS6133` `IExtensionManifest`

### Atlas vs daemon contract mismatches

- The current harness daemon branch now exposes `initialize`, `shutdown`, `daemon.ping`, `fleet.snapshot`, `fleet.subscribe`, `fleet.unsubscribe`, `health.get`, `health.subscribe`, `health.unsubscribe`, `objective.list`, `objective.get`, `objective.subscribe`, `objective.unsubscribe`, `review.list`, `review.get`, `review.subscribe`, `review.unsubscribe`, `merge.list`, `merge.get`, `merge.subscribe`, `merge.unsubscribe`, and `task.get` as public JSON-RPC methods.
- Wave B in Atlas intentionally did not adopt those newer read families yet; it stayed limited to the fleet bridge surface plus handshake/ping tightening.
- Atlas docs had older bridge wording that implied CLI/JSONL fallback behavior or broader observable population than the current merged daemon branch actually supports. The touched docs were aligned in this wave.
