# Knowledge — step 000001

Reference material gathered in this window.

## Releases shipped

| Version | Tag | Key change | Release URL (GitHub) |
|---|---|---|---|
| v0.9.0 | `v0.9.0` | UI banner + one-click Restart & apply swap | https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.9.0 |
| v0.9.1 | `v0.9.1` | TileTree hardening + Playwright e2e (dev server + built exe) | https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.9.1 |
| v0.9.2 | `v0.9.2` | Swap helper: rename-attempt loop, no `tasklist \| find` | https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.9.2 |

Currently installed on this machine: **v0.9.2** at `C:\Users\User\AppData\Local\Programs\ClaudeSessionsViewer\claude-sessions-viewer.exe`. Listening port on last launch: `55242`.

## PRs in this window

- **#32** (merged) — Self-update backend + banner (v0.9.0). https://github.com/MenachemBarak/AgentCLISessionManager/pull/32
- **#33** (merged) — TileTree + Playwright + CI jobs (v0.9.1). https://github.com/MenachemBarak/AgentCLISessionManager/pull/33
- **#34** (merged) — Swap helper rename-loop (v0.9.2). https://github.com/MenachemBarak/AgentCLISessionManager/pull/34

## Playwright layout (shipped in v0.9.1)

```
e2e/
├── pages/
│   ├── windowChrome.ts       # read version, openTweaks
│   ├── sessionList.ts        # rows, count, clickFirst, clickInViewerForRow, waitReady
│   └── updateBanner.ts       # root, isVisible, seedUpdateAvailable, snapshot, clickDownload, clickRestartApply
├── tests/feature/
│   ├── app-boots.spec.ts     # regression test for v0.9.0 black-screen
│   └── update-flow.spec.ts   # hidden → available → staged → apply-guard
├── playwright.config.ts      # webServer vs CSV_APP_URL, CLAUDE_HOME=tests/fixtures/claude-home
└── README.md
```

Running locally:
```bash
cd e2e
npm ci
npx playwright install chromium
npx playwright test                       # dev server
CSV_APP_URL=http://127.0.0.1:8769 npx playwright test   # against a live exe
```

Test-only backend hook (gated by `CSV_TEST_MODE=1`):
```
POST /api/_test/seed-update-state
Body: {"latestVersion": "X.Y.Z", "checked": true, "staged": false}
```

## CI jobs

Workflow file: `.github/workflows/e2e.yml`

- **`e2e (dev server)`** — `python -m backend.cli --server-only --port 8769 --no-browser` + Playwright. ~3 min.
- **`e2e (built exe)`** — builds PyInstaller exe, launches it **and runs Playwright in the same step** (critical — separate steps orphan the child on GH runners), with stdout/stderr/app-log dumping on failure.

## Self-update internals

- `GET /api/update-status` — snapshot of `UpdateState` (current, latest, updateAvailable, downloadProgress, staged, error).
- `POST /api/update/download` — stages `<exe>.new` with SHA-256 verification against published asset digest.
- `POST /api/update/apply` — spawns the swap helper `.cmd` detached, then `os._exit(0)` ~800 ms later.

### v0.9.2 swap helper (rename-attempt)

Script template lives at `backend/updater.py::_windows_swap_script`. Key property: the wait loop does NOT poll `tasklist`. Instead:

```cmd
:wait
if exist "<exe>.old" del /F /Q "<exe>.old" >nul 2>&1
ren "<exe>" "<exe.name>.old" >nul 2>&1
if %ERRORLEVEL%==0 goto swap
set /A ATTEMPT=ATTEMPT+1
if %ATTEMPT% GEQ 60 ( echo gave up; exit /B 3 )
timeout /T 1 /NOBREAK >nul
goto wait
```

Windows' exclusive image-file lock is the readiness signal — `ren` fails while the exe is alive, succeeds the instant it exits. 60s cap.

## Persisted state files

- `~/.claude/viewer-terminal-state.json` — layout persistence. **Poisoned state found** during this session (`kind:"leaf"` — the probe wrote it earlier). Quarantined as `.corrupt-by-probe` and `.corrupt-repeat`. v0.9.1 hardens against this class of corruption.
- `~/.claude/claude-sessions-viewer.log` — app log.
- `<install-dir>\update-swap.log` — helper log: attempt counter + swap + relaunch.

## Install dir current state

`C:\Users\User\AppData\Local\Programs\ClaudeSessionsViewer\`:
- `claude-sessions-viewer.exe` — v0.9.2 (19122224 bytes)
- `claude-sessions-viewer.exe.old-0.9.1`
- `claude-sessions-viewer.exe.old-0.9.0`
- `claude-sessions-viewer.exe.old-0.8.1`
- `claude-sessions-viewer.exe.prev-0.8.0`
- `claude-sessions-viewer.exe.prev-0.7.1`
- `update-swap.log`

Desktop shortcut: `C:\Users\User\Desktop\Claude Sessions Viewer.lnk` → installed exe.

## New tasks filed during this window

- **#39** — Terminal tab focus → left-pane highlight
- **#40** — Smart session research (Claude SDK, natural-language)
- **#41 HIGH** — Auto-ping "SOFTWARE RESTARTED - GO ON FROM WHERE YOU LEFT OFF" on viewer restart

## New durable requirement (this step's args)

**Every** `claude --resume <uuid>` the viewer spawns must include `--dangerously-skip-permissions`. Applies to:
- "In viewer" button (existing PTY resume path)
- External `wt.exe` launch path
- Future auto-ping flow (task #41)

Provider source: `backend/providers/claude_code.py::resume_command(sid)`.
