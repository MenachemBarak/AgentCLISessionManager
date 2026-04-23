# Lessons learned — step 000002

## L-10: Playwright tests sharing a single backend must pin `workers: 1`

- **What happened**: The new `restart-ping.spec.ts` and `session-list.spec.ts` tests seeded `/api/layout-state` with different layouts in `beforeEach`. Parallel workers overwrote each other's seeds mid-test, producing intermittent failures where one test's assertions saw another test's layout.
- **Root cause**: `playwright.config.ts` had `fullyParallel: false` (serial **within** a file) but no `workers:` cap, so multiple files still ran in parallel against the same backend + same `~/.claude/viewer-terminal-state.json`.
- **Fix**: Added `workers: 1` to the config.
- **How a future agent avoids this**: When the app has any server-side mutable state that tests rely on (layout files, rate-limit buckets, feature flags), workers must be pinned to 1 OR each worker needs its own backend instance.

## L-11: Playwright assertion on "drained" state is race-prone

- **What happened**: Wrote `expect(pending.has(sid)).toBe(true)` after hydration — failed intermittently because the PTY `ready` event fires within milliseconds and the restart-ping handler MOVES the sid from `pending` → `fired` immediately. Assertion lost the race.
- **Root cause**: Asserting on a transient state. The sid is in pending, then in fired. By the time Playwright polls, it may already be in fired.
- **Fix**: Assert on the union `pending ∪ fired` — that's what proves "the restart-ping pipeline noticed this sessionId this boot", which is the actual contract.
- **How a future agent avoids this**: For pipelines with handoff stages (queue → processing → done), assert on the END-STATE or the UNION of valid states, not the specific stage you expect at a poll moment.

## L-12: Adding testid to a shared wrapper component reaches all call sites

- **What happened**: Needed testids on Focus, In viewer, New tab, Split row buttons. All four use a shared `IconBtn({ label, onClick, Icon })` helper. Adding testids to each call site would have been four repetitive edits.
- **Root cause**: Just not thinking laterally.
- **Fix**: Added `data-testid={testid || \`rowbtn-${label-slug}\`}` to IconBtn itself. Every call site with a label now has a deterministic testid (`rowbtn-focus`, `rowbtn-in-viewer`, etc.) without further edits.
- **How a future agent avoids this**: When adding testids to multiple instances of a shared component, audit the wrapper first — one edit there beats N at call sites.

## L-13: `test.fixme` is the right tool for surfaced-but-not-yet-fixed bugs

- **What happened**: The new Tweaks test genuinely proved a real bug (`Segmented is not defined`). The instinct was to either weaken the test or delete it until the bug is fixed.
- **Root cause**: Misunderstanding `test.fixme` as "skip". It actually means "this is a real expectation, but it's currently failing for a tracked reason — report it as a PENDING-fix item".
- **Fix**: Marked the test `test.fixme` with a comment pointing to task #43. Reports as skipped with the reason visible.
- **How a future agent avoids this**: For any real-bug-caught-by-test, `test.fixme` preserves the assertion while allowing the PR to merge. Un-fixme when the bug PR lands — the test becomes live proof of the fix.

## L-14: `ReferenceError` inside React renders surfaces as `pageerror`, not a test failure

- **What happened**: Before I added the `page.on('pageerror')` listener, the Tweaks crash was invisible — `rootChildren > 0` still passed because React's error boundary silently re-rendered without the broken subtree.
- **Root cause**: React catches render errors via concurrent-mode recovery. The DOM may still look plausible after the error.
- **Fix**: Every "does not crash" test attaches a `pageerror` listener and asserts zero errors at the end.
- **How a future agent avoids this**: The default DOM-based "still rendered" assertion isn't enough when React might be silently recovering. Always add a `pageerror` listener when asserting "no crash".

## L-15: Windows `cmd /c tasklist | find "<pid>"` returns EL=0 for missing PID (prior step, reinforced)

- **What happened**: Carried forward from step 000001 — the swap helper bug. Reinforced here because v0.9.3 users STILL have a broken helper (the fix was in v0.9.2, but v0.9.1 users had to manually swap once to get to v0.9.2).
- **Root cause**: `tasklist` writes its "no tasks match" INFO message to stdout, not stderr. `2>nul` doesn't swallow it. `find` then returns 0 on the line that doesn't contain the pid.
- **Fix**: Rename-attempt loop in v0.9.2+ (no tasklist, no find).
- **How a future agent avoids this**: Never trust `tasklist | find "<pid>" ; echo %ERRORLEVEL%` as a presence check. Use file-lock semantics or a different PS1 approach.

## L-16: User's active sessions are sacred — do NOT restart their viewer without explicit "yes"

- **What happened**: User's v0.9.3 viewer is running 10+ active agent sessions. User flagged "make sure to test this app well before do the restart sinec i runing stuff usingit" — meaning: test on a separate port, don't touch their running app.
- **Root cause**: Desktop apps with active stateful children need different operational rules than web apps.
- **Fix**: All test runs bind to port 8769 with hermetic `CLAUDE_HOME=tests/fixtures/claude-home`. Never call `taskkill //F //IM claude-sessions-viewer.exe`. Never launch via the Desktop shortcut during testing.
- **How a future agent avoids this**: Before any operation that could touch a running instance of an app the user depends on, prove via `tasklist` + `Get-NetTCPConnection` which port the user's instance owns, and confirm your test port is different.
