# Step tasks — step 000001

Task-by-task ledger for the ~10 min window covering v0.9.0 → v0.9.1 → v0.9.2 ship + Playwright suite.

## T-01: Diagnose v0.9.0 black-screen UI

- **State BEFORE**: v0.9.0 installed and running; pywebview window fully black; `/api/status` returned `{"version":"0.9.0","ready":true}`.
- **State AFTER**: Root cause identified — poisoned `~/.claude/viewer-terminal-state.json` with `kind:"leaf"` caused `TileTree` to crash on `tree.children[0]`.
- **Files touched**: None (diagnosis only).
- **Related prior steps**: N/A (first step).
- **Related sibling files**: `lessons-learned.md::L-01`, `knowledge.md::persisted state files`.

## T-02: Harden `TileTree` against malformed persisted state (v0.9.1)

- **State BEFORE**: `TileTree` at `backend/frontend/terminal-splits.jsx:122` checked `tree.kind === 'pane'` then fell into the split branch — unknown kinds or children-less splits crashed React.
- **State AFTER**: Defensive migration — unknown kinds become a fresh pane with console.warn; splits lacking 2 children fall back the same way.
- **Files touched**:
  - `backend/frontend/terminal-splits.jsx:122-147` (TileTree head, new defensive block)
- **Related prior steps**: N/A.
- **Related sibling files**: `architecture-decisions.md` (implicit — defensive-by-default rendering), `lessons-learned.md::L-01`.

## T-03: Build Playwright e2e suite with POM layout

- **State BEFORE**: No e2e suite. `/api/status` was the only "proof" of release health.
- **State AFTER**: `e2e/` directory with `pages/`, `tests/feature/`, `playwright.config.ts`, `package.json`, `README.md`. Two feature tests cover app-boot regression and full update-banner state machine. 6/6 green locally; both CI jobs green.
- **Files touched** (all new):
  - `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/.gitignore`, `e2e/README.md`
  - `e2e/pages/windowChrome.ts`, `e2e/pages/sessionList.ts`, `e2e/pages/updateBanner.ts`
  - `e2e/tests/feature/app-boots.spec.ts`, `e2e/tests/feature/update-flow.spec.ts`
  - `backend/frontend/app.jsx` — added `data-testid="update-banner"` (~line 177)
- **Related prior steps**: N/A.
- **Related sibling files**: `architecture-decisions.md::ADR-01`, `knowledge.md::Playwright layout`.

## T-04: Add `CSV_TEST_MODE`-gated seed endpoint

- **State BEFORE**: No way to deterministically test the update banner without a real GitHub release bump.
- **State AFTER**: `POST /api/_test/seed-update-state` exists but returns 404 unless `CSV_TEST_MODE=1`. Accepts `{latestVersion, checked, staged}`; updates the in-memory `updater.STATE`.
- **Files touched**:
  - `backend/app.py` — new `_TestSeedReq` model + `_test_seed_update_state` handler (lines ~517-536 area)
- **Related prior steps**: N/A.
- **Related sibling files**: `architecture-decisions.md::ADR-03`.

## T-05: CI workflow `.github/workflows/e2e.yml` with two jobs

- **State BEFORE**: CI covered tests matrix, lint, pre-commit, bandit, pip-audit, CodeQL. No UI coverage. v0.9.0 black-screen merged with all green checks.
- **State AFTER**: Two new jobs — `e2e (dev server)` vs `python -m backend.cli`, `e2e (built exe)` rebuilds PyInstaller and runs Playwright against the binary in a single step with try/finally cleanup, stdout/stderr redirected, app log dumped on failure.
- **Files touched**:
  - `.github/workflows/e2e.yml` (new, 180+ lines)
- **Related prior steps**: N/A.
- **Related sibling files**: `architecture-decisions.md::ADR-02`, `lessons-learned.md::L-03,L-04,L-06`.

## T-06: Ship v0.9.1 (TileTree + e2e)

