# Step tasks — step 000002

## T-12: Ship `--dangerously-skip-permissions` default in `resume_command` (v0.9.3)

- **State BEFORE**: `ClaudeCodeProvider.resume_command(sid)` returned `["claude", "--resume", sid]`. Unattended resume flows would stall on a permission prompt.
- **State AFTER**: Returns `["claude", "--dangerously-skip-permissions", "--resume", sid]`. All three resume paths (in-viewer PTY, external wt.exe, future auto-restart ping) inherit via this single function.
- **Files touched**:
  - `backend/providers/claude_code.py::resume_command` — argv change + security docstring
  - `tests/test_providers.py::test_resume_command_is_stable` — asserts flag presence as load-bearing
  - `backend/__version__.py` → `"0.9.3"`
  - `CHANGELOG.md` — new `## [0.9.3]` section
  - PR #36 merged, tag `v0.9.3` pushed, release workflow published wheel/sdist/zip/exe
- **Related prior steps**: Builds on step-000001 (Playwright suite from T-03, TileTree hardening from T-02).
- **Related sibling files**: `architecture-decisions.md::ADR-07`, `knowledge.md::--dangerously-skip-permissions`.

## T-13: Ship restart-ping flow (v0.9.4)

- **State BEFORE**: Previous viewer shutdown → user had to manually re-engage each restored tab.
- **State AFTER**: Every restored tab with a `spawn.sessionId` gets auto-pinged with `SOFTWARE RESTARTED - GO ON FROM WHERE YOU LEFT OFF\r` 5s after PTY ready. Pairs with T-12 to guarantee unattended resume completes without permission stalls.
- **Files touched**:
  - `backend/frontend/terminal-pane.jsx` — added `window._restartPingPending`/`_restartPingFired` Sets + `ready` handler drains pending → writes ping after 5s delay
  - `backend/frontend/app.jsx` — hydration effect seeds pending set; new `collectSessionIds` helper walks nested splits
  - `e2e/tests/feature/restart-ping.spec.ts` — 3 tests (hydration seeds, nested splits, empty layout no-op)
  - `e2e/playwright.config.ts` — `workers: 1` pin for state isolation
  - `backend/__version__.py` → `"0.9.4"`
  - `CHANGELOG.md` — new `## [0.9.4]` section
  - PR #37 merged (14/14 CI green), tag `v0.9.4` pushed + released
- **Related prior steps**: Builds on step-000001's TileTree hardening (T-02) — the defensive migration prevents malformed persisted state from black-screening the restart-ping path.
- **Related sibling files**: `architecture-decisions.md::ADR-08`, `knowledge.md::Restart-ping mechanics`, `lessons-learned.md::L-11`.

## T-14: QA expansion — 9 → 25 Playwright tests

- **State BEFORE**: Playwright suite was 9 tests across 3 files — app-boots, update-flow, restart-ping. No coverage for session list, right-pane tabs, tweaks, or API shape contracts.
- **State AFTER**: 25 tests (24 pass + 1 `test.fixme` tracking bug #43) across 7 files. New helpers, new page classes, data-testid coverage audit.
- **Files touched** (all under `e2e/` unless noted):
  - `backend/frontend/compact-list.jsx` — added `session-search-input` testid; IconBtn auto-generates `rowbtn-<label-slug>` testids
  - `backend/frontend/app.jsx` — added `tweaks-button`, `transcript-pane` testids
  - New helpers: `helpers/page-state.ts`, `helpers/api-probe.ts`, `helpers/layout-seed.ts`
  - New page classes: `pages/transcript.ts`, `pages/rightPane.ts`, `pages/tweaks.ts`
  - Expanded: `pages/sessionList.ts` — searchFor, clearSearch, clickInViewerForRow, rescan
  - New feature tests: `tests/feature/session-list.spec.ts` (3), `tests/feature/right-pane-tabs.spec.ts` (5), `tests/feature/tweaks.spec.ts` (3), `tests/feature/api-contracts.spec.ts` (5)
  - PR #38 opened, went GREEN on all 14 CI checks during this step
- **Related prior steps**: Builds on step-000001's Playwright foundation (T-03, T-05, L-07).
- **Related sibling files**: `architecture-decisions.md::ADR-10,ADR-11,ADR-12`, `lessons-learned.md::L-10,L-11,L-12,L-13,L-14`.

## T-15: Surface real bug — Tweaks drawer `Segmented is not defined` (#43)

- **State BEFORE**: Bug silently present in `tweaks.jsx` — clicking the Tweaks button threw inside React's render. No test caught it.
- **State AFTER**: `tweaks.spec.ts::clicking the button does not crash the app` reproduces it via `page.on('pageerror')`. Test marked `test.fixme` with pointer to task #43. Will un-fixme on fix PR.
- **Files touched**: `e2e/tests/feature/tweaks.spec.ts` (test.fixme + comment); task #43 filed
- **Related prior steps**: N/A — newly surfaced.
- **Related sibling files**: `architecture-decisions.md::ADR-12`, `lessons-learned.md::L-13,L-14`, `knowledge.md::Known live bug`.

## T-16: Capture "session-liveness daemon" architecture vision as task #42

- **State BEFORE**: No explicit architecture for surviving platform restarts without dropping sessions.
- **State AFTER**: Task #42 filed with the user's "silver bullet" vision — Tier A liveness daemon + Tier B platform, liveness-layer-upgrade modal, cold path resume with skip-permissions + ping. Multi-week project deferred.
- **Files touched**: Task tracker only.
- **Related prior steps**: Conceptually threads through step-000001's ADR-06 (the skip-permissions requirement) — T-12 is the first concrete step toward the task-#42 vision.
- **Related sibling files**: `architecture-decisions.md::ADR-09`, `user-notes.md` (verbatim quote).

## T-17: Write this step snapshot (T-current)

- **State BEFORE**: step-000001 covered v0.9.0 → v0.9.2.
- **State AFTER**: step-000002 covers v0.9.3 → v0.9.4 + QA expansion + #42/#43 filings. Both steps now documented in `docs/steps/`.
- **Files touched**:
  - `docs/steps/step-000002-23-04-2026-03-29/user-notes.md`
  - `docs/steps/step-000002-23-04-2026-03-29/knowledge.md`
  - `docs/steps/step-000002-23-04-2026-03-29/architecture-decisions.md`
  - `docs/steps/step-000002-23-04-2026-03-29/lessons-learned.md`
  - `docs/steps/step-000002-23-04-2026-03-29/maintenance.md`
  - `docs/steps/step-000002-23-04-2026-03-29/step-tasks.md` (this file)
- **Related prior steps**: Reads and extends step-000001-23-04-2026-01-48.
- **Timer**: task-timer `6ca3b0c9` for 10 minutes, started at the top of this step.
