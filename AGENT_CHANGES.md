# Agent Changes

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
