# Atlas Fork Cleanup Guide

> What to remove from the VS Code fork that Atlas does not need.

---

## Principles

1. **Remove what is VS Code-specific** — Microsoft services, telemetry endpoints, marketplace, surveys, tunnels
2. **Keep what is infrastructure** — Telemetry framework (re-point it), auth framework (re-implement providers), extension management (disable gallery)
3. **Replace, don't just delete** deeply integrated services — Swap implementations, keep interfaces
4. **Prioritize by risk** — Safe deletions first, careful replacements later

---

## HIGH PRIORITY — Remove With Graph Cleanup

These modules are functionally unnecessary for Atlas, but most have build or import references that must be cleaned up alongside deletion. Each entry lists the known graph dependencies.

### Test Extensions (~382,000 lines)

| Extension | Path | Lines |
|-----------|------|-------|
| `vscode-test-resolver` | `extensions/vscode-test-resolver/` | ~54,630 |
| `vscode-api-tests` | `extensions/vscode-api-tests/` | ~69,170 |
| `vscode-colorize-tests` | `extensions/vscode-colorize-tests/` | ~54,915 |
| `vscode-colorize-perf-tests` | `extensions/vscode-colorize-perf-tests/` | ~203,436 |

**Graph cleanup required**:
- Remove from `build/gulpfile.extensions.ts` (lines 92–95: tsconfig references)
- Remove from `build/npm/dirs.ts` (lines 51–54: npm directory entries)
- Remove from `build/lib/extensions.ts` (lines 413–416: extension list)
- Remove from `scripts/test-integration.sh` and `scripts/test-remote-integration.sh` (test targets)
- Add to `ATLAS_REMOVED_EXTENSIONS` in `build/lib/atlasProduct.ts`
- Then delete the directories

### Task Runner Extensions

| Extension | Path | Reason |
|-----------|------|--------|
| `grunt` | `extensions/grunt/` | Legacy task runner. Factory control plane doesn't need it. |
| `gulp` | `extensions/gulp/` | Same. |
| `jake` | `extensions/jake/` | Same. |

**Graph cleanup required**:
- Remove from `build/gulpfile.extensions.ts` (lines 68–73: tsconfig references)
- Remove from `build/npm/dirs.ts` (lines 28–33: npm directory entries)
- Add to `ATLAS_REMOVED_EXTENSIONS`
- Then delete the directories

### Azure Pipelines Build Scripts (~3,369 lines)

**Path**: `build/azure-pipelines/`

Microsoft CI/CD infrastructure: CDN uploads, code signing, build release pipeline, telemetry extraction, Copilot compatibility checks. Atlas uses its own CI/CD.

**Safe to delete directly** — no inbound imports from other build scripts.

### Surveys (~260 lines)

**Path**: `src/vs/workbench/contrib/surveys/`

- `nps.contribution.ts` — NPS survey popup linking to Microsoft's survey
- `languageSurveys.contribution.ts` — Language-specific surveys

**Graph cleanup required**:
- Remove imports from `src/vs/sessions/sessions.common.main.ts` (lines 355–356)
- Remove imports from `src/vs/workbench/workbench.common.main.ts` (lines 355–356)
- Then delete the directory

### Workspace Tags (~2,118 lines)

**Path**: `src/vs/workbench/contrib/tags/`

Collects workspace metadata (technology stack detection) and reports to Microsoft. Six files.

**Graph cleanup required**:
- Remove imports from `src/vs/sessions/sessions.desktop.main.ts` (lines 146–147)
- Remove import from `src/vs/sessions/sessions.web.main.ts` (line 141)
- Check for and remove any corresponding imports in `workbench.desktop.main.ts` and `workbench.web.main.ts`
- Then delete the directory

### Remote Tunnel Contribution (~1,474 lines)

| Path | Lines | Content |
|------|-------|---------|
| `src/vs/workbench/contrib/remoteTunnel/` | ~821 | "Turn on Remote Tunnel Access" UI for Microsoft dev tunnels |
| `src/vs/platform/remoteTunnel/` | ~653 | Platform service for tunnel management |

