# Tickets

Live queue of work items tracked across branches. Completed items drop off; active ones stay with branch + PR links. Parked items sit at the bottom with a clear "why parked" so they're easy to pick back up.

## Active

_(none — queue is clear)_

## In-flight

- **T-59 Rescan button surfaces ghost-marker count** — PR [#94](https://github.com/MenachemBarak/cli-manager/pull/94)
  - Backend already returned `staleActiveMarkersRemoved`; UI was throwing it away. Transient "cleaned N stale" / "no ghosts" label next to the Rescan button.

## Ready to pick up (no branch yet)

- **T-56 Visual dogfood of v1.2.15 fixes** — manual verification in the installed exe (human-only)
  1. Split a pane running a live agent — agent should NOT restart
  2. Resume a session older than the token threshold — should auto-pick option 2 without user input
  3. Close a PowerShell hosting `claude`, wait 10s, click Rescan — ghost marker should disappear (+ "cleaned 1 stale" feedback label once T-59 lands)
  4. Start a `claude` in external PowerShell — 'Open in manager' button should appear in left pane

- **T-58 Worktree spawn recipe (from claude-squad research)** — inspired by `smtg-ai/claude-squad`
  - "New worktree for this session" flow: `git worktree add <path>; spawn shell there`
  - Out of scope until daemon split (#42) is further along

- **T-60 Root-cause fix for session-move full-suite flake** (session-move.spec.ts:112)
  - Pre-existing before today's session. Test passes in isolation; flakes in full suite.
  - Suspected cause: `_INDEX` state leaking from prior specs even after `force=True` rebuild.
  - Needs proper backend isolation (per-spec app instance?) or test-mode toggle that pins a fresh fixture root.

## Parked

- **T-54 Integrate tmux detach/reattach into #42 Phases 8-10**
  - **Why parked:** depends on opt-in daemon mode (AGENTMANAGER_DAEMON=1) getting dogfooded first. Tmux research captured in `playgrounds/tmux/` (cloned 2026-04-24). When unparked: study `server.c` + `tty.c` reattach handshake, then write an ADR for AgentManager's equivalent.

## Recently shipped (today — 2026-04-24)

| PR | Task | Impact |
|---|---|---|
| [#85](https://github.com/MenachemBarak/cli-manager/pull/85) | T-49 red E2E (msg-copy timeout) | E2E main was red for 10+ runs; now green |
| [#86](https://github.com/MenachemBarak/cli-manager/pull/86) | T-50 splits-kill-PTYs (portal refactor) | **Critical** — user-reported; agents now survive splits |
| [#87](https://github.com/MenachemBarak/cli-manager/pull/87) | T-51 resume-menu digit-pick + shell-wrap sid | Auto-resume now actually picks option 2, works on v1.1.0+ tabs |
| [#88](https://github.com/MenachemBarak/cli-manager/pull/88) | T-53 ghost-active PID-reuse defense | User-reported; closed PowerShell no longer leaves ghost markers |
| [#89](https://github.com/MenachemBarak/cli-manager/pull/89) | T-52 'Open in manager' for active-unmanaged | User-requested; adopt externally-started agents into the UI |
| [#90](https://github.com/MenachemBarak/cli-manager/pull/90) | T-55 bump to v1.2.15 | Release cut, installed on user's machine |
| [#91](https://github.com/MenachemBarak/cli-manager/pull/91) | T-57 stabilize msg-copy + bump session-move poll | msg-copy no longer flaky |
| [#92](https://github.com/MenachemBarak/cli-manager/pull/92) | T-57 stabilize shell-wrap-runtime | shell-wrap-runtime no longer flaky |
| [#93](https://github.com/MenachemBarak/cli-manager/pull/93) | Docs: bump stale v0.7.1 refs to v1.2.15 | README pipx install line + CHANGELOG compare-link now correct |
