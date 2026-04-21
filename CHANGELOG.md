# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] — 2026-04-21

### Added
- **Resume sessions inside the viewer** — every idle session row gets a new
  "In viewer" button next to "New tab" / "Split". Clicking it spawns an
  embedded terminal tab running `claude --resume <uuid>` via the
  provider-mediated PTY WebSocket — no Windows Terminal round-trip.
  Tab label is the session's user label / Claude-set title / a fallback
  `Resume <sid8>`.
- **Tmux-style splits** (from v0.6.1 WIP, now shipped together):
  - Recursive tile tree per terminal tab. `Alt+Shift+H` splits right,
    `Alt+Shift+V` splits down, `Alt+Shift+X` closes the focused pane,
    drag a divider to resize. Matching toolbar buttons in the tab bar.
  - **Persistent panes** — hidden tabs use `display:none` instead of
    unmounting, so every xterm viewport + PTY WebSocket stays alive when
    you switch tabs. Kills the remount limitation documented in v0.6.0.
- **Multiple terminal tabs** — `+` button spawns a new terminal tab,
  `×` per tab closes it, `Ctrl+Shift+T` / `Ctrl+W` keyboard shortcuts.
  Each tab owns its own tile tree.

### Notes
- The resume path uses the backend's strict allow-list: only
  `provider.resume_command(sid)` can construct argv (no free-form shell).
  Codex / Copilot CLI / Gemini CLI adapters will just work here once
  their providers land — the frontend button is provider-agnostic.
- External Windows Terminal control (`/api/open`, `/api/focus`) unchanged.
  Both paths coexist: the user picks per session.

## [0.6.0] — 2026-04-21

### Added
- **Embedded terminal** — right pane now has a `Transcript | Terminal` tab
  switch. Clicking **Terminal** mounts an xterm.js pane wired to a real
  PTY on the server; type into the viewport and you're talking to a live
  `cmd.exe`. No round-trip to Windows Terminal.
  - **Backend** — new `/api/pty/ws` WebSocket speaking a tiny JSON
    protocol (`spawn`/`input`/`resize` → `ready`/`output`/`exit`/`error`),
    backed by `pywinpty` (Windows, ConPTY) or `ptyprocess` (posix). Strict
    allow-listing of `argv[0]` + provider-mediated routing — no free-form
    shell execution exposed on the loopback socket.
  - **Frontend** — xterm@5.5.0 + addon-fit + addon-web-links loaded via
    CDN (same pattern as React/Babel — still no build step). New
    `TerminalPane` component owns one PTY; `ResizeObserver` keeps server
    PTY dimensions synced with the DOM viewport.
- 11 new backend tests (`tests/test_terminal.py`) covering pure utilities,
  real PTY spawn/read/write/close, and the full WebSocket protocol via
  FastAPI `TestClient`. Now 56/56 total pass.

### Notes
- This release ships the single-pane cut; tab bar and tmux-style splits
  will land in subsequent patch releases (0.6.1+), same branch flow.
- External Windows Terminal control (`/api/open`, `/api/focus`) is
  unchanged — both paths coexist.

## [0.5.0] — 2026-04-20

### Added
- **Multi-provider architecture** — new `backend/providers/` package introduces
  a `SessionProvider` protocol and a `PROVIDERS` registry. Today only
  `ClaudeCodeProvider` is implemented; adding Codex, GitHub Copilot CLI,
  Gemini CLI (etc.) is now a matter of dropping a new file in the package
  and registering its id — no FastAPI / frontend changes required.
- `GET /api/providers` — lists every registered provider with
  `{id, displayName, available}` so the UI can render a per-provider filter
  once more than one adapter exists.
- Every row returned by `/api/sessions` and `/api/sessions/<id>/preview`
  now carries a `"provider"` field (`"claude-code"` for now) — the frontend
  uses this to route follow-up calls through the correct adapter.
