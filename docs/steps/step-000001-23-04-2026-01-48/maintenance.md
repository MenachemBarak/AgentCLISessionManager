# Maintenance — step 000001

Operator runbook for the self-update + e2e surface touched this step.

## Health check

```bash
# pick the app's listening port (varies per launch — stored on a random port)
powershell -Command "Get-Process claude-sessions-viewer | ForEach-Object { Get-NetTCPConnection -OwningProcess $_.Id -State Listen -ErrorAction SilentlyContinue }"

# then
curl -s http://127.0.0.1:<port>/api/status
# expect: {"version":"0.9.2","ready":true,"done":<N>,"total":<N>,"phase":"ready"}
```

If `/api/status` returns 200 but the UI is black, **do not trust ready=true** — see `lessons-learned.md::L-01`. Always also verify the DOM:
```javascript
document.getElementById('root')?.children.length > 0
```

## Logs

| Purpose | Path |
|---|---|
| App runtime log | `~/.claude/claude-sessions-viewer.log` |
| Update-swap helper log | `<install-dir>\update-swap.log` |
| Playwright HTML report (local) | `e2e/playwright-report/index.html` |
| Playwright traces on failure | `e2e/test-results/<test-id>/trace.zip` (open with `npx playwright show-trace <file>`) |

## Running tests

### Backend (pytest)

```bash
cd M:\UserGlobalMemory\global-memory-plane\projects\claude-sessions-viewer
python -m pytest -q -W ignore::DeprecationWarning
# 61 tests expected green
```

### E2E (Playwright vs dev server)

```bash
cd e2e
npm ci
npx playwright install chromium    # first time
npx playwright test                 # webServer spawns python -m backend.cli automatically
```

### E2E against the built exe

```bash
# terminal 1
$env:CSV_TEST_MODE="1"
$env:CLAUDE_HOME="<repo>\tests\fixtures\claude-home"
.\dist\claude-sessions-viewer.exe --server-only --port 8769 --no-browser

# terminal 2
$env:CSV_APP_URL="http://127.0.0.1:8769"
cd e2e
npx playwright test
```

## Env vars

| Var | Purpose | When to set |
|---|---|---|
| `CSV_TEST_MODE=1` | Enables `/api/_test/seed-update-state` hook | Test runs only. **Never in production.** |
| `CSV_APP_URL` | Points Playwright at an already-running server | CI `e2e (built exe)` job |
| `CLAUDE_HOME` | Override `~/.claude` for hermetic runs | Pytest + Playwright |
| `PYTHONIOENCODING=utf-8` | Prevents stdout encoding issues on Windows | Always in CI |

## Rolling back a release

The install directory keeps every prior version as `<exe>.old-<ver>` or `<exe>.prev-<ver>`. To roll back:

```powershell
$dir = "$env:LOCALAPPDATA\Programs\ClaudeSessionsViewer"
Get-Process claude-sessions-viewer -ErrorAction SilentlyContinue | Stop-Process -Force
Rename-Item "$dir\claude-sessions-viewer.exe" "$dir\claude-sessions-viewer.exe.bad-current"
Rename-Item "$dir\claude-sessions-viewer.exe.old-0.9.1" "$dir\claude-sessions-viewer.exe"   # or any prior .old-*
Start-Process "$env:USERPROFILE\Desktop\Claude Sessions Viewer.lnk"
```

## Known currently-broken things

- **v0.9.1 users cannot self-update cleanly** to v0.9.2 via the UI. The bundled helper hangs (see `lessons-learned.md::L-08`). Manual swap required **once**; v0.9.2 → v0.9.3+ works normally. Document this in v0.9.2 release notes if not already.

- **PyInstaller exe second-launch race** (observed once in this step, recovered): immediately after a swap, the relaunched exe took ~15s to bind its port instead of the usual 2s. Likely Windows Defender scanning the freshly-renamed binary. No action needed — mention in troubleshooting docs if it becomes common.

## Monitoring touchpoints

- CI rollup at https://github.com/MenachemBarak/AgentCLISessionManager/pulls
- CodeQL alerts at https://github.com/MenachemBarak/AgentCLISessionManager/security/code-scanning
  - Two `py/path-injection` alerts on `backend/app.py` lines 1283-1284 dismissed as won't-fix — loopback WS, cwd Path.resolve()+is_dir() validated.

## How to deploy a new release

1. Merge PR into `main` with CI green (14 checks: tests matrix + lint + pre-commit + pip-audit + bandit + CodeQL + e2e-dev + e2e-exe + auto-merge).
2. Bump `backend/__version__.py`.
3. Update `CHANGELOG.md` (add new section under `## [Unreleased]`).
4. Tag: `git tag -a vX.Y.Z -m "..."` then `git push origin vX.Y.Z`.
5. Monitor the `Release` workflow — it produces 4 assets (wheel, sdist, zip, exe) with SHA-256 digests published on the release.
6. Running app users' next background update check (fires at startup) will see the new version.
