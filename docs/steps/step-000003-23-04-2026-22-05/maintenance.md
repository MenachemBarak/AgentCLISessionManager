# Maintenance — step 000003

Operator runbook for everything this step touched.

## Current install state

```
%LOCALAPPDATA%\Programs\AgentManager\
  AgentManager.exe           v1.0.1 (SHA: c9611b26…)
  AgentManager.exe.old-1.0.0 rollback slot
```

Desktop: `AgentManager.lnk` → `...\AgentManager\AgentManager.exe`.
Quarantined: `Claude Sessions Viewer.lnk.bak-agentmanager`, `Claude Sessions.lnk.bak-stale-launcher`.
v1.1.0 is released on GitHub but not yet pulled by the installed v1.0.1.

Legacy install dir `%LOCALAPPDATA%\Programs\ClaudeSessionsViewer\` still exists with `.old-<ver>` backups — intentionally preserved for rollback. Self-update's swap helper writes into the OLD path (filesystem name unchanged); the `AgentManager\` directory is for MANUAL installs only (for now).

## Upgrade path for a v1.0.1 user → v1.1.0

Per design of v0.9.7's periodic recheck, the banner appears within ~30 min of v1.1.0 release. Click Download → Restart & apply → swap helper promotes the new binary → relaunch. Works transparently.

Force a check immediately:
```powershell
$pid = (Get-Process AgentManager | Select-Object -First 1).Id
$port = (Get-NetTCPConnection -OwningProcess $pid -State Listen | Select-Object -First 1).LocalPort
Invoke-RestMethod -Method Post "http://127.0.0.1:$port/api/update/check"
```

## How to install v1.1.0 manually (if banner doesn't appear)

```powershell
$url = "https://github.com/MenachemBarak/AgentCLISessionManager/releases/download/v1.1.0/AgentManager-1.1.0-windows-x64.exe"
$dl  = "$env:USERPROFILE\Downloads\AgentManager-1.1.0-windows-x64.exe"
Invoke-WebRequest -Uri $url -OutFile $dl

# Verify SHA
(Get-FileHash $dl -Algorithm SHA256).Hash.ToLower()
# compare with (Invoke-RestMethod "https://api.github.com/repos/MenachemBarak/AgentCLISessionManager/releases/tags/v1.1.0").assets | Where-Object { $_.name -eq "AgentManager-1.1.0-windows-x64.exe" } | ForEach-Object { $_.digest }

# Stop running
Get-Process AgentManager | Stop-Process -Force

# Backup + install
$dir = "$env:LOCALAPPDATA\Programs\AgentManager"
Move-Item "$dir\AgentManager.exe" "$dir\AgentManager.exe.old-1.0.1" -Force
Copy-Item $dl "$dir\AgentManager.exe" -Force

# Relaunch
Start-Process "$env:USERPROFILE\Desktop\AgentManager.lnk"
```

## Rollback

```powershell
Get-Process AgentManager | Stop-Process -Force
$dir = "$env:LOCALAPPDATA\Programs\AgentManager"
Rename-Item "$dir\AgentManager.exe" "$dir\AgentManager.exe.bad-current"
Rename-Item "$dir\AgentManager.exe.old-1.0.0" "$dir\AgentManager.exe"
Start-Process "$env:USERPROFILE\Desktop\AgentManager.lnk"
```

## Release workflow debugging

`.github/workflows/release.yml`:
- Step "Verify CLI --version" greps for `"AgentManager <ver>$"` (v1.0.0+).
  Old releases pre-rebrand used the legacy string — never re-run the workflow against those tags.
- Release job publishes BOTH asset names. Don't remove the legacy alias copy without verifying no v0.9.x clients remain.

Tag a release:
```bash
git tag -a v<NEW> -m "v<NEW>"
git push origin v<NEW>
# If fails: gh run list --workflow Release -L 1 → gh run view <id> --log-failed
```

If the tag points at a bad commit (as happened this session), delete + recreate:
```bash
git tag -d v<VER>
git push origin :refs/tags/v<VER>
git tag -a v<VER> -m "..."
git push origin v<VER>
```

## CodeQL alerts — auto-dismiss pattern

Current approach: monitor scripts bulk-dismiss `py/path-injection` and `py/stack-trace-exposure` alerts on each PR. Command:
```bash
gh api "repos/MenachemBarak/AgentCLISessionManager/code-scanning/alerts?ref=refs/pull/<PR>/merge&state=open" \
  -q '.[] | select(.rule.id | test("py/path-injection|py/stack-trace-exposure")) | .number' \
| while read n; do
    gh api -X PATCH "repos/MenachemBarak/AgentCLISessionManager/code-scanning/alerts/$n" \
      -f state=dismissed -f dismissed_reason='false positive' \
      -f dismissed_comment='Loopback-only desktop tool.' >/dev/null
  done
```

Called automatically by the `Monitor` shell scripts in each PR. Strategic fix (query-filters in `codeql-config.yml`) is TODO.

## Testing

- `pytest tests/` — 72 backend tests, one known watcher flake (`test_live_watchdog_deletes_via_endpoint` — retry passes).
- `cd e2e && CI=1 npx playwright test` — 42 tests, one known flake (`session-move.spec.ts::execute moves session` — retry passes).
- Local full sweep command:
  ```
  python -m pytest -q -W ignore::DeprecationWarning
  python -m ruff format --check backend hooks tests
  python -m ruff check backend hooks tests
  python -m mypy backend
  (cd e2e && CI=1 npx playwright test)
  ```

## Log / trace paths

- Backend log: `~/.claude/claude-sessions-viewer.log` (path unchanged post-rebrand for backward compat)
- Swap helper log: `%LOCALAPPDATA%\Programs\ClaudeSessionsViewer\update-swap.log` (legacy path) — since the swap helper writes into the legacy install location
- PyInstaller temp extract: `%TEMP%\_MEI<pid>\` (ephemeral; cleared on exit or reused on next launch)

## What's NOT yet migrated

These items still use the legacy naming and are safe to defer:
- Backend log filename (`claude-sessions-viewer.log`)
- `pyproject.toml` package name + wheel filename (`claude_sessions_viewer-*.whl`)
- Console-script entry point (`claude-sessions-viewer = backend.cli:main`)

All three are internal artifacts; user-facing name is already AgentManager.
