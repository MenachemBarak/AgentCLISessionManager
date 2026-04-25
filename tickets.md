# Tickets

Live queue of work items tracked across branches. Completed items drop off; active ones stay with branch + PR links. Parked items sit at the bottom.

## Active

_(none — autonomous run idling for user dogfood signal)_

## In-flight

_(none — all PRs merged or queued for next user direction)_

## Ready to pick up (no branch yet)

- **T-56 Visual dogfood of v1.2.17** — human-only:
  1. Split a pane running a live agent → agent stays alive
  2. Resume an old session → auto-picks "Resume full session as-is"
  3. Close PowerShell hosting `claude` → ghost marker disappears on Rescan
  4. External `claude` in PowerShell → "Open in manager" button appears
  5. Close one pane of a 2-pane split → sibling stays, tab survives (v1.2.17 fix)

- **T-58 Worktree spawn recipe** — out of scope until daemon split (#42) further along

- ~~**T-60 session-move full-suite flake root-cause**~~ — **FIXED**: race between watcher's `on_deleted(src)` and the move's eager re-scan. Fix: `_evict` now compares `_INDEX[sid].path` to the deleted path before evicting, so post-move dest entries survive a stale source-delete event.

- **T-62 ramp coverage 60% → 80%** — current 62% Windows / 57% Linux. Biggest gaps: app.py (56%), updater.py (55%), claude_code.py (58%), cli.py (50%). Each needs targeted unit tests.

## Parked

- **T-54 tmux detach/reattach for #42 Phases 8-10** — depends on daemon dogfood

## Recently shipped (2026-04-24 → 2026-04-25 autonomous run)

| PR | Task | Impact |
|---|---|---|
| #85 | red E2E (msg-copy timeout) | main green after 10+ red runs |
| #86 | splits-kill-PTYs (portal) | **critical user-reported** |
| #87 | resume-menu digit-pick + shell-wrap sid | auto-resume picks option 2 |
| #88 | ghost-active PID-reuse defense | user-reported |
| #89 | 'Open in manager' for active-unmanaged | user-requested |
| #90 | bump v1.2.15 | release cut |
| #91 | msg-copy + session-move poll | flakies |
| #92 | shell-wrap-runtime | flaky stabilized |
| #93 | docs v0.7.1 → v1.2.15 refs | README accurate |
| #94 | rescan ghost-marker count UX | user-visible feedback |
| #95 | tickets.md update | docs |
| #96 | pane-id collisions (blank pane) | **critical user-reported** |
| #97 | bump v1.2.16 | release cut |
| #98 | close-pane no longer tears down tab | **critical found-via-TDD** |
| #99 | row 'In viewer' button coverage | T-63 audit |
| #100 | row 'New tab' / 'Split' coverage | T-63 audit |
| #101 | tile-divider drag coverage | T-63 audit |
| #102 | bump v1.2.17 | release cut |
| #103 | sort/date dropdown testids + tests | T-63 audit |
| #104 | folder filter testids + tests | T-63 audit |
| #105 | backend coverage gate at 55% | T-62 first step |
| #106 | updater.py unit tests (37 → 55%) | T-62 ramp |
| #107 | app.py endpoint smoke tests | T-62 ramp |

**Releases on user's machine:** v1.2.15 → v1.2.16 → v1.2.17

**Bridgespace hooks removed** from `~/.claude/settings.local.json` per user.
