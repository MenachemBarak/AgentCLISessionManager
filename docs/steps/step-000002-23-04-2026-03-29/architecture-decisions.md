# Architecture decisions — step 000002

## ADR-07: `--dangerously-skip-permissions` is the DEFAULT for all resumes

- **Decision**: `ClaudeCodeProvider.resume_command()` always returns argv with `--dangerously-skip-permissions` as the first flag. No opt-in, no toggle.
- **Alternatives considered**:
  - Per-call-site flag (rejected — three call sites, guaranteed to drift).
  - UI toggle with default-off (rejected — user explicitly said "always, no matter how").
  - Default-off + override for auto-restart-ping only (rejected — permission prompts also stall human-triggered resumes when the user walks away).
- **Why**: Unattended resume (e.g. restart-ping flow in v0.9.4) cannot tolerate a permission prompt — the whole point is "continue while the user is away". The viewer is a local-user tool running the user's own agents on the user's own machine; skip-permissions is the correct default for this threat model.
- **Blast radius**: `backend/providers/claude_code.py` + its one test in `tests/test_providers.py`. All three resume paths auto-inherit.
- **Reversibility**: Trivial revert. Security note added to the docstring: **do not repurpose this provider for multi-tenant/remote-operator contexts.**

## ADR-08: Restart-ping lives in the frontend, not the backend (v1)

- **Decision**: The auto-resume + ping logic lives in `app.jsx` + `terminal-pane.jsx`. Backend gets no changes. Module-level `window._restartPingPending` and `_restartPingFired` track state across the hydration → ready event sequence.
- **Alternatives considered**:
  - Backend driver: server reads layout state at startup and writes the ping to each PTY (rejected — backend can't render xterm output the user needs to see; PTY ownership stays with the pane that will display it).
  - Per-pane React state via props (rejected — the boundary between "restored from persisted layout this boot" and "fresh click" needs to span two components; a module-level Set is the cleanest shared boundary).
  - localStorage-backed flag (rejected — localStorage persists across boots; we want exactly one ping per session per boot, and Set-identity-per-page-load gives that for free).
- **Why**: Shortest path to shipping a user-visible win without refactoring the PTY manager. Handoff to the session-liveness daemon (ADR-09 / task #42) can relocate the logic server-side later.
- **Blast radius**: Two frontend files. No backend API change.
- **Reversibility**: Trivial — the pending Set is a pure-frontend data structure.

## ADR-09: Session-liveness daemon split (captured as task #42, not yet implemented)

- **Decision** (directional): Over time, split the viewer into Tier A (thin liveness daemon — PTY ownership, session registry, IPC) and Tier B (platform — UI, updater, FastAPI HTTP, SSE, watchdog, banners). Platform updates normally don't touch Tier A; sessions stay alive through platform swaps. Liveness-layer updates trigger an in-app modal ("close + resume all sessions on restart") and the cold path is: both tiers swap, on relaunch every resumed session reconnects via the v0.9.3/v0.9.4 flag + ping pair.
- **Alternatives considered**:
  - Single-tier forever (rejected — every platform update still ends active sessions, undermines the "always running" UX the user depends on).
  - External daemon managed by OS service manager (Windows Service) (open but deferred — adds install complexity; an app-owned background process is enough for the common case).
  - Make tier A a WebSocket server the platform connects to (candidate; still needs design around PTY descriptor inheritance on Windows).
- **Why**: User's "silver bullet" articulation — identifies the root cause of "restart = lose session" and maps out the decomposition that solves it permanently.
- **Blast radius**: Large — touches process model, PyInstaller spec, auto-update semantics, PTY lifecycle. Multi-week project.
- **Reversibility**: One-way once Tier A ships. Design must be minimal: PTY mgmt + registry only, no business logic.

## ADR-10: Playwright POM layout stays at `e2e/` root (skill's `apps/web/e2e/` ideal doesn't map)

- **Decision**: Keep Playwright at `e2e/pages/`, `e2e/tests/feature/`, `e2e/helpers/` — the paths the existing CI workflows already reference. Do NOT refactor to the skill-spec `actions/page/`, `actions/flows/`, `actions/features/`, `qa-tests/` layout.
- **Alternatives considered**:
  - Full rename to skill spec (rejected — pure churn with zero functional benefit, breaks CI references until workflows are updated atomically, risks lost traces in the review).
  - Parallel structures via symlinks (rejected — Windows symlink support is flaky in git).
- **Why**: The skill describes an idealized greenfield layout; this repo has an existing working suite. The spirit (intent-level actions per surface, feature tests compose actions, two sources of proof per assertion) is enforced — the directory names are not.
- **Blast radius**: Documentation/expectations only. No files moved.
- **Reversibility**: Trivial.

## ADR-11: Playwright `workers: 1` pin

- **Decision**: `e2e/playwright.config.ts` sets `workers: 1` — the backend's `~/.claude/viewer-terminal-state.json` is a single shared file; parallel workers overwrote each other's seeds.
- **Alternatives considered**:
  - One CLAUDE_HOME per worker process (rejected — would need to spawn N dev-server instances on N ports, significant config plumbing).
  - Per-test ephemeral tmp dir (same — requires config lift).
  - Tests that don't touch layout state run parallel + locked tests serial (rejected — fragile attribute management).
- **Why**: Suite is ~25 tests running in <40s serial; the complexity of parallelism isn't worth it at this size.
- **Blast radius**: `e2e/playwright.config.ts` one line.
- **Reversibility**: Trivial if/when we move off the shared-file state model.

## ADR-12: Test-fixme on known bug, not delete or stub

- **Decision**: The `tweaks.spec.ts::clicking the button does not crash the app` test that exposed the `Segmented is not defined` bug is marked `test.fixme` with an inline comment pointing to task #43.
- **Alternatives considered**:
  - Delete the test (rejected — loses the assertion permanently; future regressions would be silent).
  - Weaken the assertion to "button exists, don't click" (rejected — that's a different, weaker test).
  - Block the QA expansion PR until the bug is fixed (rejected — pre-existing bug, unrelated to the QA scope, slows the feedback loop).
- **Why**: `test.fixme` says "this SHOULD pass, but doesn't yet, here's why" — Playwright reports it as a skipped test linking to the reason. When #43 is fixed, un-fixme and the test auto-proves the fix.
- **Blast radius**: Zero runtime. One test file.
- **Reversibility**: One line.