**Graph cleanup required**: Remove contribution imports from workbench and sessions main files, then delete both directories.

### Simple Browser Extension (~581 lines, already excluded)

Already in `ATLAS_REMOVED_EXTENSIONS`. Delete the directory: `extensions/simple-browser/`.

---

## MEDIUM PRIORITY — Needs Replacement

These need the interface kept but the implementation swapped.

### 1DS Telemetry Appender (~300 lines) — CRITICAL

**What**: Sends telemetry to `https://mobile.events.data.microsoft.com/OneCollector/1.0` using Microsoft's `@microsoft/1ds-core-js` SDK.

**Files**:
- `src/vs/platform/telemetry/common/1dsAppender.ts`
- `src/vs/platform/telemetry/browser/1dsAppender.ts`
- `src/vs/platform/telemetry/node/1dsAppender.ts`

**Action**: Replace with a no-op appender or Atlas's own telemetry backend. The `ITelemetryAppender` interface stays — only the 1DS implementation goes. The telemetry *framework* (25 files, ~3,482 lines in `src/vs/platform/telemetry/`) is used pervasively and must be kept.

### Update Service (~5,000 lines)

**What**: Platform-specific update services that check Microsoft's update server.

**Files to replace**:
- `src/vs/platform/update/electron-main/updateService.darwin.ts` (macOS Squirrel)
- `src/vs/platform/update/electron-main/updateService.win32.ts` (Windows NSIS/Inno)
- `src/vs/platform/update/electron-main/updateService.linux.ts`
- `src/vs/platform/update/electron-main/updateService.snap.ts` (Snap store — delete entirely)

**Files to keep**: `src/vs/platform/update/common/update.ts` (interfaces, state machine)

**UI** (~3,195 lines in `src/vs/workbench/contrib/update/`): Keep but rebrand. The release notes viewer references VS Code release notes.

**Action**: Replace implementations with Atlas's own update server check. Delete the Snap updater.

### Assignment/Experiment Service (~792 lines)

**What**: Microsoft's TAS (Treatment Assignment Service) for A/B testing. Used by 18 files.

**Files**:
- `src/vs/workbench/services/assignment/`
- `src/vs/platform/assignment/common/assignment.ts`

**Action**: Replace with a no-op or Atlas's own feature flag service.

### Chat Entitlement Service (~500+ lines)

**What**: Manages sign-up/entitlement for chat (originally "GitHub Copilot Free/Pro"). References GitHub authentication and entitlement URLs (already emptied in product.json).

**File**: `src/vs/workbench/services/chat/common/chatEntitlementService.ts`

**Action**: Already partially defused (URLs emptied, fails closed). Eventually replace with Atlas's own auth/entitlement model.

### Chat Setup Flow (~2,705 lines)

**What**: The Copilot/chat setup wizard — provider selection, sign-in, entitlement check.

**Path**: `src/vs/workbench/contrib/chat/browser/chatSetup/`

**Action**: Replace with Atlas's own onboarding flow. The sessions layer has its own welcome contribution that may supersede this.

### Welcome/Getting Started (~6,100 lines)

**What**: VS Code-branded onboarding experiences.

| Path | Lines | Content |
|------|-------|---------|
| `src/vs/workbench/contrib/welcomeGettingStarted/` | ~4,940 | Getting started editor with VS Code/Copilot walkthroughs |
| `src/vs/workbench/contrib/welcomeWalkthrough/` | ~1,166 | Walk-through framework |

**Keep**: `src/vs/workbench/contrib/welcomeAgentSessions/` (~1,185 lines) — This is the sessions-specific welcome overlay, likely Atlas-relevant.

**Action**: Replace getting started content with Atlas onboarding. The walkthrough framework may be reusable.

---

## LOW PRIORITY — Long-Term Projects

These are large, deeply integrated subsystems that need careful planning.

### Settings Sync (~28,000 lines)

**What**: Cloud settings sync to Microsoft's service.

