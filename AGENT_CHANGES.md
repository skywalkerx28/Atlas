# Agent Changes

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

- None new in this hardening pass beyond the already-documented Wave B constraint: the current daemon still exposes only fleet plus handshake/ping methods as public JSON-RPC surface.
- The remaining meaningful coverage gap is blocked on Agent 2 Phase `1b` shipping richer public daemon read families; until those methods exist, Atlas should keep those observables empty/default and fail closed on writes.

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

- The current harness daemon branch still exposes only `initialize`, `shutdown`, `daemon.ping`, `fleet.snapshot`, `fleet.subscribe`, and `fleet.unsubscribe` as public JSON-RPC methods.
- `streams.rs` already classifies future topics like `health`, `cost`, `review`, and `agent.activity:*`, but `session.rs` does not expose public subscribe/read methods for those families yet.
- Atlas docs had older bridge wording that implied CLI/JSONL fallback behavior or broader observable population than the current merged daemon branch actually supports. The touched docs were aligned in this wave.
