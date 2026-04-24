# Tickets

Live queue of work items tracked across branches. Completed items drop off; active ones stay with branch + PR links. Parked items sit at the bottom with a clear "why parked" so they're easy to pick back up.

## 10-hour autonomous run — started 2026-04-25 ~00:00

User directive: "by the end of the morning im expecting full working app. FULL. all buttons in app are wired, all user features and flows are connected and tested."

Ground rules (will follow verbatim on every iteration):
- Never assume. Reproduce bugs in tests first, then fix until test passes.
- Before acting, read logs / screenshots / Playwright / Sentry / MCPs.
- Don't reinvent. Websearch competitor implementations first (playgrounds/).
- If stuck, re-read user's prior messages for hints.
- Budget: 10 hr. Check `tickets.md` at every wake for current priorities.

## Plan for the 10 hours (in order)

1. **T-63 Full button/flow audit** — enumerate every interactive element in the UI; for each, verify it's wired + has an e2e test covering the flow. Produce a coverage matrix. NEXT.
2. **T-62 Test coverage hook ≥80%** — `pytest-cov` with `--cov-fail-under=80` + frontend coverage via Playwright instrumentation. User-requested, queued.
3. **T-56 Dogfood v1.2.16 fixes in-process** — can't interact with the GUI from shell, but can boot `--server-only` + Playwright scripts to validate the 4 earlier fixes (ghost-active, split-kills-PTY, resume-menu, blank-pane) against the real built exe behaviour.
4. **T-60 Root-cause session-move flake** — per-spec backend isolation; real fix instead of poll-bump.
5. **T-54 (unpark) tmux detach/reattach design for #42 Phase 8** — write an ADR drawing from `playgrounds/tmux/server.c`.
6. **T-58 Worktree-per-session spawn** — inspired by claude-squad; optional `git worktree add` path in "Open in manager".

## In-flight

_(none — will pick up T-63 next wake)_

## Parked

- **T-54 tmux detach/reattach design** — will unpark at step 5 of the 10-hour plan.

## Recently shipped (2026-04-24, previous 24h)

| PR | Task | Impact |
|---|---|---|
| #85 | T-49 red E2E (msg-copy) | main green after 10+ red runs |
| #86 | T-50 splits-kill-PTYs (portal) | **critical** user-reported |
| #87 | T-51 resume-menu digit + shell-wrap sid | auto-resume picks option 2 |
| #88 | T-53 ghost-active PID-reuse defense | user-reported |
| #89 | T-52 'Open in manager' for active-unmanaged | user-requested |
| #90 | T-55 bump v1.2.15 | release cut |
| #91 | T-57 msg-copy + session-move poll | flakies |
| #92 | T-57 shell-wrap-runtime | flaky stabilized |
| #93 | docs: v0.7.1 → v1.2.15 refs | README accurate |
| #94 | T-59 rescan shows ghost-marker count | UX |
| #95 | tickets update | docs |
| #96 | T-61 pane-id collisions (blank pane) | **critical** user-reported |
| #97 | T-63-pre bump v1.2.16 | release cut + installed |

**Removed:** bridgespace hooks from `~/.claude/settings.local.json` per user (`.bridgespace/bin/bs-claude-hook.cjs` missing, errors were non-blocking but loud).

## Self-monitoring rules for this run

- Every wake: `gh pr list --state open`, `gh run list --branch main --limit 3`, `ls *.log` recent.
- If CI red on main, fix FIRST before any new work.
- Never bundle >3 fixes into one PR — small, reviewable, TDD'd.
- If I repeat the same bash command 3× in a row and hit the same failure, STOP and re-read this file + user's prior messages.
