# Knowledge — step 000002

## Releases this window

| Version | Tag | What | Release URL |
|---|---|---|---|
| v0.9.3 | `v0.9.3` | `--dangerously-skip-permissions` on every resume | https://github.com/MenachemBarak/agentclisessionmanager/releases/tag/v0.9.3 |
| v0.9.4 | `v0.9.4` | Restart-ping auto-resume flow | https://github.com/MenachemBarak/agentclisessionmanager/releases/tag/v0.9.4 |

**Currently installed on this machine**: v0.9.3 (user's own sessions running through it; do not restart).
**Not yet installed**: v0.9.4 and forward — will be pulled when the user next restarts.

## PRs in this window

- **#36** (merged) — `feat: always pass --dangerously-skip-permissions on resume (v0.9.3)` — https://github.com/MenachemBarak/agentclisessionmanager/pull/36
- **#37** (merged) — `feat: auto-resume + ping every restored session on viewer restart (v0.9.4)` — https://github.com/MenachemBarak/agentclisessionmanager/pull/37
- **#38** (GREEN, open) — `test(e2e): expand QA coverage 9→25 tests, caught Tweaks crash bug` — https://github.com/MenachemBarak/agentclisessionmanager/pull/38

All three landed 14/14 CI green including `e2e (built exe)`.

## Restart-ping mechanics (v0.9.4)

On viewer boot, layout hydration (`app.jsx`) walks every restored terminal
tab's tile tree and collects all `spawn.sessionId` values into
`window._restartPingPending`. When each pane's PTY reports `ready` on the
WebSocket, `terminal-pane.jsx` schedules a 5s-delayed
`{type:"input", data:"SOFTWARE RESTARTED - GO ON FROM WHERE YOU LEFT OFF\r"}`
if the sessionId is in pending, moves it to `_restartPingFired` to
dedupe across split panes.

Scope: only tabs restored from persisted layout this boot. Fresh "In
viewer" clicks don't get pinged. Module-level Sets reset on page reload,
which is the intended boundary (each viewer boot pings at most once per
session).

## --dangerously-skip-permissions (v0.9.3)

Single edit in `backend/providers/claude_code.py::resume_command()`:

```python
return ["claude", "--dangerously-skip-permissions", "--resume", session_id]
```

All three resume call sites funnel through this function:
1. `/api/open` → wrapped in `wt.exe` externally
2. `/api/pty/ws` → internal PTY pane via `provider.resume_command`
3. v0.9.4 restart-ping flow (writes input to a pane that was spawned with
   the above argv on mount)

Test invariant in `tests/test_providers.py::test_resume_command_is_stable`:
`assert "--dangerously-skip-permissions" in cmd`

## Known live bug surfaced by QA expansion

**BUG #43**: `ReferenceError: Segmented is not defined` at
`backend/frontend/tweaks.jsx:37` (and three other lines in the same file).

Reproduces every time the Tweaks drawer button is clicked. `<Segmented>`
is referenced but not defined in `tweaks.jsx` and not attached to
`window` under the babel-standalone loader. React recovers the render
(TweaksPanel returns null from the error boundary path) but it IS logged
as a pageerror.

Pre-existing bug — not introduced by this step. Surfaced by the new
`tweaks.spec.ts::clicking the button does not crash the app` test, which
is currently `test.fixme`-marked with a pointer to task #43.

## Playwright suite inventory (post-#38)

```
e2e/
├── helpers/
│   ├── page-state.ts      capturePageState + diffState
│   ├── api-probe.ts       readStatus, readSessions, readUpdateStatus, readLayoutState
│   └── layout-seed.ts     seedEmpty/AdHoc/Resumable/Corrupt layouts
├── pages/
│   ├── windowChrome.ts    readVersion, openTweaks
│   ├── sessionList.ts     waitReady, rows, count, searchFor, clickInViewerForRow, rescan
│   ├── transcript.ts      root, isVisible, activate
│   ├── rightPane.ts       openNewTerminal, tabCount, closeTab, splitH/V, closeActivePane, paneCount
│   ├── tweaks.ts          toggle, readPersisted
│   └── updateBanner.ts    root, isVisible, seedUpdateAvailable, clickDownload, clickRestartApply
└── tests/feature/
    ├── app-boots.spec.ts         (2 tests)
    ├── update-flow.spec.ts       (4 tests)
    ├── restart-ping.spec.ts      (3 tests)
    ├── session-list.spec.ts      (3 tests)
    ├── right-pane-tabs.spec.ts   (5 tests)
    ├── tweaks.spec.ts            (3 tests, 1 fixme)
    └── api-contracts.spec.ts     (5 tests)
= 25 tests (24 pass + 1 fixme tracking #43)
```

## Data-testids added this step

- `compact-list.jsx` — `session-search-input` (search input); `IconBtn`
  auto-generates `rowbtn-<label-slug>` (reaches Focus, In viewer, New tab, Split)
- `app.jsx` — `tweaks-button`, `transcript-pane`

## CI config tightened

- `e2e/playwright.config.ts` — `workers: 1` (was default-parallel). Backend's
  layout-state file is shared across tests; parallel workers overwrote
  each other's seeds. Single-worker serialization fixes the race.

## New tasks filed this step

- **#42** ARCH — Decouple session-liveness layer from platform layer
- **#43** BUG — Tweaks drawer crashes on open (`Segmented is not defined`)

## Task state changes

- **#41** completed (restart-ping shipped in v0.9.4)

## Live environment snapshot

- User's v0.9.3 viewer running on an ephemeral port (was 55242 earlier; port varies per launch)
- Desktop shortcut `C:\Users\User\Desktop\Claude Sessions Viewer.lnk` → installed exe
- Backup exes in install dir: `.old-0.9.0`, `.old-0.9.1`, `.prev-0.8.0`, `.prev-0.7.1`, `.old-0.8.1`

## Timer

step-snapshot timer ID: `6ca3b0c9` (10m, started at the top of this step).
