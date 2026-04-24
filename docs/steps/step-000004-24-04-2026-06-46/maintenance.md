# Maintenance — step 000004

## Running the app

### Installer path (preferred, since v1.2.2)
Download `AgentManager-<ver>-setup.exe` from https://github.com/MenachemBarak/AgentCLISessionManager/releases/latest. Run it. No UAC prompt (per-user install to `%LOCALAPPDATA%\Programs\AgentManager\`). Launches itself on finish.

### Raw-exe path (legacy; kept for auto-update back-compat)
Download `AgentManager-<ver>-windows-x64.exe`, drop it anywhere. Double-click to run. Shows the _MEI cleanup dialog on update/restart — installer path doesn't.

### Dev path
```
python -m backend.cli                    # desktop mode, pywebview
python -m backend.cli --server-only      # headless HTTP on :8765
python -m daemon                          # daemon mode (auth-gated)
```

### Opt-in daemon split (experimental)
```
set AGENTMANAGER_DAEMON=1
AgentManager.exe
```
UI probes `127.0.0.1:8765`, spawns `python -m daemon` detached if absent, navigates webview with token in URL fragment. Default-on is planned for v1.3.0.

## Auto-update

- UI polls GitHub Releases API every 30 min (server-side) + frontend banner on check.
- "Download & Restart" writes `<ver>.new` sibling of the current exe, invokes swap helper `.cmd`, exits.
- Swap helper waits for the current exe's image lock to release, renames `.exe` → `.exe.old`, moves `.new` → `.exe`, relaunches. Log at `update-swap.log` in the install dir.
- Installer users: auto-update still downloads the raw .exe and swaps it in the one-folder install (works, but mildly ugly — full installer-aware auto-update is future work).

## Environment variables

| Var | Where | Purpose |
|-----|-------|---------|
| `AGENTMANAGER_DAEMON=1` | process env | Enable opt-in daemon split |
| `AGENTMANAGER_DAEMON_HOST` | process env | Override loopback (tests only) |
| `AGENTMANAGER_DAEMON_PORT` | process env | Default 8765 |
| `AGENTMANAGER_DAEMON_LOG_LEVEL` | process env | Default info |
| `AGENTMANAGER_STATE_DIR` | process env | Override `%LOCALAPPDATA%\AgentManager\` (tests) |
| `CLAUDE_HOME` | process env | Override `~/.claude` (tests) |
| `CSV_TEST_MODE=1` | process env | Enable test-only seed endpoints |
| `CSV_APP_URL` | Playwright only | Target an already-running server |

## Logs + state

- **Install dir**: `%LOCALAPPDATA%\Programs\AgentManager\`
  - `AgentManager.exe` (active)
  - `AgentManager.exe.old` / `.old-X.Y.Z` (previous versions kept for rollback)
  - `_internal/` (one-folder mode only)
  - `update-swap.log`
- **Daemon state** (when opt-in enabled): `%LOCALAPPDATA%\AgentManager\`
  - `daemon.pid` (JSON `{pid, startTimeEpoch, daemonVersion}`)
  - `token` (bearer token, 64 hex chars, user-only ACL on Windows via pywin32 if available)
- **User data** (persists across reinstalls): `~/.claude/`
  - `viewer-labels.json` — user labels + pin state
  - `viewer-terminal-state.json` — persisted tab layout (tile tree + spawn specs)
  - `sessions/` — active-session pid markers (claude-code writes these)
  - `projects/**/*.jsonl` — actual session transcripts (claude-code owns)
- **Claude Sessions Viewer file log**: `~/.claude/claude-sessions-viewer.log` (logging to file for frozen exe debugging)

## How to roll back a release

1. `%LOCALAPPDATA%\Programs\AgentManager\AgentManager.exe.old-<previous-ver>` should already exist.
2. Stop the running app (`AgentManager.exe --uninstall --yes` to ensure no orphan processes).
3. Rename current `AgentManager.exe` → `.bad-<ver>`.
4. Rename `.old-<previous-ver>` → `AgentManager.exe`.
5. Relaunch. Auto-updater will see the version mismatch and re-offer the latest.

## How to uninstall completely

`AgentManager.exe --uninstall --yes` performs the seven-step tear-down:
1. Read daemon PID from state dir
2. `POST /api/shutdown` with 5s timeout
3. If daemon still alive: `TerminateProcess` + walk process tree to kill PTY grandchildren
4. Remove `%LOCALAPPDATA%\AgentManager\` tree
5. Remove Desktop shortcut `AgentManager.lnk`
6. Remove Start-menu shortcuts (AgentManager + Uninstall AgentManager)
7. Remove `HKCU\Software\AgentManager` if present (forward-compat — not currently written)

Or: Add/Remove Programs → AgentManager → Uninstall. Runs the same CLI first, then Inno removes files.

## Monitoring / alerting

- **Release workflow success**: watch `https://github.com/MenachemBarak/AgentCLISessionManager/actions/workflows/release.yml`. Failure → check which stage (build / verify / exe / release) failed.
- **User-reported regressions**: repo issues at `https://github.com/MenachemBarak/AgentCLISessionManager/issues`.
- **Playwright e2e project `chromium`** is the CI gate. The `daemon` Playwright project exists but is opt-in (set `--project=daemon`) and still red-by-design for Phase-8+ invariants.

## Lint gauntlet (MUST match CI exactly)

```bash
# CI pins ruff to 0.7.4 via .pre-commit-config.yaml
pip install "ruff==0.7.4"
python -m ruff check backend hooks tests daemon
python -m ruff format --check backend hooks tests daemon
python -m mypy backend hooks daemon
python -m bandit -c pyproject.toml -r backend hooks daemon
python -m pytest tests/                       # ~165 tests as of v1.2.7
pnpm exec playwright test --project=chromium  # in e2e/
```

## Known pending / deferred

- **#42 Phases 8-10**: shipping milestones for the daemon split (dogfood opt-in → flip default → deprecate opt-out). Requires user-feedback window before flipping v1.3.0.
- **Daemon e2e project** (`e2e/tests/daemon/*.spec.ts`): currently red-by-design; needs a webServer config pointing at `python -m daemon` with bearer-token auth to go green.
- **Dependabot PRs #6, #10, #11**: triggered `@dependabot rebase` on 2026-04-24 but still stuck mergeable=UNKNOWN. May need manual rebase against current main.
- **Installer-aware auto-update**: today the installer install auto-updates by swapping the raw .exe in-place, which is ugly but works. Proper fix: detect one-folder install and download a .zip instead.
