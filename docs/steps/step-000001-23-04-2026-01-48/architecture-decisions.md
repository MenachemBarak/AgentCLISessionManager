# Architecture decisions — step 000001

## ADR-01: Playwright POM layout `pages/` + `tests/feature/`

- **Decision**: Split e2e into `e2e/pages/<surface>.ts` (intent-level actions) and `e2e/tests/feature/<journey>.spec.ts` (flows that compose page actions). Feature tests MUST NOT query the DOM directly.
- **Alternatives considered**:
  - Flat `e2e/tests/*.spec.ts` with inline locators (rejected — duplicates locators, drifts fast).
  - Playwright "component tests" against mounted React components (rejected — doesn't cover the real backend + pywebview integration we care about).
- **Why**: User explicit request. Also: locator drift is the #1 e2e maintenance cost, and page classes contain it to one file per surface.
- **Blast radius**: `e2e/**`. Adds `pages/`-level testids to frontend (`data-testid="update-banner"` added to `backend/frontend/app.jsx`).
- **Reversibility**: Trivial. Pages are plain TS classes.

## ADR-02: CI runs the built exe + Playwright in one step

- **Decision**: `e2e (built exe)` job launches the PyInstaller binary **and** runs Playwright **inside the same step**, with exe cleanup in `finally`. Do NOT split across steps.
- **Alternatives considered**:
  - Split: "Launch exe" then "Run Playwright" in separate steps (rejected — reproduced on GH runners: the exe gets orphaned/killed between steps, `ERR_CONNECTION_REFUSED` on every test).
  - Start exe as a service (rejected — runner doesn't allow persistent services).
- **Why**: GitHub Actions runners reparent and kill detached children between step boundaries. Pinning the exe to the step's shell lifetime via try/finally is the only reliable path.
- **Blast radius**: `.github/workflows/e2e.yml` only.
- **Reversibility**: Trivial.

## ADR-03: Test-only backend hook gated by `CSV_TEST_MODE=1`

- **Decision**: `POST /api/_test/seed-update-state` exists but returns 404 unless `CSV_TEST_MODE=1` is set at request time (checked per-request, not per-boot).
- **Alternatives considered**:
  - Mock the GitHub Releases API at network level in tests (rejected — fragile, brittle to transport changes).
  - Use a Python-level `pytest.monkeypatch` equivalent (rejected — doesn't work for Playwright which hits HTTP).
  - Feature flag at build time (rejected — two different binaries to maintain).
- **Why**: Test-mode is request-scoped so a production user can't flip it on by setting an env var after launch.
- **Blast radius**: `backend/app.py` only; gated endpoint.
- **Reversibility**: Trivial (delete the endpoint + env check).

## ADR-04: Swap helper uses image-lock detection, not PID polling

- **Decision**: `_windows_swap_script` loops on `ren live → live.old` and treats success as "exe exited". No `tasklist`, no `find`, no `%ERRORLEVEL%` from external tools.
- **Alternatives considered**:
  - `tasklist /FI "PID eq <pid>" | find "<pid>"` (REJECTED — **reproduced live**: `find` returns EL=0 when pid is absent, infinite loop).
  - `wmic process where processid=<pid>` (rejected — deprecated).
  - Inline PowerShell inside .cmd (rejected — startup cost per-iteration; polling loop would eat CPU).
  - `waitfor` + signal-file dropped by the Python process (rejected — more moving parts, race on the flag).
- **Why**: Windows holds an exclusive lock on a running image file. Rename is the OS's authoritative "is this file in use" signal. Zero tool quirks, 60s cap.
- **Blast radius**: `backend/updater.py::_windows_swap_script`. Ships in every new exe from v0.9.2 forward.
- **Reversibility**: One-way until v0.9.2 itself is superseded — the HELPER is what the CURRENTLY-RUNNING exe writes, so v0.9.1 users still get the broken helper on their v0.9.1 → v0.9.2 upgrade (known bootstrap gap; manual swap required once).

## ADR-05: Bootstrap gap accepted — v0.9.1 users must manually swap to v0.9.2

- **Decision**: Do not ship a separate "fix v0.9.1's helper" hotfix. The self-update loop heals on its own from v0.9.2 forward.
- **Alternatives considered**:
  - Reach into the already-installed v0.9.1 binary and rewrite its helper (rejected — PyInstaller frozen binary, not modifiable in place).
  - Ship a separate one-shot "helper-repair" tool (rejected — adds a second binary with its own auto-update concerns).
  - Refuse to upgrade past v0.9.1 until users manually swap (rejected — blocks all improvement).
- **Why**: The user already manually swapped once during this session. Future v0.9.2 → v0.9.3+ auto-updates will Just Work. Cost of avoiding this is higher than the cost of one manual swap.
- **Blast radius**: Zero code. Documentation only.
- **Reversibility**: N/A (no change made).

## ADR-06 (requirement captured, not yet implemented): Every `claude --resume` includes `--dangerously-skip-permissions`

- **Decision** (user directive, to be implemented next): Modify `providers/claude_code.py::resume_command(sid)` to append `--dangerously-skip-permissions`. All resume paths (in-viewer PTY, external wt.exe, future auto-restart ping) flow through this function, so single-source change covers all three.
- **Alternatives considered**:
  - Per-path flag (rejected — three places to keep in sync, guaranteed to drift).
  - UI toggle "require permission prompts" default off (rejected — user wants this unconditional).
- **Why**: User explicit requirement — "when session is started using the sessionmanager (no matter how) it always must start with `--dangerously-skip-permissions`". These sessions are driven by the user's own workflow; permission prompts stall the agent pipeline (the whole point of task #41 "continue from where you left off" requires unattended resume).
- **Blast radius**: `backend/providers/claude_code.py` + any provider test that asserts `resume_command()` shape.
- **Reversibility**: Trivial revert.
- **Security note**: The flag bypasses Claude Code's per-action confirmation. Only safe because the user's session manager is running locally against the user's own machine; not appropriate in a multi-tenant or remote context.
