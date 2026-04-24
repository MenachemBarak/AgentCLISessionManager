# Tickets

Live queue of work items tracked across branches. Completed items drop off; active ones stay with branch + PR links. Parked items sit at the bottom with a clear "why parked" so they're easy to pick back up.

## Active

_(none — queue is clear, cutting v1.2.15)_

## In-flight

- **T-55 Release v1.2.15** — bundle #85-#89 into a tagged release + install on user's machine
  - Branch: `chore/bump-v1.2.15`
  - Status: PR pending
  - Blocks all later work (ADR-26 cadence policy — ship what's merged before adding more)

## Ready to pick up (no branch yet)

- **T-56 Visual dogfood of v1.2.15 fixes** — manual verification in the installed exe
  1. Split a pane running a live agent — agent should NOT restart
  2. Resume a session older than the token threshold — should auto-pick option 2 without user input
  3. Close a PowerShell hosting `claude`, wait 10s, click Rescan — ghost marker should disappear
  4. Start a `claude` in external PowerShell — 'Open in manager' button should appear in left pane
  - No branch needed; just a runbook to execute after install

- **T-57 Stabilize msg-copy + session-move flakies** — both surface as "flaky" on every full-suite run
  - `msg-copy.spec.ts` fails intermittently even with the #85 fix + 2 retries
  - `session-move.spec.ts:112` "session disappeared from list after 5s poll"
  - Both are test-order-dependent; real root cause likely in shared fixture state

- **T-58 Worktree spawn recipe (from claude-squad research)** — inspired by `smtg-ai/claude-squad`'s worktree-per-agent model
  - Add an optional "new worktree for this session" flow: `git worktree add <path>; spawn shell there`
  - Would let users run multiple parallel agents on the same repo without git conflicts
  - Needs UX design; out of scope until daemon split (#42) is further along

## Parked

- **T-54 Integrate tmux detach/reattach into #42 Phases 8-10**
  - **Why parked:** depends on opt-in daemon mode (AGENTMANAGER_DAEMON=1) getting dogfooded first. Tmux research is captured in `playgrounds/tmux/` (cloned 2026-04-24). When unparked: study `server.c` + `tty.c` reattach handshake, then write an ADR for AgentManager's equivalent.

## Recently shipped (last 7d)

- **T-49 / PR #85** Fix red E2E (msg-copy timeout) — 2026-04-24
- **T-50 / PR #86** Fix splits-kill-PTYs (portal refactor) — 2026-04-24
- **T-51 / PR #87** Resume-menu digit-pick + shell-wrap sid — 2026-04-24
- **T-52 / PR #89** 'Open in manager' for active-unmanaged sessions — 2026-04-24
- **T-53 / PR #88** Ghost-active PID-reuse defense — 2026-04-24
