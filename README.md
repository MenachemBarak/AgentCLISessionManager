# AgentCLISessionManager — Claude Sessions Viewer

[![CI](https://github.com/MenachemBarak/AgentCLISessionManager/actions/workflows/ci.yml/badge.svg)](https://github.com/MenachemBarak/AgentCLISessionManager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Desktop-launchable web UI that lists, previews, and resumes your [Claude Code](https://claude.com/claude-code)
sessions on Windows. Reads sessions directly from `~/.claude/projects/**/*.jsonl` — no API tokens,
no cloud round-trip.

## Features

- **Discovery** — lists every Claude Code session on the machine (sub-agent files filtered out)
- **Live** — SSE watcher surfaces new/updated sessions as they happen
- **Active** — detects currently-running sessions via `~/.claude/sessions/<pid>.json` + PID check
- **Resume** — "New tab" / "Split" buttons spawn `wt.exe ... claude --resume <uuid>`
- **Focus** — for active sessions, a `Focus` button switches the exact Windows Terminal tab to the front
  (UI Automation + OSC-0 title stamping via a Claude Code hook)
- **Folder filter** — per-project-folder checkboxes with *Only* / *All* / *None*; folders >1000 sessions auto-unchecked
- **Hover preview** — shows the first 10 user messages of any session
- **Inline rename** — click any session title to set a custom label, persisted in `~/.claude/viewer-labels.json`
- **Reads Claude's rename** — shows titles set via `/rename` inside Claude Code (`custom-title` JSONL entries)

## Install (Windows)

```cmd
git clone https://github.com/MenachemBarak/AgentCLISessionManager.git
cd AgentCLISessionManager
launcher\install-shortcut.bat
```

Creates a `Claude Sessions.lnk` on your Desktop. First double-click auto-creates a venv and
installs deps; subsequent launches just open the browser at `http://127.0.0.1:8765`.

## Requirements

- **Windows 11** (core focus; the backend runs on Linux/mac but `open`/`focus` are no-ops there)
- **Python 3.10+** on PATH
- **Windows Terminal** (`wt.exe`) for tab-level open/focus

## Architecture

| Layer       | Stack                                                          |
|-------------|----------------------------------------------------------------|
| Backend     | FastAPI + uvicorn on `127.0.0.1:8765`                          |
| Frontend    | React 18 via Babel-standalone (no build step)                  |
| Live feed   | `sse-starlette` + `watchdog` on `~/.claude/projects`           |
| Focus path  | `uiautomation` → OSC-0 tab titles stamped by SessionStart hook |
| Storage     | User labels: `~/.claude/viewer-labels.json`                    |

Key endpoints: `/api/sessions`, `/api/sessions/{id}/preview`, `/api/sessions/{id}/transcript`,
`/api/sessions/{id}/label` (GET/PUT), `/api/open`, `/api/focus`, `/api/status`, `/api/stream` (SSE),
`/api/hook/{install,uninstall,status}`.

## Configuration

| Env var       | Purpose                                                      | Default           |
|---------------|--------------------------------------------------------------|-------------------|
| `CLAUDE_HOME` | Override the `~/.claude` directory (tests / portable installs) | `~/.claude`     |
| `VIEWER_URL`  | Used by tests to target a non-default host/port              | `http://127.0.0.1:8765/` |

## Development

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r backend/requirements.txt
.venv/Scripts/python -m pip install pytest httpx ruff

# Run the full CI suite locally (no Claude Code install needed — uses fixtures):
.venv/Scripts/python -m pytest
.venv/Scripts/python -m ruff check backend hooks tests
.venv/Scripts/python -m ruff format --check backend hooks tests

# Start the server:
.venv/Scripts/python -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8765
```

## Testing strategy

Unit/integration tests use a **mocked `CLAUDE_HOME`** fixture (`tests/fixtures/claude-home/`) with
two sample JSONL sessions plus a sub-agent file that must be filtered out. This means:

- **Zero dependency on a real Claude Code install** — tests run in GitHub Actions on Ubuntu
- **No tokens, no API calls** — every test is hermetic
- **Full endpoint coverage** — status, list, preview, transcript, label roundtrip, hook stamping

Playwright end-to-end tests (`tests/test_user_label_flow.py`, `tests/visual_check.py`) are kept
local-only — they require a running viewer + Chrome and are excluded from the default pytest run.

## License

[MIT](LICENSE)