| Path | Lines |
|------|-------|
| `src/vs/platform/userDataSync/` | ~23,714 (52 files) |
| `src/vs/workbench/services/userDataSync/` | ~1,508 |
| `src/vs/workbench/contrib/userDataSync/` | ~2,495 |
| `src/vs/workbench/contrib/editSessions/` | ~2,697 |

**Action**: The sync *engine* (merge logic for settings, keybindings, extensions) is good infrastructure. The `userDataSyncStoreService` talks to Microsoft's cloud — replace the backend if Atlas wants its own sync. Edit Sessions (cloud workspace state) can be removed.

### Extension Gallery/Marketplace (~15,000+ lines)

**What**: Extension gallery service, recommendations, download/install from VS Marketplace.

Spread across:
- `src/vs/platform/extensionManagement/` (~12,525 lines)
- `src/vs/workbench/services/extensionManagement/` (~7,120 lines)
- `src/vs/workbench/contrib/extensions/` (~26,553 lines — includes recommendations)

**Status**: `product.json` has no `extensionsGallery` configured, so the marketplace is already inert. The code is present but non-functional.

**Action**: Leave for now. The extension management *framework* is needed (local extension loading still works). Remove the recommendation subsystem (~3,000+ lines of `*Recommendations*` files) when ready — Atlas won't recommend VS Marketplace extensions.

### Remote Agent Infrastructure

**What**: Core infrastructure for VS Code's remote development (SSH, containers, tunnels). Referenced from 80+ files.

**Broader remote contribution**: `src/vs/workbench/contrib/remote/` (~6,226 lines) — remote explorer, tunnel view, remote indicator, connection health.

**Action**: The tunnel contribution is already removed (see HIGH PRIORITY). The broader remote infrastructure (`IRemoteAgentService`) is deeply integrated into the workbench for extension hosts, file system providers, and terminal backends. Evaluate whether Atlas needs any remote capabilities. If not, this is a significant but careful removal.

### Copilot Naming Remnants (~182 files)

Variable names, comments, and compatibility layers that reference "copilot" or "Copilot" throughout the chat infrastructure. Most are benign — the infrastructure is generic, just named after its original purpose.

**Action**: Gradual rename pass. Low risk, low urgency. Focus on user-facing strings first (many already rebranded).

---

## Extensions to Add to ATLAS_REMOVED_EXTENSIONS

Update `build/lib/atlasProduct.ts`:

```typescript
export const ATLAS_REMOVED_EXTENSIONS: ReadonlySet<string> = new Set([
    // Already excluded
    'github',
    'github-authentication',
    'microsoft-authentication',
    'simple-browser',
    'tunnel-forwarding',
    // New exclusions
    'vscode-test-resolver',
    'vscode-api-tests',
    'vscode-colorize-tests',
    'vscode-colorize-perf-tests',
    'grunt',
    'gulp',
    'jake',
]);
```

---

## Cleanup Execution Order

Each step includes the required graph cleanup. Verify the build compiles after each step before proceeding to the next.

1. **Add test/task-runner extensions to `ATLAS_REMOVED_EXTENSIONS`**, remove their entries from `build/gulpfile.extensions.ts`, `build/npm/dirs.ts`, `build/lib/extensions.ts`, and test scripts, then delete their directories
2. **Delete `build/azure-pipelines/`** (no inbound references)
3. **Remove surveys imports** from `sessions.common.main.ts` and `workbench.common.main.ts`, then delete `src/vs/workbench/contrib/surveys/`
4. **Remove tags imports** from `sessions.desktop.main.ts`, `sessions.web.main.ts`, and corresponding workbench mains, then delete `src/vs/workbench/contrib/tags/`
5. **Remove remoteTunnel imports**, then delete `src/vs/workbench/contrib/remoteTunnel/` and `src/vs/platform/remoteTunnel/`
6. **Replace 1DS appender** with no-op
7. **Replace update service** implementations (keep interfaces)
8. **Replace assignment service** with no-op
9. **Replace welcome/getting started** with Atlas onboarding
10. **Evaluate settings sync** and remote infrastructure for longer-term cleanup
