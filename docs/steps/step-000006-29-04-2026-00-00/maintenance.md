# Maintenance — step 000006 (29-04-2026)

## Running the project locally

```bash
cd C:\projects\agent-manager

# Activate venv
.venv\Scripts\activate

# Start backend dev server
python -m backend.app

# Or via CLI entry point
python -m backend.cli
```

App serves at `http://127.0.0.1:8765`

## Running tests

```bash
# Backend unit tests
.venv\Scripts\python.exe -m pytest tests/ -v

# With coverage
.venv\Scripts\python.exe -m pytest tests/ --cov=backend --cov-report=term-missing

# E2E (requires server running on 8765)
cd e2e && npx playwright test

# E2E with specific spec
npx playwright test tests/feature/tab-focus-highlights.spec.ts
```

## Build the exe (PyInstaller)

```bash
# One-file exe
pyinstaller pyinstaller.spec

# One-folder exe (used by installer)
pyinstaller pyinstaller-onedir.spec
```

Output: `dist/AgentManager.exe` (one-file) or `dist/AgentManager/` (one-folder)

## Build the installer (Inno Setup)

Requires Inno Setup installed. Compile `installer/agentmanager.iss`.

## Install on user's machine (raw-exe swap — NO Inno installer)

User's machine uses a raw-exe swap chain:
1. Check `%LOCALAPPDATA%\Programs\AgentManager\` for `unins000.exe` — if absent, use swap
2. Build new exe
3. Kill running AgentManager.exe if alive
4. Copy new exe to `%LOCALAPPDATA%\Programs\AgentManager\AgentManager.exe`

**Current state:** v1.2.17 installed, v1.2.18 available in source. Needs update.

## Claude Code hooks (user-level)

File: `C:\Users\User\.claude\settings.json`

Both `SessionStart` and `UserPromptSubmit` run:
```
C:\projects\agent-manager\.venv\Scripts\python.exe C:\projects\agent-manager\hooks\session_start.py
```

**After any project move:** Update these paths immediately. The hooks error silently-visibly at session start.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `AGENTMANAGER_DAEMON` | unset | Set to `"1"` to opt-in to ADR-18 daemon mode |
| `ANTHROPIC_API_KEY` | unset | Optional; will enable Claude SDK re-rank in search (not yet implemented) |

## Known flake (excluded from CI)

`tests/test_watcher.py::test_live_watchdog_deletes_via_endpoint` — PermissionError WinError 32 (file lock race on Windows). Already excluded with `# pragma: no cover` / pytest marker.

## Deprecation warnings in test output

30 `DeprecationWarning: on_event is deprecated` warnings per test run. Source: `backend/app.py` lines 584 and 1851 use `@app.on_event` which FastAPI 0.136 deprecated. Non-blocking but should be migrated to `lifespan` context manager.

## Coverage gate

CI uses `--cov-fail-under=55` (Linux runner). Windows coverage is currently 72%.

Target (T-62): 80%. Biggest gaps to close:
1. `backend/app.py`: 62% — need ~200 more covered lines
2. `backend/updater.py`: 55% — download/verify/swap path (lines 191-263) entirely untested

## Roll back this step's changes

Changes made in this step:
1. **Hooks path fix** — if hooks need to revert to old M:\ path (they shouldn't), edit `~/.claude/settings.json`
2. **No code changes** — this was a read-only onboarding session
3. **Memory files written** — at `~/.claude/projects/C--projects-agent-manager/memory/`; safe to delete if stale
4. **Step files written** — `docs/steps/step-000006-29-04-2026-00-00/`; safe to delete

## Monitoring / health check

```bash
# Check backend is alive
curl http://127.0.0.1:8765/api/status

# Check version
curl http://127.0.0.1:8765/api/version
```

## Log locations

- Backend logs: stdout/stderr of the running process (no file logging by default)
- PyInstaller exe logs: Windows Event Log or stdout redirect
- Playwright test artifacts: `e2e/test-results/`

## ADR-18 daemon mode operation

```bash
# Start in daemon mode (opt-in, not default)
AGENTMANAGER_DAEMON=1 python -m backend.cli

# Daemon process: AgentManager-Daemon.exe (long-lived, holds port 8765)
# UI process: AgentManager.exe (short-lived pywebview, connects to daemon)
```

Daemon specs in `e2e/tests/daemon/` are intentionally failing TDD stubs for Phases 8-10. Do not attempt to fix them.
