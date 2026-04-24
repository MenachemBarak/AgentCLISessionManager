# Knowledge — step 000004

## Releases shipped this step

All published at https://github.com/MenachemBarak/agentclisessionmanager/releases

| Tag | Notable |
|-----|---------|
| v1.1.1 | Legacy-layout migration: persisted `{provider,sessionId}` tabs get migrated to shell-wrap shape on rehydrate |
| v1.2.0 | Inno Setup installer + opt-in daemon-split (`AGENTMANAGER_DAEMON=1`) |
| v1.2.1 | Smart-search wired in left pane |
| v1.2.2 | Ctrl+K command palette + installer switched to PyInstaller one-folder mode (no _MEI dialog) |
| v1.2.3 | Palette preview pane + Unicode tokenizer (Hebrew/Chinese/accented) |
| v1.2.4 | Palette recent searches |
| v1.2.5 | `GET /api/sessions/{sid}/transcript.md` export |
| v1.2.6 | Pin-to-top + copy-session-id |
| v1.2.7 | Session-list keyboard nav + Ctrl+F transcript find |

Release assets (every tag published 6 assets):
- `AgentManager-<ver>-setup.exe` — Inno Setup installer (since v1.2.0)
- `AgentManager-<ver>-windows-x64.exe` — raw one-file exe
- `claude-sessions-viewer-<ver>-windows-x64.exe` — legacy alias for v0.9.x auto-updater compat
- `claude-sessions-viewer-<ver>-windows.zip`
- `claude_sessions_viewer-<ver>-py3-none-any.whl`
- `claude_sessions_viewer-<ver>.tar.gz`

## PRs merged (#49 → #71, plus dependabot)

- **Hotfix**: #49 legacy-layout migration (v1.1.1)
- **ADR-18 daemon split**: #50 (Phase 1 failing tests + ADR), #51 (Phase 2 skeleton + /api/health), #52 (Phase 3a bootstrap + bearer auth), #53 (Phase 3b probe + --probe-daemon), #54 (Phase 3c launcher + frontend token injection), #55 (Phase 4 ring buffer + PTY REST), #56 (Phase 6 `--uninstall` CLI), #57 (Phase 5 WS reattach), #66 (Phase 7 stub endpoints)
- **Installer**: #58 (Inno Setup), #61 (one-folder mode)
- **Search**: #59 (smart-search backend), #60 (frontend wiring), #64 (Unicode fix)
- **Palette**: #62 (Ctrl+K shell), #63 (preview pane), #65 (recent queries)
- **Transcript**: #67 (markdown export), #68 (copy session id), #71 (Ctrl+F find)
- **Sessions UI**: #69 (pin-to-top), #70 (keyboard nav)
- **Dependabot merged**: #4, #5, #8, #9, #35
- **Still stuck rebasing**: #6, #10, #11

## Key endpoints added

- `GET /api/health` — cheap liveness (ADR-18 Phase 2)
- `POST /api/pty` / `POST /api/pty/{id}/write` / `GET /api/pty/{id}/replay` — PTY REST (Phase 4)
- `POST /api/shutdown` — graceful daemon shutdown (Phase 6)
- `POST /api/update/apply-ui-only` / `POST /api/update/apply-daemon` — 501 stubs (Phase 7)
- `GET /api/search?q=&limit=` — smart TF-weighted search (#40)
- `GET /api/sessions/{sid}/transcript.md` — markdown export (#67)
- `POST /api/sessions/{sid}/pin` — pin/unpin (#69)

## Key files created

### Daemon architecture
- `docs/design/adr-18-daemon-split.md`
- `daemon/__init__.py`, `daemon/__main__.py`, `daemon/bootstrap.py`, `daemon/launcher.py`, `daemon/uninstall.py`

### Frontend
- `backend/frontend/palette.jsx` — Ctrl+K command palette

### Config
- `pyinstaller-onedir.spec` — one-folder PyInstaller spec (installer consumes this)
- `installer/agentmanager.iss` — Inno Setup 6 installer script

### Test suites (new)
- `tests/test_daemon_phase3.py` / `phase3b.py` / `phase3c.py` / `phase4.py` / `phase6.py` / `phase7_stubs.py`
- `tests/test_search.py`, `tests/test_session_pin.py`, `tests/test_transcript_markdown.py`
- `e2e/tests/daemon/autostart-singleton.spec.ts` / `rehydrate.spec.ts` / `update.spec.ts` / `uninstall.spec.ts` / `crash.spec.ts`
- `e2e/tests/feature/legacy-layout-migration.spec.ts` / `smart-search.spec.ts` / `command-palette.spec.ts` / `transcript-export.spec.ts` / `transcript-copy-id.spec.ts` / `session-pin.spec.ts` / `session-list-keyboard.spec.ts` / `transcript-find.spec.ts`

## Useful commands

- Build the one-file exe: `pyinstaller pyinstaller.spec --noconfirm --clean`
- Build the one-folder tree: `pyinstaller pyinstaller-onedir.spec --noconfirm --clean`
- Build the installer (PowerShell, NOT bash — MSYS path-translates `/D` flags):
  ```pwsh
  iscc /Qp "/DMyAppVersion=1.2.7" "/DMyAppFolder=..\dist\AgentManager" installer\agentmanager.iss
  ```
- Run daemon: `python -m daemon` (opt-in via env, or default once v1.3.0 ships)
- Probe daemon: `python -m backend.cli --probe-daemon` — exit 0=ours, 1=absent, 3=other
- Uninstall: `AgentManager.exe --uninstall --yes`
- Lint gauntlet (must match CI):
  ```
  python -m ruff check backend hooks tests daemon
  python -m ruff format --check backend hooks tests daemon  # pinned to 0.7.4
  python -m mypy backend hooks daemon
  python -m bandit -c pyproject.toml -r backend hooks daemon
  ```

## Hard-learned gotchas (quick ref; see lessons-learned.md for deep dive)

- **Ruff version must match pre-commit** — pinned 0.7.4 in `.pre-commit-config.yaml`. Newer ruff formats differently.
- **Git-Bash path-translates `/D...`** — iscc with bash mangles Inno flags; always use pwsh.
- **Bandit B101 forbids `assert`** — use `typing.cast` for mypy narrowing.
- **Mypy sees Windows-only imports as unreachable on Linux CI** — `# type: ignore[unreachable]` on the try line + `[import-not-found,import-untyped]` on the imports.
- **`sys.platform == "win32"` guard narrows type** — CI (Linux) sees the win32 block as unreachable.

## Installer location

- Installed at `%LOCALAPPDATA%\Programs\AgentManager\AgentManager.exe` (both installer path and legacy raw-exe path)
- Daemon state (when enabled): `%LOCALAPPDATA%\AgentManager\` (separate from Programs dir)
  - `daemon.pid` (JSON: pid, startTimeEpoch, daemonVersion)
  - `token` (64-char hex bearer token, user-only ACL on Windows)
  - `layout-state.json`
- Labels + pins persist at `~/.claude/viewer-labels.json`

## ADR-18 three laws (locked in)

1. **INVISIBLE** — no tray icon, no console flash, no firewall prompt (loopback-only), no extra Start-menu entry for the daemon
2. **FULLY TESTABLE** — every invariant has a Playwright spec or unit test
3. **UNINSTALLABLE** — single `--uninstall` removes everything including orphan PTY grandchildren
