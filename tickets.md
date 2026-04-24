# Tickets

Live queue of work items tracked across branches. Completed items drop off; active ones stay with branch + PR links. Parked items sit at the bottom with a clear "why parked" so they're easy to pick back up.

## Active

_(none — queue is clear)_

## In-flight

- **T-61 BLANK PANE on user's v1.2.15 (pane-id collisions)** — PR [#96](https://github.com/MenachemBarak/cli-manager/pull/96)
  - User-reported; fix heals already-corrupted state + prevents future collisions. Regression test added.

- **T-62 Test coverage hook ≥80% + coverage CI gate** — user-requested (queued)

## Ready to pick up (no branch yet)

- **T-63 Release v1.2.16** — bundle post-v1.2.15 fixes (#94, #96) + install on user's machine. Blocks on #96 merging.

- **T-56 Visual dogfood of v1.2.16 fixes** — manual, human-only.

- **T-58 Worktree spawn recipe** — out of scope until daemon split (#42) is further along.

- **T-60 Root-cause fix for session-move full-suite flake** — needs per-spec backend isolation.

## Parked

- **T-54 Integrate tmux detach/reattach into #42 Phases 8-10** — depends on daemon dogfood.

## Recently shipped (today — 2026-04-24)

| PR | Task | Impact |
|---|---|---|
| #85 | T-49 red E2E (msg-copy timeout) | E2E main green after 10+ red runs |
| #86 | T-50 splits-kill-PTYs (portal refactor) | **Critical** — user-reported; agents survive splits |
| #87 | T-51 resume-menu digit-pick + shell-wrap sid | Auto-resume picks option 2 on v1.1.0+ tabs |
| #88 | T-53 ghost-active PID-reuse defense | User-reported; rescan clears ghosts |
| #89 | T-52 'Open in manager' for active-unmanaged | Adopt externally-started agents into UI |
| #90 | T-55 bump to v1.2.15 | Release cut |
| #91 | T-57 msg-copy + session-move poll | Flakies stabilized |
| #92 | T-57 shell-wrap-runtime | Flaky stabilized |
| #93 | Docs: v0.7.1 → v1.2.15 | README pipx line current |
| #94 | T-59 rescan button count feedback | User sees what Rescan cleaned |
| #95 | tickets.md update | Docs |
