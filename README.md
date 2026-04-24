# AgentCLISessionManager — Claude Sessions Viewer

[![CI](https://github.com/MenachemBarak/AgentCLISessionManager/actions/workflows/ci.yml/badge.svg)](https://github.com/MenachemBarak/AgentCLISessionManager/actions/workflows/ci.yml)
[![Security](https://github.com/MenachemBarak/AgentCLISessionManager/actions/workflows/security.yml/badge.svg)](https://github.com/MenachemBarak/AgentCLISessionManager/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![Checked with mypy](https://img.shields.io/badge/mypy-strict-blue.svg)](http://mypy-lang.org/)
[![Ruff](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json)](https://github.com/astral-sh/ruff)

Desktop-launchable web UI that lists, previews, and resumes your [Claude Code](https://claude.com/claude-code)
sessions on Windows. Reads sessions directly from `~/.claude/projects/**/*.jsonl` — no API tokens,
no cloud round-trip.

## Screenshots

> Captured against the synthetic `tests/fixtures/claude-home` fixture —
> regenerate any time with `python scripts/capture_demo_screenshots.py`.

![Main view](docs/screenshots/main.png)

<details>
<summary>More views</summary>

**Hover preview** — peek at the first user messages of any session without opening it:

![Hover preview](docs/screenshots/hover-preview.png)

**Transcript** — click a session to read its history side-by-side:

![Transcript](docs/screenshots/transcript.png)

</details>

## Features

### Finding sessions
- **Discovery** — lists every Claude Code session on the machine (sub-agent files filtered out)
- **Live** — SSE watcher surfaces new/updated sessions as they happen
- **Active** — detects currently-running sessions via `~/.claude/sessions/<pid>.json` + PID check
- **Smart search** (v1.2.0+) — type 2+ words in the left-pane search box to get TF-weighted
  ranked results instead of a substring match. Works with Hebrew, Chinese, accented Latin (v1.2.3+).
- **Ctrl+K command palette** (v1.2.2+) — jump to any session by natural-language query;
  arrow-key nav; preview pane shows first user messages + cwd + branch; remembers your
  last 5 searches.
- **Folder filter** — per-project-folder checkboxes with *Only* / *All* / *None*; folders
  >1000 sessions auto-unchecked
- **Pin to top** (v1.2.6+) — ☆ on row hover → session floats above everything regardless
  of recency. Persisted across restarts.
- **`/` focus search · ↑↓ nav · Enter open · Esc clear** — keyboard-only workflow (v1.2.7+)
- **`?` shows all shortcuts** (v1.2.10+) — every keybinding discoverable at a glance

### Working with sessions
- **Embedded terminals** (v0.7+) — spawn `claude --resume <sid>` right in the app
  without launching Windows Terminal. Splits, tabs, and persistent layout across restarts.
- **Graceful `/exit`** (v1.1.0+) — session tabs shell-wrap claude so `/exit` drops to
  a shell prompt instead of killing the tab.
- **Focus** — for active sessions, a `Focus` button switches the exact Windows Terminal tab
  to the front (UI Automation + OSC-0 title stamping via a Claude Code hook)
- **Inline rename** — click any session title to set a custom label, persisted in
  `~/.claude/viewer-labels.json`
- **Reads Claude's rename** — shows titles set via `/rename` inside Claude Code
  (`custom-title` JSONL entries)
- **Move session between projects** — drag-safe `POST /api/sessions/{sid}/move` with
  copy-verify-unlink + SHA-256 (v0.9.9+)

### Transcript
- **Hover preview** — shows the first 10 user messages of any session
- **Full transcript** in the right pane, auto-scrolled to latest on open
- **Ctrl+F find-in-transcript** (v1.2.7+) — live highlighting, match counter, Enter
  cycles, Shift+Enter backwards
- **Copy session ID** — click the UUID chip in the header (v1.2.6+)
- **Copy message content** — hover any message, click the `copy` button (v1.2.9+)
- **Export as markdown** — `↓ .md` button downloads `session-<id>.md` with
  title + metadata + role headings + ISO-8601 timestamps (v1.2.5+)

### Operations
- **Self-update** (v0.8.0+) — built-in banner checks GitHub Releases and offers
  "Restart & apply" swap-helper flow
- **Proper installer** (v1.2.0+) — `AgentManager-<ver>-setup.exe` gives you an
  Add/Remove Programs entry, silent-install support (`/VERYSILENT`), and a clean
  uninstall path (via `--uninstall` CLI) that kills the daemon + PTY grandchildren
- **`--uninstall` CLI** (v1.2.0+) — single entry point removes state dir, shortcuts,
  daemon, registry entries
- **Opt-in daemon split** (v1.2.0+) — set `AGENTMANAGER_DAEMON=1` for an
  experimental PTY-owning daemon + pywebview UI shim. Default-on planned for v1.3.0
  (ADR-18)

## Install

Pick whichever fits. All four install paths are built and verified by the
[release workflow](.github/workflows/release.yml) on every tagged release.

### 1. Installer (recommended — Add/Remove Programs entry)

Download **`AgentManager-<ver>-setup.exe`** from the
[Releases page](https://github.com/MenachemBarak/AgentCLISessionManager/releases/latest)
and run it. Standard Windows Next/Next/Finish installer; per-user (no UAC prompt);
installs to `%LOCALAPPDATA%\Programs\AgentManager\`; appears in Add/Remove Programs.

Silent install for scripting:
```cmd
AgentManager-X.Y.Z-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

Uninstall via Add/Remove Programs → AgentManager, or from the command line:
```cmd
AgentManager.exe --uninstall --yes
```
Uninstallation stops any running daemon + walks the PTY tree to kill orphaned
children; removes state dir + shortcuts + registry entries.

### 2. Raw .exe (auto-update back-compat path)

Download `AgentManager-<ver>-windows-x64.exe` from the same page and double-click.
Single-file PyInstaller exe, no install wizard. Also covers the `claude-sessions-viewer-<ver>-windows-x64.exe`
legacy filename for users who installed prior to the v1.0.0 rebrand — the release
publishes both so your existing auto-updater keeps working.

Requires Edge WebView2, which ships pre-installed on every Windows 11 machine.

### 2. `pipx` (recommended for CLI use)

```bash
pipx install git+https://github.com/MenachemBarak/AgentCLISessionManager.git@v1.2.15
claude-sessions-viewer
```

Once on PyPI:

```bash
pipx install claude-sessions-viewer
claude-sessions-viewer --help
```

`claude-sessions-viewer` accepts `--host`, `--port`, `--server-only`,
`--no-browser`, `--log-level`, and `--version`. Default mode opens a native
desktop window; `--server-only` runs headless and opens your browser.

### 3. Windows zip (source + launcher shortcut)

Download `claude-sessions-viewer-<ver>-windows.zip` from the
[Releases page](https://github.com/MenachemBarak/AgentCLISessionManager/releases),
extract, then:

```cmd
launcher\install-shortcut.bat
```

Creates a `Claude Sessions.lnk` on your Desktop. First double-click auto-creates
a venv and installs deps; subsequent launches just open the browser at
`http://127.0.0.1:8765`.

### 4. From source (for contributors)

```bash
git clone https://github.com/MenachemBarak/AgentCLISessionManager.git
cd AgentCLISessionManager
python -m venv .venv
.venv/Scripts/python -m pip install -e .
claude-sessions-viewer
```

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

## Production hardening

| Check                  | Tool                              | Cadence                       |
|------------------------|-----------------------------------|-------------------------------|
| Lint                   | ruff                              | pre-commit + CI               |
| Format                 | ruff-format                       | pre-commit + CI               |
| Type-check             | mypy (strict-ish)                 | pre-commit + CI               |
| SAST                   | bandit                            | pre-commit + CI + weekly cron |
| CVE scan (Python deps) | pip-audit                         | CI + weekly cron              |
| Code scanning          | GitHub CodeQL (security-and-quality) | CI + weekly cron           |
| Dep freshness          | Dependabot (pip + actions)        | weekly                        |
| Auto-merge fixes       | `.github/workflows/dependabot-auto-merge.yml` | on every Dependabot PR (security + patch only, after CI green) |

See [`SECURITY.md`](SECURITY.md) for vulnerability disclosure and
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the dev loop.

## Docs for contributors & AI agents

| Doc | When to read it |
|---|---|
| [`AGENTS.md`](AGENTS.md) | You're (or your AI assistant is) picking up this repo cold — **start here** |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Why code is structured the way it is; design decisions |
| [`docs/RELEASE.md`](docs/RELEASE.md) | Cutting a new tagged release (step-by-step) |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Something is broken — quick fixes for users and devs |
| [`CHANGELOG.md`](CHANGELOG.md) | What shipped in each version |
| [`SECURITY.md`](SECURITY.md) | Disclosure policy + audit notes |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to open a PR that passes CI |

## License

[MIT](LICENSE)