- `tests/test_providers.py` — 12 tests cover: registry shape, protocol
  conformance, graceful skip when a provider's `__init__` raises
  `ProviderUnavailable`, discover + preview + transcript against the mock
  fixture, and the new `/api/providers` endpoint.

### Changed
- Conftest fixtures (`tests/conftest.py`, `tests/test_watcher.py`) no longer
  purge the entire `backend.*` subtree when reloading the app — only
  `backend.app` itself — to preserve the identity of
  `backend.providers.ProviderUnavailable` across test runs.

### Notes
No behaviour change for Claude Code users — this release lays the foundation
for the upcoming embedded terminal (tmux-style tabs + splits) and broader
agent-CLI support. Existing endpoints and UI work identically.

## [0.4.2] — 2026-04-20

### Fixed
- **Deleted sessions now disappear from the UI** — the watchdog observer
  previously only handled `on_created` and `on_modified`, so when JSONL files
  were removed from disk (by the user, by `rm`, or by the viewer's own
  cleanup) the in-memory `_INDEX` kept ghost entries until a process restart.
  `_Watcher` now implements `on_deleted` (single file) and a bulk-evict path
  for directory deletions, plus `on_moved` for renames (evict source +
  upsert destination).
- New `session_deleted` SSE event type. Frontend `data.jsx` removes the row
  from its in-memory list; `app.jsx` re-selects another session if the
  deleted one was the active selection.

### Added
- `_is_indexable_session_path(Path) -> bool` — shared predicate so the
  initial scan (`_all_jsonl`) and the live watcher agree exactly on what
  counts as a session.
- `tests/test_watcher.py` — 13 tests across three layers: pure predicate,
  direct method calls with synthetic events, and end-to-end with a real
  `watchdog.observers.Observer` against a fresh `CLAUDE_HOME` tmpdir.

## [0.4.1] — 2026-04-19

### Fixed
- Release workflow verify job: use `--server-only` on the Linux runner
  since headless CI has no GTK/Qt to back pywebview. The v0.4.0 build
  produced correct wheel/sdist/zip/exe artifacts but the verify job
  crashed when invoking `webview.start()` on a display-less Linux runner,
  which skipped the release publication step.

## [0.4.0] — 2026-04-19

