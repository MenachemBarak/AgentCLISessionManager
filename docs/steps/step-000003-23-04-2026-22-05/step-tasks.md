# Step tasks — step 000003

## T-18: Auto-pick "Resume full session as-is" on Claude Code resume menu (v0.9.10, #44)

- **BEFORE**: On old sessions, `claude --resume` showed a 3-option menu defaulting to "Resume from summary". User had to manually pick option 2 every time.
- **AFTER**: Viewer detects the marker string "Resume full session as-is" and sends `\x1b[B\r` (down + Enter) to pick option 2. Deduped per sessionId per viewer boot via `window._resumePromptHandled`.
- **Files**: `backend/frontend/terminal-pane.jsx` (scanner in `output` handler). `e2e/tests/feature/resume-prompt-auto-pick.spec.ts`.
- **Related prior steps**: Builds on step-000002::T-13 (restart-ping flow).
- **Related sibling files**: Not directly — but proved insufficient because the keystroke-splitting bug (T-21) meant the arrow was sometimes eaten.

## T-19: Rebrand Claude Sessions Viewer → AgentManager (v1.0.0, #46)

- **BEFORE**: User-visible "Claude Sessions Viewer" / "Session Manager" across title bar, CLI, release assets.
- **AFTER**: "AgentManager" everywhere user-facing. Release workflow dual-publishes both asset names so v0.9.x clients' updater still sees the banner.
- **Files**: `backend/frontend/app.jsx` (title span), `backend/app.py` (FastAPI title), `backend/cli.py` (prog + thread name), `backend/updater.py` (ASSET_PATTERN), `pyinstaller.spec` (exe name), `.github/workflows/release.yml` (dual-publish), `.github/workflows/e2e.yml` (rename built-exe ref), `e2e/pages/windowChrome.ts` (locator text).
- **Related prior steps**: N/A — structural rename.
- **Related sibling files**: `architecture-decisions.md::ADR-13,ADR-14`, `knowledge.md::Releases + install layout`.

## T-20: CRITICAL — diagnose paste-split bug (v1.0.0 shipped broken)

- **BEFORE**: v1.0.0 in production for ~minutes. User reported two screenshots: `/compact` auto-ran instead of resume-full, AND the restart-ping text sat in chat input un-sent.
- **AFTER**: Root cause identified — Ink-TUI's bracketed-paste detection swallowed both the Enter (auto-confirming menu default) AND the submission (Enter-as-literal-newline-in-paste).
- **Files**: Diagnosis only — no code changes in this step.
- **Related prior steps**: Breaks the promise made in step-000002::T-13 (restart-ping) and T-15 (tab-focus-highlights). Both worked in isolation; both were broken by the single concatenation anti-pattern.
- **Related sibling files**: `lessons-learned.md::L-17,L-18`.

## T-21: Fix paste-split across ALL three keystroke sites (v1.0.1, #46)

- **BEFORE**: `send({type:'input', data: TEXT + '\r'})` and `send(..., data: '\x1b[B\r')` were both used as single-frame payloads.
- **AFTER**: Every text+control combination split into separate WS frames with delay between: text → 500ms → `\r`. arrow-down → 200ms → `\r`. Long text uses `typeIntoPty()` chunked writer (16 chars / 30ms gaps).
- **Files**:
  - `backend/frontend/terminal-pane.jsx` — restart-ping block + resume-prompt auto-pick block
  - `backend/__version__.py` → `"1.0.1"`
  - `CHANGELOG.md` — new 1.0.1 section
  - `e2e/tests/feature/keystroke-splitting.spec.ts` — TDD reproduction (confirmed failing against reverted code, passing against fix)
- **Related prior steps**: Fixes T-13 + T-18 which had the bug baked in.
- **Related sibling files**: `architecture-decisions.md::ADR-15,ADR-17`, `lessons-learned.md::L-17,L-18`.

## T-22: Shell-wrap session tabs for graceful /exit (v1.1.0, #47)

- **BEFORE**: "In viewer" spawn was `{provider: 'claude-code', sessionId, cwd}` — backend routed through `ClaudeCodeProvider.resume_command()` returning `[claude, --resume, sid]` as argv[0] of the PTY. `/exit` killed the PTY; tab became "session exited" and useless.
- **AFTER**: Spawn is `{cmd:['cmd.exe'], cwd, _autoResume:{sessionId, provider}}`. Backend spawns the shell normally. On `ready`, frontend waits 1.2s for the shell prompt, then types `claude --dangerously-skip-permissions --resume <sid>` via chunked `typeIntoPty()`, then sends `\r` separately. Claude runs as child of the shell. `/exit` returns to shell prompt; tab stays alive + reusable.
- **Files**:
  - `backend/frontend/app.jsx` — `openInViewer` emits new shape; `spawnSessionId()` helper accepts both legacy + new shapes; `firstSessionIdInTree` + `collectSessionIds` updated
  - `backend/frontend/terminal-pane.jsx` — `typeIntoPty` helper added; `ready` handler auto-types the command for shell-wrap tabs; `RESTART_PING_DELAY_MS` bumped 5s → 8s; dedupe tracker `window._autoResumeTyped`
  - `backend/__version__.py` → `"1.1.0"`
  - `CHANGELOG.md` — new 1.1.0 section
  - `e2e/tests/feature/shell-wrap-resume.spec.ts` — 3 new source-contract tests
- **Related prior steps**: Reshapes T-13 (restart-ping) and T-15 (tab-focus) on top of the new spawn shape. Builds on the keystroke-splitting rule from T-21.
- **Related sibling files**: `architecture-decisions.md::ADR-16`, `knowledge.md::Shell-wrap spawn shape`.

## T-23: Manual proper-install of v1.0.1 at new AgentManager location

- **BEFORE**: v1.0.0 installed at the legacy `%LOCALAPPDATA%\Programs\ClaudeSessionsViewer\` path. User asked for "well structured" single-entry install.
- **AFTER**: Fresh `%LOCALAPPDATA%\Programs\AgentManager\AgentManager.exe` (v1.0.1). New Desktop `AgentManager.lnk`, new Start-Menu `AgentManager.lnk`. Old "Claude Sessions Viewer.lnk" quarantined as `.bak-agentmanager`. Legacy dir kept for rollback.
- **Files**: No source changes — this was a filesystem install procedure. Documented in `maintenance.md`.
- **Related prior steps**: N/A.
- **Related sibling files**: `maintenance.md::Current install state + Manual install`, `lessons-learned.md::L-21`.

## T-24: Write this step snapshot (current task)

- **BEFORE**: step-000001 and step-000002 documented sessions ending at v0.9.9.
- **AFTER**: step-000003 covers v0.9.10 through v1.1.0 including the CRITICAL paste-split event + the shell-wrap architectural pivot.
- **Files**: `docs/steps/step-000003-23-04-2026-22-05/{user-notes,knowledge,architecture-decisions,lessons-learned,maintenance,step-tasks}.md`
- **Related prior steps**: Reads step-000001 and step-000002 context. This is step 3 of an accumulating record.
- **Timer**: task-timer MCP was disconnected this session; no wall-clock timer started. See `lessons-learned.md::L-19`.
