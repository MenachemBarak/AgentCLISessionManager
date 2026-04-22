# Lessons learned — step 000001

Every friction point in this window with root cause + avoidance.

## L-01: `/api/status` returning 200 is NOT proof the UI renders

- **What happened**: v0.9.0 shipped with a completely black pywebview window. I declared it "proven" because `/api/status` returned `{"version":"0.9.0","ready":true}`. The user provided a screenshot showing the actual blank UI.
- **Root cause**: Two bugs compounded: (a) a probe earlier in this repo wrote `kind:"leaf"` into `~/.claude/viewer-terminal-state.json`, and (b) `TileTree` fell through to the split branch on unknown kinds and crashed on `tree.children[0]`. React unmounted the whole tree. `/api/status` is served by uvicorn regardless of whether React mounted.
- **Fix**: TileTree defensive migration — unknown kinds → fresh pane, splits lacking 2 children → fresh pane. Shipped in v0.9.1.
- **How a future agent avoids this**: Before declaring ANY release ready, open it in a real browser and assert `document.getElementById('root').children.length > 0` AND query for a known element (title bar text matching `/^v\d+\.\d+\.\d+$/`). The Playwright `app-boots.spec.ts` test does exactly this — run it before claiming done.

## L-02: Windows `find` returns EL=0 on missing match on some cmd builds

