# Knowledge — step 000006 (29-04-2026)

## Project Identity

- **Name:** AgentCLISessionManager / AgentManager
- **Version in source:** `1.2.18` (`backend/__version__.py`)
- **Version installed on user machine:** `1.2.17` (exe at `%LOCALAPPDATA%\Programs\AgentManager\AgentManager.exe`, ~19.2 MB, dated Apr 25 02:48)
- **Repo root:** `C:\projects\agent-manager`
- **Old path (deprecated):** `M:\UserGlobalMemory\global-memory-plane\projects\claude-sessions-viewer`

## Architecture at a glance

| Layer | Tech |
|---|---|
| Backend | Python 3.x + FastAPI + uvicorn on `127.0.0.1:8765` |
| Frontend | React 18 + Babel-standalone (no build step), bundled in `backend/frontend/` |
| Desktop shell | pywebview window loading `http://127.0.0.1:8765` |
| Session source | `~/.claude/projects/**/*.jsonl` read via watchdog |
| PTY | `winpty` / `ptyprocess` via `backend/terminal.py` |
| Search | BM25-lite TF-weighted in `backend/search.py` |
| Tests | pytest (backend), Playwright (e2e) |

## Key file paths

| File | Purpose |
|---|---|
| `backend/app.py` | FastAPI server, 1964 lines, 62% coverage |
| `backend/__version__.py` | Single source of truth for version string |
| `backend/frontend/index.html` | Entry point; since v1.2.18 all CDN refs replaced with `vendor/` |
| `backend/frontend/vendor/` | Vendored offline deps: React 18, ReactDOM, Babel, xterm.js + addons |
| `backend/providers/claude_code.py` | Claude Code provider; `resume_command()` always includes `--dangerously-skip-permissions` |
| `backend/search.py` | BM25-lite search; 97% coverage; optional Claude SDK re-rank noted in line 16 comment |
| `backend/updater.py` | Self-update via GitHub Releases; 55% coverage (lines 191-263 untested) |
| `backend/terminal.py` | PTY management; 82% coverage |
| `backend/cli.py` | CLI entry; daemon mode at line 227 |
| `daemon/__main__.py` | ADR-18 daemon entry: `bootstrap()`, bearer token, uvicorn |
| `daemon/launcher.py` | `probe()`, `spawn_detached()`, `wait_for_health()` |
| `e2e/tests/feature/` | Playwright feature specs |
| `e2e/tests/daemon/` | 5 TDD stub specs (intentionally failing) for ADR-18 Phases 8-10 |
| `tickets.md` | Current backlog |
| `docs/design/adr-18-daemon-split.md` | Daemon architecture decision |
| `installer/agentmanager.iss` | Inno Setup installer script |
| `pyinstaller.spec` | One-file exe spec |
| `pyinstaller-onedir.spec` | One-folder exe spec |
| `hooks/session_start.py` | Claude Code hook script (SessionStart + UserPromptSubmit) |

## Claude Code hooks

Location: `~/.claude/settings.json`

Both `SessionStart` and `UserPromptSubmit` hooks run:
```
C:\projects\agent-manager\.venv\Scripts\python.exe C:\projects\agent-manager\hooks\session_start.py
```

(Fixed during this session — previously pointed to old M:\ path.)

## Test commands

```bash
# All backend unit tests
cd C:\projects\agent-manager
.venv\Scripts\python.exe -m pytest tests/ -v

# With coverage report
.venv\Scripts\python.exe -m pytest tests/ --cov=backend --cov-report=term-missing

# E2E (requires running server)
cd e2e && npx playwright test

# CI floor gate
pytest --cov-fail-under=55
```

## Coverage numbers (2026-04-29)

| Module | Coverage | Statements | Missing |
|---|---|---|---|
| `backend/app.py` | 62% | 1132 | 430 |
| `backend/updater.py` | 55% | 175 | 78 |
| `backend/terminal.py` | 82% | 202 | 36 |
| `backend/cli.py` | 82% | 145 | 26 |
| `backend/move_session.py` | 80% | 95 | 19 |
| `backend/providers/base.py` | 86% | — | — |
| `backend/providers/claude_code.py` | 95% | 342 | 18 |
| `backend/search.py` | 97% | — | — |
| **TOTAL (Windows)** | **72%** | 2235 | 616 |

CI gate: `--cov-fail-under=55` (Linux runner); Windows naturally higher.

## Install method for this user machine

User's machine has a **raw-exe swap chain** (not Inno-managed):
- Exe at: `%LOCALAPPDATA%\Programs\AgentManager\AgentManager.exe`
- No `unins000.exe` present
- To update: direct file swap, NOT the installer
- Check for `unins000.exe` before any install to confirm approach

## GitHub Releases / self-update

- Tags format: `vX.Y.Z`
- Tags are immutable — if release fails, bump and re-tag
- `backend/updater.py` handles download/SHA-verify/swap at lines 191-263

## Port / network

- Backend: `127.0.0.1:8765`
- Daemon mode (ADR-18): same port, different process — daemon holds port, UI connects

## Environment variables

| Variable | Purpose |
|---|---|
| `AGENTMANAGER_DAEMON=1` | Opt-in daemon/UI split mode (ADR-18) |
| `ANTHROPIC_API_KEY` | Optional; enables Claude SDK re-rank in search (not yet implemented) |

## v1.2.18 changes (last commit on branch)

- Replaced all CDN links in `backend/frontend/index.html` with `vendor/` relative paths
- Added `backend/frontend/vendor/` (~4.5 MB): React 18, ReactDOM, Babel, xterm.js + addons
- Dropped Google Fonts CDN link
- Fixes black-window on launch when DNS/internet is unreachable

## Known tech debt

- `@app.on_event` deprecated in FastAPI 0.136 — lines 584 + 1851 of `backend/app.py` should migrate to `lifespan` context manager (30 warnings in every test run)
- Task #40 optional Claude SDK re-rank: code comment at `search.py` line 16 marks it as future PR
