# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] — 2026-04-24

### Added — proper Windows installer (task #48)
- **AgentManager-1.2.0-setup.exe** ships alongside the raw .exe. Real
  Windows installer via Inno Setup 6 with standard Next/Next/Finish UX,
  **Add/Remove Programs entry** (currently missing from the raw-exe
  install), installer-managed Desktop + Start-menu shortcuts, silent-
  install support (`/VERYSILENT`) for scripting. Per-user install
  (no UAC prompt) to `%LOCALAPPDATA%\Programs\AgentManager\`.
- Uninstall from Add/Remove Programs first invokes the `--uninstall
  --yes` CLI (Phase 6) to kill any running daemon + PTY grandchildren,
  THEN removes files — covers the Squirrel/VSCode-style orphan-process
  class of bug.

### Added — daemon-split architecture, opt-in (task #42)
- `AGENTMANAGER_DAEMON=1` env var enables the new two-exe model:
  short-lived UI shim probes `127.0.0.1:8765`, autostarts a detached
  daemon if absent, navigates the webview with a per-install bearer
  token in the URL fragment. Opt-in for one release — default in v1.3.
- Daemon owns: PTYs, WebSocket bridge, JSONL index, watchdog, ring
  buffer (256 KB per PTY), layout state, updater. UI restart /
  reconnect now **rehydrates scrollback** via WS reattach-by-id +
  ring-buffer replay (no more starting from an empty shell after
  restart).
- REST surface: `GET /api/health`, `POST /api/pty`, `POST /api/pty/{id}/write`,
  `GET /api/pty/{id}/replay`, `POST /api/shutdown` — auth-gated via
  `Authorization: Bearer <token>` in daemon mode; untouched in legacy.
- `AgentManager.exe --probe-daemon` returns exit 0 (ours) / 1 (absent) /
  3 (port held by unrelated process) for scripting.
- `AgentManager.exe --uninstall [--yes] [--dry-run]` performs the
  seven-step tear-down from ADR-18 Law 3.

### Research & design
- ADR-18 (`docs/design/adr-18-daemon-split.md`) — architecture,
  research against VSCode ptyHost / Cursor / Docker Desktop /
  WezTerm mux-server, and the INVISIBLE + FULLY TESTABLE +
  UNINSTALLABLE three-law constraints driving every decision.

## [1.1.1] — 2026-04-24

### Fixed — persisted session tabs auto-resume on upgrade
- **Tabs persisted before v1.1.0 now auto-resume after upgrading.** A
  user who upgraded from v0.9.x / v1.0.x to v1.1.0 saw every session
  tab render "session exited" on boot instead of resuming — because the
  old persisted spawn shape `{provider:'claude-code', sessionId}` ran
  `claude` as argv[0] of the PTY, and in the frozen exe the inherited
  PATH does not contain `claude.exe`, so pywinpty's spawn failed
  instantly. v1.1.1 migrates any legacy-shape pane to the v1.1.0
  shell-wrap shape during rehydrate, then re-persists it so subsequent
  boots start clean. Fresh installs are unaffected.
- **TDD guard.** `e2e/tests/feature/legacy-layout-migration.spec.ts`
  seeds the legacy shape + intercepts the WS spawn frame; the
  assertion flips red the moment any regression strips the migration.

## [1.1.0] — 2026-04-23

### Changed — graceful /exit via shell-wrap
- **Session tabs now spawn a shell, then type `claude --resume` into
  it** instead of running `claude` as argv[0]. Before: the PTY's
  foreground process WAS claude, so `/exit` terminated the tab
  entirely — the pane showed "session exited" and became useless.
  After: the shell is the foreground process; claude runs as a
  child; `/exit` closes claude and the shell prompt returns. **The
  tab stays alive and reusable** — type a new command, run
  another `claude --resume <other-sid>`, or just `cd` around.
- **Tabs are session-bound only while claude is active.** Any tab
  can be repurposed once the user exits claude. The sidebar
  highlight (v0.9.5) still tracks which session is "active" in the
  focused tab — when claude is gone, the tab becomes a plain shell
  and the highlight clears.
- **The typed command is chunked** (16 chars per WS frame, 30ms
  gaps) so Ink-TUI doesn't treat it as a bracketed paste —
  complements the v1.0.1 paste-split fix.
- **Restart-ping delay bumped 5s → 8s** to accommodate the extra
  shell-prompt + claude-startup time in the new flow.

### Migration
- Existing `spawn: {provider, sessionId, cwd}` layouts still
  hydrate (legacy shape detector preserved via `spawnSessionId()`
  helper). New tabs use `spawn: {cmd, cwd, _autoResume:{sessionId}}`.
- No user action required — next "In viewer" click uses the new
  flow automatically.

## [1.0.1] — 2026-04-23

### Fixed
- **CRITICAL: restart-ping was auto-compacting sessions.** When the
  viewer restored a resumed session, it sent the SOFTWARE RESTARTED
  directive as `text + "\r"` in one WS input frame. Ink-TUI
  interpreted the whole block as a bracketed paste, so the trailing
  `\r` was consumed as "confirm the current menu option" — auto-
  picking "Compact summary" (option 1, default) on the resume-choice
  menu. User lost real context in downstream work. Reproduced live
  on this machine.
- **CRITICAL: restart-ping text appeared in chat input but never
  sent.** Same root cause — the `\r` was eaten by the paste handler
  as a literal newline, not Enter-to-submit. User had to press
  Enter manually to send every resumed agent the restart directive.
- **CRITICAL: "Resume full session as-is" auto-pick was selecting
  option 1 instead of option 2.** Same root cause — `\x1b[B` +
  `\r` in one paste block; the arrow never registered so Enter
  confirmed option 1.

### Fix mechanics
All three bugs share a single fix: **split input keystrokes across
separate WS frames with a short delay between.** text → wait 500ms
→ `\r`. arrow-down → wait 200ms → `\r`. The delays let Ink close
its bracketed-paste window before the next keystroke arrives, so
each one is processed as an individual key event.

## [1.0.0] — 2026-04-23

### Changed — REBRAND
- **Product is now "AgentManager"** — the old "Claude Sessions Viewer"
  / "Session Manager" names are replaced across every user-facing
  surface:
  - Title bar reads `AgentManager vX.Y.Z`
  - FastAPI `title="AgentManager"`
  - CLI `--version` prints `AgentManager X.Y.Z`
  - PyInstaller output exe is `AgentManager.exe`
  - Release assets published as `AgentManager-X.Y.Z-windows-x64.exe`
- **Upgrade chain preserved for v0.9.x clients** — the release
  workflow now publishes BOTH assets: the new primary
  `AgentManager-...` AND a legacy alias `claude-sessions-viewer-...`.
  v0.9.x updaters (which look for the legacy name) continue to see
  the banner and can upgrade into v1.0.0 without a manual download.
- **Installed binary path unchanged** — the swap helper writes into
  the existing filesystem location (`%LOCALAPPDATA%\Programs\
  ClaudeSessionsViewer\claude-sessions-viewer.exe`). The content is
  now AgentManager v1.0.0; only the filesystem name is a legacy
  artifact. A future release can migrate the path + Desktop
  shortcut.

### Unchanged
- Everything that worked in v0.9.10 still works — this is a naming
  change only, no functional behaviour shifts.

## [0.9.10] — 2026-04-23

### Added
- **Auto-select "Resume full session as-is" on the resume-choice
  prompt.** Claude Code shows an interactive menu on `--resume` for
  older/larger sessions offering (1) Resume from summary, (2) Resume
  full session as-is, (3) Don't ask me again — defaulting to (1).
  For unattended resume (the v0.9.4 restart-ping path, the "In viewer"
  path, external wt.exe path) option (1) silently drops the context
  the user was actively working with. The viewer now scans pane
  output for the string `"Resume full session as-is"` and, once per
  session per boot, sends `\x1b[B\r` (down-arrow + Enter) to pick
  option 2. Deduped via a module-level Set so re-renders / scrollback
  can't re-answer.

## [0.9.9] — 2026-04-23

### Added
- **Move Claude Code sessions between project directories** via two
  new endpoints:
  - `POST /api/sessions/{sid}/move/plan` — dry-run, returns a full
    structured report (target path, encoded dir, SHA of source,
    warnings for "source was modified recently, may still be
    streaming", `safe_to_move` flag). NEVER touches the filesystem
    beyond reading.
  - `POST /api/sessions/{sid}/move/execute` — requires explicit
    `confirm=true` in the body (missing flag returns 400, not silent
    move). Copy-verify-unlink ordering: if the process dies mid-move
    we are left with either just the source (resumable) or both
    copies (dedupe by hand), never only a partial destination.
    Preserves file mtime so activity sorting doesn't spike to the
    top of the list after a move.
  Covered by `tests/test_move_session.py` (8 tests — encoding,
  plan refusal cases, same-dir no-op, copy+verify+unlink round-trip,
  rollback on plan failure). HIGH-RISK operation, UI dialog will be
  gated on the plan report's `safe_to_move=True`.

## [0.9.8] — 2026-04-23

### Changed
- **Restart-ping message is now more precise about agent behaviour.**
  Replaces the short `"SOFTWARE RESTARTED - GO ON FROM WHERE YOU LEFT
  OFF"` with a longer, explicit directive that tells the resumed agent
  five things:
    1. Go on EXACTLY from where you left off (no re-planning).
    2. If you were idle waiting for user input, KEEP idling.
    3. If you were in task progress, continue the work.
    4. Do NOT take initiative beyond the pre-restart scope.
    5. Validate that background tasks, services, and cron jobs you
       were managing are still running as before.
  Prevents the common failure mode where a resumed agent either
  starts something new or gets confused about what "going on" means.

## [0.9.7] — 2026-04-23

### Added
- **Update banner now appears automatically** without needing an app
  restart. Two new layers of polling close the gap that left a
  long-running viewer stuck on whatever release was latest at startup:
  - Backend `start_periodic_recheck()` daemon — re-runs the GitHub
    Releases poll every 30 min.
  - Frontend hourly `POST /api/update/check` from the banner — forces
    a fresh GitHub fetch even if the backend recheck hasn't fired
    yet.
  Worst-case lag between a release dropping and the banner appearing
  is now ~30 min (was: indefinite, until process restart).
- **`POST /api/update/check`** endpoint — synchronously re-fetches
  the latest release info from GitHub and returns the fresh snapshot.

## [0.9.6] — 2026-04-23

### Fixed
- **Tweaks drawer no longer crashes on open.** `TweaksPanel` referenced
  `<Segmented>` in four spots but the component was never defined
  anywhere or registered on `window`. Clicking the Tweaks button in
  the title bar threw `ReferenceError: Segmented is not defined`
  inside React's render; the drawer silently failed to appear.
  Defined `Segmented` — a horizontal button group with per-option
  testid (`segmented-option-<value>`) — and the four Tweaks rows
  (Theme / Density / Hover preview / Live activity) now render and
  roundtrip through `cm_tweaks` in localStorage as intended.
  Surfaced by the Playwright `tweaks.spec.ts` suite from v0.9.5;
  test now asserts the positive path (picking a theme updates
  persisted state).

## [0.9.5] — 2026-04-23

### Added
- **Terminal tab focus now highlights the matching session row.** Clicking
  into a terminal tab that holds a resumable session auto-selects the
  corresponding row in the left pane (loads its transcript + brings the
  row on-screen via `scrollIntoView({block:'nearest'})`). Works across
  all resume paths — "In viewer" click, external wt.exe resume, or
  layout-state rehydration on restart. Ad-hoc shell tabs don't move the
  selection. Covered by `e2e/tests/feature/tab-focus-highlights.spec.ts`
  (3 tests).

## [0.9.4] — 2026-04-23

### Added
- **Auto-ping resumed sessions after a viewer restart.** Every Claude
  Code session tab that was open before the viewer shut down (crash,
  reboot, or self-update) is now re-opened on the next launch and
  receives the message
      `SOFTWARE RESTARTED - GO ON FROM WHERE YOU LEFT OFF`
  automatically, so long-running agent workflows resume without the
  user needing to click or type. Scope is tight: the ping only fires
  for tabs restored from persisted layout on this boot, once per
  `sessionId`, ~5s after the PTY reports ready (gives `claude --resume`
  time to show its prompt). New "In viewer" clicks do NOT trigger
  pings. Pairs with v0.9.3's `--dangerously-skip-permissions` default
  — an unattended resume with a permission prompt would stall.

## [0.9.3] — 2026-04-23

### Changed
- **`--dangerously-skip-permissions` now included on every resume.** Every
  `claude --resume <uuid>` spawned by the viewer — the "In viewer"
  PTY path, the external `wt.exe` tab launcher, and the upcoming
  restart-ping flow — now passes the flag so the agent doesn't stall
  on a confirmation prompt when the user isn't there to click OK.
  The viewer is a local-user tool running the user's own agents on
  the user's own machine, so skipping permission prompts is the
  correct default for this context. All three resume paths funnel
  through `ClaudeCodeProvider.resume_command()` — single source of
  truth. Security note: do not repurpose this provider method for a
  multi-tenant or remote-operator context without revisiting the
  default.

## [0.9.2] — 2026-04-23

### Fixed
- **Self-update swap helper hung indefinitely.** The helper's PID-wait
  loop used `tasklist /FI "PID eq <pid>" | find "<pid>"` and trusted
  `%ERRORLEVEL%`. On some Windows / cmd builds `find` returns 0 even
  when the search string isn't present in its input, so the loop
  treated an exited PID as still-running and never progressed to the
  rename. Reproduced live during a v0.9.0 → v0.9.1 upgrade — the app
  had exited cleanly but the helper sat in the wait loop forever,
  leaving the user with a staged `.new` that never got promoted.
  Replaced with a rename-attempt loop: Windows holds an exclusive
  lock on a running image file, so `ren live → live.old` fails while
  the exe is alive and succeeds the moment it exits. No tasklist, no
  find, no ERRORLEVEL quirks — plus a 60s cap so a stuck shutdown can
  never hang the helper forever.

## [0.9.1] — 2026-04-22

### Fixed
- **Black-screen regression on malformed persisted layout.** If
  `~/.claude/viewer-terminal-state.json` held a tile-tree node with
  any `kind` other than `pane`/`split` (a probe wrote `kind:"leaf"`
  once), `TileTree` fell through to the split branch and crashed
  React on `tree.children[0]` — the whole pywebview window rendered
  pitch-black. `TileTree` now migrates unknown kinds to a fresh pane
  with a console warning, and rejects malformed splits (missing a
  2-element `children` array) the same way, so bad persisted state
  never nukes the UI again.

### Added
- **Playwright e2e suite under `e2e/`** with a `pages/` Page Object
  layer (windowChrome / sessionList / updateBanner) and feature
  tests in `tests/feature/`. `app-boots.spec.ts` catches the exact
  black-screen class of regression via direct DOM + console-error
  assertions; `update-flow.spec.ts` exercises the full banner state
  machine (hidden → available → staged → apply) using a
  CSV_TEST_MODE-gated `/api/_test/seed-update-state` hook.
- **Two CI jobs** (`.github/workflows/e2e.yml`): `e2e-dev` runs the
  suite against `python -m backend.cli` on every PR in under 3 min;
  `e2e-exe` rebuilds the PyInstaller exe and runs the same suite
  against the frozen binary — this is the job that catches
  release-only regressions (pywinpty shell init, PyInstaller data
  files, etc.) which unit tests can't see.

## [0.9.0] — 2026-04-22

### Added
- **Self-update UI — one-click Download + Restart.** The title bar now shows
  an amber banner when `/api/update-status` reports a newer release. Clicking
  **Download** fetches the new `.exe` next to the running one and verifies
  its SHA-256 against the GitHub Releases asset digest. Clicking **Restart &
  apply** launches a detached Windows `.cmd` helper that waits for this
  process to exit, renames the live exe to `<name>.old`, promotes `<name>.new`
  to the live path, relaunches the app, and self-deletes. Rollback on rename
  failure is automatic; the helper logs every step to `update-swap.log` next
  to the exe so postmortems survive a botched swap. Dev-mode (`python -m
  backend.cli`) returns a friendly "not available in dev" from `/api/update/apply`.

## [0.8.1] — 2026-04-22

### Fixed
- **"In viewer" now opens in the session's cwd.** Clicking the button on a
  session row used to spawn `claude --resume <uuid>` from the viewer's
  install dir, not from the directory the session was recorded in —
  relative-path references inside the session silently broke. The frontend
  now forwards `session.cwd` in the WebSocket spawn payload; the backend
  sanity-checks the path exists and falls back to `~` when the project has
  been moved/deleted. Proven e2e against a seeded cwd=C:/proof-of-cwd:
  prompt renders as `C:\proof-of-cwd>` and `cd` echoes the same.
- **Title-bar version was hardcoded** to `v0.4.2` despite every release bump
  since 0.5. `WindowChrome` now reads `GET /api/status` on first paint and
  renders the real version — future releases surface correctly without a
  manual string edit.

## [0.8.0] — 2026-04-22

### Added
- **Terminal layout survives restarts.** The right-pane tile tree —
  every tab, every split, the active tab id, the focused pane id — is
  persisted to `~/.claude/viewer-terminal-state.json` after any change
  (debounced 400 ms). On next launch the viewer rehydrates the layout
  exactly as you left it. Live PTY processes can't be resurrected, but
  when you click a restored pane it spawns a fresh PTY running the same
  command (e.g. `claude --resume <uuid>`) it had before.
- **Rescan button** in the Active section header. Calls a new
  `POST /api/rescan` that clears the in-memory index cache, deletes
  stale `~/.claude/sessions/<pid>.json` markers whose PID is no longer
  alive, and rebuilds from disk. Essential after a power-loss / hard
  reboot where the OS didn't get to clean up those markers — they'd
  otherwise show as ghost-active sessions.
- **Auto stale-marker cleanup** runs on every startup + every rescan.
  `build_index(force=True)` is the same code path the button triggers.
- `GET/PUT /api/layout-state` — endpoints backing the persistence above.

### Notes
- Layout persistence replaces any ad-hoc scroll/state you had with a
  canonical per-user snapshot. Delete `~/.claude/viewer-terminal-state.json`
  to reset to an empty terminal area.

## [0.7.1] — 2026-04-21

### Fixed
- **Embedded terminal in the packaged exe** — `cmd.exe` was exiting
  immediately (code `0xC000013A` / `STATUS_CONTROL_C_EXIT`) inside the
  PyInstaller `console=False` frozen build. Root cause: pywinpty **3.x**
  regressed on frozen exes. Pinned `pywinpty==2.0.15` (the version the
  broader Jupyter/IPython ecosystem ships with). Dev path (`python -m
  uvicorn`) was unaffected, so the regression only surfaced once users
  ran the native app. Verified end-to-end with a rebuilt 0.7.1 exe
  against the mock fixture: cmd.exe starts, prompt renders, echo
  round-trips, no spurious exit.

### Added
- **Self-update checker** — on launch the app polls GitHub Releases for
  a newer `vX.Y.Z` tag and exposes the result at `/api/update-status`.
  Calling `POST /api/update/download` fetches the new exe next to the
  running one as `*.exe.new`, verifies the SHA-256 against the release
  API's published digest, and surfaces `restartInstructions` so the
  user can swap it in on the next launch. No background exec, no
  telemetry — just a plain HTTP check against `api.github.com`.
- Structured file logging at `~/.claude/claude-sessions-viewer.log` so
  frozen-exe diagnostics (future regressions like the one above) no
  longer require reproducing under a debug console.

### Security
- `backend/terminal._ensure_hidden_console()` allocates a hidden console
  on first PTY spawn as belt-and-braces against frozen-exe console
  inheritance edge cases. Kept even though the pywinpty downgrade was
  the root-cause fix.

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

[Unreleased]: https://github.com/MenachemBarak/AgentCLISessionManager/compare/v0.7.1...HEAD
[0.7.1]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.7.1
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
