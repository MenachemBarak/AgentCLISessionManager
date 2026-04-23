# Architecture decisions — step 000003

## ADR-13: v1.0.0 rebrand — dual-publish release assets

- **Decision**: Rename "Claude Sessions Viewer" → "AgentManager" across every user-visible surface. Publish each release binary under BOTH asset names (`AgentManager-X.Y.Z-windows-x64.exe` as primary, `claude-sessions-viewer-X.Y.Z-windows-x64.exe` as legacy alias) so v0.9.x clients whose updater polls for the legacy name still see the banner.
- **Alternatives considered**:
  - Single-asset under new name (rejected — strands every v0.9.x user; they'd never see the banner).
  - Redirect legacy asset URLs to the new name (rejected — GitHub Releases doesn't support cross-asset redirects; client gets 404).
  - Break compat, require manual reinstall (rejected — punitive to existing users).
- **Why**: The updater asset-name is a contract with every deployed client. Breaking it is a stranding event. Dual-publish costs bandwidth but preserves the upgrade chain for the handful of releases it takes for all users to migrate.
- **Blast radius**: `pyinstaller.spec` exe name, `updater.ASSET_PATTERN`, `release.yml` build + upload steps, CLI `--prog`, FastAPI `title`, title bar text. ~12 files across source + workflow.
- **Reversibility**: Trivial within the dual-publish window. Once we stop publishing the legacy alias (v1.2.0+), a revert would strand new installs.

## ADR-14: Install path STAYS in `ClaudeSessionsViewer\` for this release

- **Decision**: The self-update swap helper writes the new binary into the existing `%LOCALAPPDATA%\Programs\ClaudeSessionsViewer\claude-sessions-viewer.exe` location. The filesystem name is a legacy artifact; content + user-facing naming is AgentManager.
- **Alternatives considered**:
  - Migrate install dir + exe filename in v1.0.0 (rejected — every v0.9.x user's Desktop shortcut would point at the old path; post-swap relaunch would fail unless shortcut is re-pointed, which PyInstaller can't reliably do).
- **Why**: Keep the swap path reliable while the rename is ongoing. The "proper install" I did manually for this user landed at the new path `%LOCALAPPDATA%\Programs\AgentManager\` — that's the target for clean installs going forward. Future v1.1.x or v1.2.x can do a migration step that moves users forward automatically.
- **Blast radius**: Zero code change for this release. Documentation only.
- **Reversibility**: N/A (no change made).

## ADR-15: Keystrokes always split across separate WS frames (v1.0.1)

- **Decision**: Never send `text + control-byte` in one `{type:'input', data:...}` payload. Text chunks and control keys always get separate frames with a ≥200ms gap. Long text is further chunked into 16-char pieces with 30ms gaps via `typeIntoPty()`.
- **Alternatives considered**:
  - Send everything at once with no splitting (the v1.0.0 behaviour — PROVEN broken, compacted user's session).
  - Detect Ink-TUI's paste-mode sequences (`\x1b[200~...\x1b[201~`) and wrap input ourselves (rejected — Ink's detection is timing-based not marker-based, and manual wrapping changes how the TUI treats the input entirely).
  - Use xterm.js's `paste()` helper (rejected — it wraps with paste markers which would trigger the same bracketed-paste path from the TUI's perspective).
- **Why**: Ink's bracketed-paste detection ate the trailing Enter in v1.0.0 and caused fatal UX (auto-confirmed the resume-choice menu's default "Compact summary"). Splitting with a timing gap is the simplest correct fix.
- **Blast radius**: `terminal-pane.jsx` only. `typeIntoPty()` helper is now the canonical way to write multi-char input.
- **Reversibility**: Trivial.
- **Enforced by**: `keystroke-splitting.spec.ts` — source-level contract test that greps for the anti-pattern.

## ADR-16: Session tabs are shell-wrapped (v1.1.0 — closes #47)

- **Decision**: "In viewer" on a session spawns a SHELL (cmd.exe) in the session's cwd, then types `claude --dangerously-skip-permissions --resume <sid>` into the shell using the chunked writer. Claude runs as a child of the shell. `/exit` returns the user to the shell prompt; the tab stays alive.
- **Alternatives considered**:
  - Keep `claude --resume <sid>` as argv[0] and add a wrapper script that re-execs into a shell on exit (rejected — wrapper would be a platform-specific shim per OS, complexity > benefit).
  - Respawn the PTY with cmd.exe after detecting claude's exit (rejected — loses session-in-terminal visual continuity and scrollback).
  - Don't wrap — accept `/exit` killing the tab (rejected — user explicit directive).
- **Why**: User directive + the claude-as-argv[0] model is structurally at odds with Claude Code's assumption that it runs inside a user's shell. The shell-wrap is the cleanest fix.
- **Blast radius**: `app.jsx::openInViewer`, `terminal-pane.jsx` (new auto-resume branch + `typeIntoPty`), `spawnSessionId` helper (dual-shape detection). Layout persistence: new `spawn` shape stored going forward, legacy shape accepted on hydrate.
- **Reversibility**: The helper stays dual-shape-aware indefinitely so old layouts rehydrate. The `openInViewer` can be reverted to emit legacy shape and old clients keep working, but we lose graceful-exit. So: one-way door for the UX improvement, two-way door for the code shape.

## ADR-17: TDD for bugfixes (user-elevated)

- **Decision**: For every bugfix from v1.0.1 forward, FIRST write a test that reproduces the bug and FAILS against the current (buggy) code; THEN apply the fix and confirm GREEN.
- **Alternatives considered**:
  - Skip the reproduction step and just add regression tests alongside fixes (rejected — user explicit directive, plus: without a failing test first, you can't prove the test would have caught the bug).
- **Why**: The v1.0.0 paste-split bug shipped because our source-contract tests only asserted the NEW shape existed, not that the OLD shape was FORBIDDEN. A proper TDD cycle would have caught it at fix time.
- **Blast radius**: Workflow / review expectation. No code change.
- **Reversibility**: Trivial.
- **Enforced by**: Team convention + this ADR.
