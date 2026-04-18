# Claude Sessions Viewer

Desktop-launchable web app that lists, previews, and resumes your Claude Code sessions on Windows.

## Install

```cmd
launcher\install-shortcut.bat
```

Creates a `Claude Sessions.lnk` on your Desktop. Double-click to run — first launch auto-creates a Python venv and installs deps; subsequent launches just open the browser.

## Features

- Lists all sessions from `~/.claude/projects/**/*.jsonl` (sub-agents filtered out)
- Active section: live-detects running sessions via `~/.claude/sessions/<pid>.json` + PID check
- Folder filter with per-folder Only/All/None; folders >1000 sessions auto-unchecked
- Hover preview of first 10 user messages per session
- Transcript pane for selected session
- Buttons: "New tab" / "Split" for idle sessions (spawns `wt.exe ... claude --resume <uuid>`); "Focus" for active sessions
- SSE live updates as new sessions are created/modified
- Progress bar while the initial index is being built

## Architecture

- **Backend:** FastAPI on `127.0.0.1:8765`. Scans JSONL files, serves `/api/sessions`, `/api/sessions/{id}/preview`, `/api/sessions/{id}/transcript`, `/api/focus`, `/api/open`, `/api/stream` (SSE), `/api/status`.
- **Frontend:** React 18 via Babel-standalone (no build step). Design imported from the Claude Design export.
- **Launcher:** `launcher/launch.bat` — auto-sets-up venv on first run, starts uvicorn hidden, opens browser.

## Requires

- Windows 11
- Python 3.10+ on PATH
- Windows Terminal (`wt.exe`) for tab-level open/focus

## License

Personal use.
