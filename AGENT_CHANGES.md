# Agent Changes

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
- `task.list` is kept root-only in semantics. Atlas expands each root with `task.tree` and stores that rooted lineage primitive for Phase 3, but does not derive swarms yet.
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
- Phase 3 swarm derivation
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