### Added
- **Native desktop app** — `claude-sessions-viewer` now opens a real OS window
  (Edge WebView2 on Windows, WebKit on macOS, WebKitGTK on Linux) around the
  React UI via [pywebview](https://pywebview.flow.io/). No browser tab, no
  terminal window — double-click and you get a proper app.
- **Windows x64 `.exe` release asset** — built with PyInstaller as a single
  self-contained file. No Python install required on the user's machine.
  Attached to every GitHub Release as
  `claude-sessions-viewer-<ver>-windows-x64.exe`.
- `--server-only` flag preserves the classic "run uvicorn, open a browser"
  behavior for headless use / remote access.

### Changed
- Default `--port` is now `0` (pick a free port) in desktop mode, since the
  user doesn't see the URL anyway. Server-only mode still defaults to 8765.
- `pywebview>=5.3` is now a core runtime dep.

## [0.3.2] — 2026-04-19

### Fixed
- Release workflow: changelog extractor now uses a Python snippet instead of
  awk so bracketed headers (e.g. `## [0.3.2]`) aren't parsed as regex
  character classes. v0.3.1 build+verify succeeded but release-notes step
  produced an empty file.

## [0.3.1] — 2026-04-19

### Fixed
- Release workflow: bump twine to `>=6.1.0` so it recognizes Metadata-Version 2.4
  emitted by modern setuptools. The v0.3.0 tag was pushed but its release workflow
  failed at the twine-check step, so v0.3.1 is the first successfully published
  release of the 0.3 series.

## [0.3.0] — 2026-04-19

### Added
- `pipx install`-compatible packaging — `claude-sessions-viewer` CLI entry point
- `backend/__version__.py` as single source of version truth; exposed at `/api/status`
- `MANIFEST.in` + `[tool.setuptools]` config so the wheel ships `backend/frontend/`
  and `hooks/` self-contained
- `.github/workflows/release.yml` — on `v*` tag push: builds wheel + sdist +
  Windows zip, creates a GitHub Release with all three as assets
- `release-verify` CI job that installs the built wheel in a fresh venv and
  smoke-tests `--version` + `/api/status` against the mock fixture
- `CHANGELOG.md` (this file) — Keep-a-Changelog style

### Changed
- `frontend/` moved to `backend/frontend/` so it ships inside the wheel. Dev
  behavior unchanged since `app.py` looks up `FRONTEND_DIR` relative to its own
  location.
- `pyproject.toml` — dynamic version via `backend.__version__.__version__`;
  runtime dependencies declared here (previously only in `backend/requirements.txt`)

## [0.2.0] — 2026-04-19

### Added
- Production hardening PR (#2):
  - Pre-commit hooks: ruff, ruff-format, mypy, bandit + stdlib hygiene
  - CVE scanning: pip-audit + bandit + CodeQL (on push/PR + weekly cron)
  - Dependabot weekly PRs for pip + github-actions
  - Dependabot auto-merge workflow for security/patch updates
  - Full type annotations; mypy clean with `disallow_untyped_defs`
  - Demo screenshots in `docs/screenshots/` (synthetic, no PII) + generator script
  - `SECURITY.md` (disclosure policy, hardening notes)
  - `CONTRIBUTING.md` (dev loop, PR checklist)

### Security
- Bump `fastapi` to 0.136.0 and floor-pin `starlette>=0.48.0` to close
  `GHSA-f96h-pmfr-66vw` and `GHSA-2c2j-9gv5-cj73` (caught by pip-audit)
- Harden `/api/open` against command injection (CWE-78): strict UUID validation
  of `sessionId`, enum validation of `mode`, pathlib canonicalization of `cwd`;
  removed the vulnerable `cmd.exe /k` fallback

## [0.1.5] — 2026-04-19

### Added
- Read Claude's `/rename` session titles (`custom-title` JSONL entries) from
  the tail of each session file; exposed as `claudeTitle` on `/api/sessions`

### Fixed
- Hebrew / non-ASCII session titles now display correctly

## [0.1.4] — 2026-04-19

### Fixed
- Inline label save: UI now updates in place without requiring a page reload
- Playwright e2e test covers the full label roundtrip

## [0.1.3] — 2026-04-19

### Removed
- `claude -p` auto-labeling (caused a feedback loop that spawned orphan
  sessions). Kept only user-set labels via the inline-edit GUI.

## [0.1.2] — 2026-04-19

### Added
- User-editable session titles from the GUI

## [0.1.1] — 2026-04-19

### Added
- AI-generated session labels (later removed in 0.1.3 due to feedback loop)

## [0.0.2] — 2026-04-18

### Added
- Per-tab Windows Terminal focus via UI Automation + SessionStart hook that
  stamps OSC-0 titles

## [0.0.1] — 2026-04-18

### Added
- Initial working Claude Sessions Viewer:
  - FastAPI backend on `127.0.0.1:8765` reading `~/.claude/projects/**/*.jsonl`
  - React frontend with session list, active strip, folder filter, transcript
  - Live updates via SSE + watchdog
  - "New tab" / "Split" buttons spawn `wt.exe ... claude --resume <uuid>`
  - Self-installing Desktop shortcut launcher

[Unreleased]: https://github.com/MenachemBarak/AgentCLISessionManager/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.7.0
[0.6.0]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.6.0
[0.5.0]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.5.0
[0.4.2]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.4.2
[0.4.1]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.4.1
[0.4.0]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.4.0
[0.3.2]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.3.2
[0.3.1]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.3.1
[0.3.0]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.3.0
[0.2.0]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.2.0
[0.1.5]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.1.5
[0.1.4]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.1.4
[0.1.3]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.1.3
[0.1.2]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.1.2
[0.1.1]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.1.1
[0.0.2]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.0.2
[0.0.1]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.0.1