- **State BEFORE**: v0.9.0 on main.
- **State AFTER**: v0.9.1 released. Tag `v0.9.1` pushed, release workflow produced wheel/sdist/zip/exe, installed locally, UI verified in browser (not just `/api/status`).
- **Files touched**:
  - `backend/__version__.py` → `"0.9.1"`
  - `CHANGELOG.md` — new `## [0.9.1]` section
  - PR #33 merged
- **Related prior steps**: N/A.
- **Related sibling files**: `knowledge.md::Releases shipped`.

## T-07: Discover and reproduce swap-helper bug during v0.9.0 → v0.9.1 self-update

- **State BEFORE**: v0.9.0 had working banner → download → apply flow (apparently). Never actually tested the swap to completion.
- **State AFTER**: Confirmed `tasklist /FI "PID eq <pid>" | find "<pid>"` returns EL=0 even when PID is gone. Helper hung indefinitely. Manual swap completed.
- **Files touched**: None (diagnosis). Reproduced in isolation:
  ```
  > tasklist /FI "PID eq 45664" 2>nul | find "45664" >nul & echo EL=%ERRORLEVEL%
  EL=0
  ```
- **Related prior steps**: N/A.
- **Related sibling files**: `lessons-learned.md::L-02`, `architecture-decisions.md::ADR-04`.

## T-08: Fix swap helper — rename-attempt loop (v0.9.2)

- **State BEFORE**: `_windows_swap_script` used `tasklist | find` PID polling (broken).
- **State AFTER**: Rename-attempt loop. Tries `ren exe exe.old` every 1s, 60s cap. Windows' exclusive image-file lock is the readiness signal. Test asserts `"tasklist" not in script`.
- **Files touched**:
  - `backend/updater.py::_windows_swap_script` — rewrite (lines 216-271 area)
  - `tests/test_updater.py::test_swap_script_structure` — new invariants
  - `backend/__version__.py` → `"0.9.2"`
  - `CHANGELOG.md` — new `## [0.9.2]` section
- **Related prior steps**: N/A.
- **Related sibling files**: `architecture-decisions.md::ADR-04,ADR-05`, `lessons-learned.md::L-02,L-08,L-09`.

## T-09: Ship v0.9.2

- **State BEFORE**: v0.9.1 on main, broken helper in the wild.
- **State AFTER**: v0.9.2 released. PR #34 merged with 14/14 checks green. Currently installed + running on this machine (port 55242).
- **Files touched**: PR #34 assets.
- **Related prior steps**: Builds on T-08.
- **Related sibling files**: `knowledge.md::Releases shipped`, `maintenance.md::Known currently-broken things` (bootstrap gap).

## T-10: File new tasks #39, #40, #41

- **State BEFORE**: Tasks #32-38.
- **State AFTER**: Three new tasks filed.
  - **#39**: Terminal tab focus → left-pane highlight
  - **#40**: Smart session research (Claude SDK)
  - **#41 HIGH**: Auto-ping resumed sessions on viewer restart
- **Files touched**: Task tracker (no source changes yet).
- **Related prior steps**: N/A.
- **Related sibling files**: `user-notes.md`.

## T-11 (pending, captured): Apply `--dangerously-skip-permissions` to every resume

- **State BEFORE**: `backend/providers/claude_code.py::resume_command(sid)` returns `["claude", "--resume", sid]`.
- **State AFTER (target)**: Returns `["claude", "--dangerously-skip-permissions", "--resume", sid]`. All three resume call sites (in-viewer PTY, external wt.exe, future auto-restart ping) inherit the flag via the single provider method.
- **Files to touch**:
  - `backend/providers/claude_code.py::resume_command`
  - `tests/test_providers.py` — assertion on returned argv
- **Related prior steps**: N/A — first appearance.
- **Related sibling files**: `architecture-decisions.md::ADR-06`, `user-notes.md` ("this step's args").
- **Priority**: This is the #1 next action per the user's step directive.
