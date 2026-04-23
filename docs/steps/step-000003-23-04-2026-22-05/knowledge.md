# Knowledge — step 000003

## Releases this window

| Version | Tag | What |
|---|---|---|
| v0.9.10 | — | Auto-pick "Resume full session as-is" on Claude Code's 3-option menu |
| v1.0.0 | `v1.0.0` | **Rebrand**: Claude Sessions Viewer → AgentManager. Dual-publish release assets. |
| v1.0.1 | `v1.0.1` | **CRITICAL hotfix**: split keystrokes into separate WS frames so Ink-TUI's bracketed-paste doesn't eat Enter. |
| v1.1.0 | `v1.1.0` | **Shell-wrap arch**: session tabs spawn a shell then type `claude --resume` into it. /exit returns to shell prompt — tab stays alive. |

Release URLs:
- https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v1.0.0
- https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v1.0.1
- https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v1.1.0

**Currently installed**: AgentManager v1.0.1 at `%LOCALAPPDATA%\Programs\AgentManager\AgentManager.exe`. v1.1.0 will arrive via banner auto-recheck.

## PRs this window

- **#44** — v0.9.10 auto-pick "Resume full as-is"
- **#45** — v1.0.0 rebrand (dual-publish release assets)
- **#46** — v1.0.1 paste-split CRITICAL hotfix (TDD: reproduced bug, fixed, verified)
- **#47** — v1.1.0 shell-wrap (typed resume cmd into shell)

## New install layout (post-rebrand)

```
%LOCALAPPDATA%\Programs\AgentManager\
  AgentManager.exe           (current, v1.0.1)
  AgentManager.exe.old-1.0.0 (rollback slot)

Desktop shortcuts:
  AgentManager.lnk                                   → the new install
  Claude.lnk                                          → Anthropic's own app (unrelated)
  Claude Sessions Viewer.lnk.bak-agentmanager        (quarantined)
  Claude Sessions.lnk.bak-stale-launcher             (quarantined — launch.bat)

Start Menu \Programs\:
  AgentManager.lnk                                   → new
  Claude Sessions Viewer.lnk.bak-agentmanager        (quarantined)
```

Old install dir `%LOCALAPPDATA%\Programs\ClaudeSessionsViewer\` is **preserved** — holds `.old-0.8.1`, `.old-0.9.0` … `.old-0.9.2` backups. Not in use for new launches but kept for rollback.

## Release-asset dual-publishing

`pyinstaller.spec` produces `AgentManager.exe`. Release workflow now:

```
mv dist/AgentManager.exe      dist/AgentManager-${VER}-windows-x64.exe
cp dist/AgentManager-...      dist/claude-sessions-viewer-${VER}-windows-x64.exe
```

Both published. Primary name: AgentManager. Legacy alias: claude-sessions-viewer. Updater `ASSET_PATTERN` uses the primary; v0.9.x clients whose updater was pinned to the legacy name still see new releases.

## Keystroke-splitting rule (v1.0.1)

Claude Code's Ink TUI has bracketed-paste detection. Any WS input frame that contains a printable chunk + a control byte like `\r` or `\x1b[B` gets treated as a paste:
- Trailing `\r` becomes a literal newline in the paste, NOT an Enter-to-submit.
- Embedded `\x1b[B` (arrow) gets consumed as part of the paste text, not as a cursor movement.
- The downside: the PASTE may also auto-confirm a menu currently showing — the "compact instead of resume" disaster.

**Fix**: ALWAYS split keystrokes across WS frames with a ≥200ms gap.
- Text + Enter → text, wait 500ms, then just `\r`.
- Arrow + Enter → arrow, wait 200ms, then just `\r`.
- Long text → chunk into 16-char pieces with 30ms gaps (see `typeIntoPty()` in `terminal-pane.jsx`).

## Shell-wrap spawn shape (v1.1.0)

**New shape** (`spawn`):
```js
{
  cmd: ['cmd.exe'],
  cwd: <session.cwd>,
  _autoResume: {
    sessionId: <uuid>,
    provider: 'claude-code',
  },
}
```

**Legacy shape** (pre-v1.1.0 — still accepted for persisted-layout hydration):
```js
{ provider: 'claude-code', sessionId: <uuid>, cwd: <cwd> }
```

Dual-shape detector:
```js
function spawnSessionId(spawn) {
  return spawn?._autoResume?.sessionId || spawn?.sessionId || null;
}
```

## Test harness additions

`e2e/tests/feature/keystroke-splitting.spec.ts` — pins the v1.0.1 invariant:
- Anti-pattern `RESTART_PING_TEXT + '\r'` is FORBIDDEN
- The split pattern (two separate `send({type:'input'...})` calls) is REQUIRED

`e2e/tests/feature/shell-wrap-resume.spec.ts` — pins the v1.1.0 invariant:
- `openInViewer` emits `cmd` + `_autoResume` shape, not legacy top-level sessionId
- `terminal-pane.jsx` reads `autoResume` and uses `typeIntoPty` (chunked)
- `spawnSessionId` helper accepts both shapes

Suite total: 42 Playwright tests, all green except the known session-move retry-flake (session-move.spec.ts:106, passes on retry).

## Task ledger deltas

New tasks: #46 (rebrand, completed), #47 (shell-wrap, completed at close of window).
Tasks still pending: #40 (smart search), #42 (liveness daemon — user flagged HIGH), #45 (PyInstaller extraction race).