- **What happened**: v0.9.0's swap helper polled `tasklist /FI "PID eq <pid>" | find "<pid>"` and checked `%ERRORLEVEL%`. Helper sat in an infinite loop after the app exited — never promoted `.new`. Reproduced on this machine directly:
  ```
  > tasklist /FI "PID eq 45664" 2>nul | find "45664" >nul & echo EL=%ERRORLEVEL%
  EL=0
  ```
  even though PID 45664 was long gone. `tasklist` prints its "no tasks match" line to **stdout** (not stderr, so `2>nul` doesn't swallow it), and `find` on that line under the shell context we're in was returning 0.
- **Root cause**: Fragile shell semantics. Also `2>nul` suppresses stderr that tasklist doesn't use for this message.
- **Fix**: Stop polling PIDs. Use `ren live → live.old` as the readiness signal — Windows' exclusive image-file lock does the work for us. Shipped in v0.9.2.
- **How a future agent avoids this**: Avoid `find` + `%ERRORLEVEL%` for presence checks in Windows batch. Prefer OS-level invariants (file locks, mutex names, or port-bind checks) over shell-level output parsing.

## L-03: `Start-Process` + next step on GH Actions orphans the child

- **What happened**: The `e2e (built exe)` CI job launched the exe in step N (readiness probe succeeded) and ran Playwright in step N+1 — every test failed with `ERR_CONNECTION_REFUSED`. Exe was ready at 21:10:01, Playwright hit a dead port at 21:10:10.
- **Root cause**: GH Actions runners reparent/kill detached children between pwsh step boundaries even with `-WindowStyle Hidden` and `-PassThru`.
- **Fix**: Combine launch + test + cleanup into a single pwsh step with a try/finally block so the exe is pinned to the step's shell lifetime.
- **How a future agent avoids this**: Long-running background processes on GH Actions Windows runners should stay inside the step that uses them. Use `try/finally` with `Stop-Process` in the finally. Split-step approaches require `detach` + named pipes or similar, which isn't worth it for test harnesses.

## L-04: PyInstaller `console=False` swallows stdout/stderr — invisible crashes

- **What happened**: Earlier e2e-exe attempts failed with the exe "never becoming ready" but no error output. Startup crashes produced zero signal.
- **Root cause**: The frozen exe is built windowed (`console=False`) so Python's default stdout/stderr have no backing file.
- **Fix**: On CI launch, use `Start-Process -RedirectStandardOutput` / `-RedirectStandardError` to files under `$RUNNER_TEMP` and dump them (wrapped in `::group::`) whenever the readiness probe times out OR Playwright exits non-zero.
- **How a future agent avoids this**: ALWAYS redirect stdout+stderr when running a `console=False` PyInstaller exe in CI. Free diagnostic for ~2 lines of boilerplate.

## L-05: Ruff version skew between local (0.15) and pre-commit pin (0.7.4)

- **What happened**: Local `ruff format` reflowed `tests/test_watcher.py` in a way that CI's pinned ruff 0.7.4 then tried to revert. Ruff-format CI check failed repeatedly.
- **Root cause**: Format rules changed between ruff 0.7 and 0.15 for multiline assertion continuation.
- **Fix**: Install `ruff==0.7.4` locally to match pre-commit, revert the reformat.
- **How a future agent avoids this**: Before running `ruff format` on this repo, `pip install "ruff==0.7.4"`. Alternatively, bump the pre-commit rev in a dedicated PR — don't ride along in a feature PR.

## L-06: `CLAUDE_HOME` missing on CI → session list empty → `waitReady` hangs

- **What happened**: First e2e-dev run hit `TimeoutError: waitForFunction` in `SessionList.waitReady` — CI's empty `~/.claude` meant zero sessions, and I'd fabricated a `data-testid="session-empty-state"` selector that doesn't exist.
- **Root cause**: Two mistakes: no `CLAUDE_HOME` in the webServer env, and a test selector assumption.
- **Fix**: (a) Set `CLAUDE_HOME=tests/fixtures/claude-home` in playwright webServer env + e2e-exe job env. (b) `waitReady` now accepts any of the list pill texts (`FOLDERS`, `ACTIVE`, `no sessions`).
- **How a future agent avoids this**: Never fabricate a `data-testid` that doesn't exist in source — grep for it first. For tests that depend on fixture data, point the backend at the fixtures dir explicitly.

## L-07: Apply endpoint has three refusal guards; tests need to accept all three

- **What happened**: `update-flow.spec.ts::apply endpoint refuses gracefully in dev mode` passed on the dev server (which returns "packaged .exe") but failed on the built exe (which returns "no staged update" because it reaches a later guard). Regex was too narrow.
- **Root cause**: Dev server vs frozen exe → different guard fires → different message. Test didn't account for the split.
- **Fix**: Broaden the regex to `/windows|packaged|staged/` and rename the test to "refuses gracefully when nothing is staged".
- **How a future agent avoids this**: When a test covers multiple runtime modes (dev server + frozen exe), enumerate the guards exercised in each mode before writing assertions.

## L-08: Self-update bootstrap — a broken helper in released version can't fix itself

- **What happened**: v0.9.1 shipped with v0.9.0's broken helper (the fix landed in v0.9.2). When I triggered the self-update from v0.9.1 → v0.9.2, the helper still used `tasklist | find` and hung. Had to complete the swap manually.
- **Root cause**: Unavoidable — the helper that runs during an upgrade is the CURRENTLY-INSTALLED version's helper, not the new one's. Fix-for-a-bug-in-the-auto-updater always needs a manual swap the first time.
- **Fix**: Documented the bootstrap gap; v0.9.2 onwards is self-healing.
- **How a future agent avoids this**: When modifying the self-update helper itself, call out the one-time manual swap explicitly in the release notes. Consider shipping a separate "fixer" that pre-runs before the next upgrade, or an API-mode swap trigger that the USER runs rather than the app.

## L-09: PID loop printed tab in Windows Terminal (the `find "65444"` popup)

- **What happened**: While v0.9.1's broken helper spun, a Windows Terminal tab titled `find "65444"` flashed onto the user's desktop. User asked "why it pops up like that".
- **Root cause**: `subprocess.Popen(["cmd.exe", "/c", script])` with `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` — each `find.exe` that cmd.exe spawns inside the loop inherits a detached console, which Win 11's default-terminal setting surfaces as a visible tab.
- **Fix**: Not needed in v0.9.2 — the helper has no `find` at all. The problem disappears as a side effect.
- **How a future agent avoids this**: On Windows 11 with Windows Terminal set as default, detached console children can surface visibly even under `CREATE_NO_WINDOW`. Avoid spawning console children from a helper; prefer OS primitives.
