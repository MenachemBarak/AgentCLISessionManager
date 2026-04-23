# Maintenance — step 000002

Operator runbook for the surfaces touched this step. Builds on step-000001.

## Upgrade path v0.9.3 → v0.9.4

The installed app at `$env:LOCALAPPDATA\Programs\ClaudeSessionsViewer\claude-sessions-viewer.exe` is v0.9.3. v0.9.4 is released on GitHub but NOT installed.

Normal upgrade path (user-triggered, in-viewer):
1. Open the running v0.9.3 viewer.
2. The amber update banner appears at the top ("Update available: v0.9.4").
3. Click **Download**. Watches progress 0→100%; `<exe>.new` appears next to the live exe with SHA-256 matching the published asset digest.
4. Click **Restart & apply**. Confirms via `window.confirm`.
5. Server's `/api/update/apply` writes `update-swap-<pid>.cmd` to `%TEMP%\claude-sessions-viewer\`, spawns it detached, then `os._exit(0)` ~800ms later.
6. v0.9.3's swap helper uses the **rename-attempt loop** (from v0.9.2). Tries `ren live → live.old` in a 60×1s loop — succeeds the instant the exe's lock releases. Then promotes `.new` → live, relaunches.
7. Relaunched v0.9.4 auto-pings every resumed session tab with "SOFTWARE RESTARTED - GO ON FROM WHERE YOU LEFT OFF".

Watching the swap:
- `<install-dir>\update-swap.log` — step-by-step attempts. Expected lines:
  - `waiting for pid N to release its exe lock`
  - `exe lock released on attempt K, swapping`
  - `relaunching`

## Manual rollback

```powershell
$dir = "$env:LOCALAPPDATA\Programs\ClaudeSessionsViewer"
Get-Process claude-sessions-viewer -ErrorAction SilentlyContinue | Stop-Process -Force
Rename-Item "$dir\claude-sessions-viewer.exe" "$dir\claude-sessions-viewer.exe.bad-current"
# Pick the .old-<ver> you want back:
Rename-Item "$dir\claude-sessions-viewer.exe.old-0.9.3" "$dir\claude-sessions-viewer.exe"
Start-Process "$env:USERPROFILE\Desktop\Claude Sessions Viewer.lnk"
```

## Health check (never trust /api/status alone)

```bash
# 1. Find the port
powershell -Command "Get-Process claude-sessions-viewer -EA SilentlyContinue | ForEach { Get-NetTCPConnection -OwningProcess $_.Id -State Listen -EA SilentlyContinue }"

# 2. Basic API ping
curl -s http://127.0.0.1:<port>/api/status

# 3. CRITICAL — prove the UI actually rendered (the v0.9.0 black-screen lesson)
# Open the URL in a browser and run:
#   document.getElementById('root')?.children.length > 0
#   document.querySelectorAll('[data-testid^="session-row-"]').length > 0
```

## Running the e2e suite against the installed exe (CAUTION)

Only do this when the user isn't actively using the viewer.

```powershell
# 1. Stop any running viewer (WARNS USER FIRST)
Get-Process claude-sessions-viewer -EA SilentlyContinue | Stop-Process -Force

# 2. Launch the exe on a known port with test mode on
$env:CSV_TEST_MODE = "1"
$env:CLAUDE_HOME = "<repo>\tests\fixtures\claude-home"
Start-Process -FilePath "$env:LOCALAPPDATA\Programs\ClaudeSessionsViewer\claude-sessions-viewer.exe" `
  -ArgumentList '--server-only','--port','8769','--no-browser'

# 3. Point Playwright at it
cd <repo>\e2e
$env:CSV_APP_URL = "http://127.0.0.1:8769"
npx playwright test
```

**Safer default for dev work**: let the `webServer` block in `playwright.config.ts` spin up its own `python -m backend.cli` on port 8769. The user's installed exe stays untouched.

## Env vars (authoritative list)

| Var | Purpose | Where |
|---|---|---|
| `CSV_TEST_MODE=1` | Enables `/api/_test/seed-update-state` | Test runs only. **Never in prod.** |
| `CSV_APP_URL` | Points Playwright at an already-running server | CI `e2e (built exe)` job |
| `CLAUDE_HOME` | Override `~/.claude` for hermetic runs | Pytest + Playwright + e2e-exe CI |
| `PYTHONIOENCODING=utf-8` | Windows stdout/stderr encoding | CI |

## Rollback a PR's frontend change without a full release

All frontend files ship inside the exe via `backend/frontend/` → PyInstaller
includes them via `pyinstaller.spec` `datas`. To revert a frontend-only
regression, the only path is to ship a new release that re-adds the
previous code. No hot-patch path exists.

## QA expansion — known blockers + un-fixme path

- **Bug #43** (Tweaks crash, `Segmented is not defined`) — fix by either defining `Segmented` and registering `Object.assign(window, {Segmented, ...})` in `tweaks.jsx`, or by removing the `<Segmented>` call sites. Then un-fixme `e2e/tests/feature/tweaks.spec.ts::clicking the button does not crash the app` — the test should start passing on the same commit.

## Emergency shutoff

- **Stop auto-update checks**: there is no toggle currently. Workaround — block `api.github.com` at the firewall.
- **Disable restart-ping** if it sends into a session that doesn't want it: simple workaround — clear `~/.claude/viewer-terminal-state.json` before starting the viewer (the state file is what drives the pending set). Feature flag is on the #41 follow-up list.
