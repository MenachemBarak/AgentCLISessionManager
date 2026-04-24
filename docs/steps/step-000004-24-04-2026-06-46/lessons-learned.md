# Lessons learned — step 000004

## L-22: v1.1.0 persisted legacy-shape tabs died silently in production

- **What happened**: User downloaded v1.1.0. Every persisted session tab showed "session exited" on boot. Screenshot confirmed the `cc-<sid>` tab was dead immediately.
- **Root cause**: v1.1.0 shifted new `openInViewer` clicks to shell-wrap (`{cmd:['cmd.exe'], _autoResume}`), but layouts persisted under v0.9.x / v1.0.x still carry `{provider:'claude-code', sessionId, cwd}`. On rehydrate, the legacy shape routed through `_resolve_pty_command` → `ClaudeCodeProvider.resume_command()` → `argv[0]='claude'`. In the PyInstaller frozen exe, the inherited PATH does NOT include where `claude.exe` lives → pywinpty spawn fails with file-not-found → PTY dies instantly.
- **Fix**: `app.jsx::migrateLegacyTerminals` walks every restored tab tree and rewrites legacy-shape leaves to shell-wrap shape in place. Debounced persist effect re-writes the file so subsequent boots start clean.
- **Future avoidance**: Whenever you change a persisted data shape, ADD A MIGRATION. The failing-test-first e2e (`legacy-layout-migration.spec.ts`) seeded the legacy shape via the existing `seedResumableTab` helper and intercepted the WS spawn frame — did not rely on visible DOM text.

## L-23: PyInstaller one-file bootloader's `_MEI` cleanup race is not suppressible from Python

- **What happened**: User saw "Failed to remove temporary directory: C:\Users\User\AppData\Local\Temp\_MEI189562" MessageBox dialog on app restart after self-update.
- **Root cause**: One-file mode extracts the bundled exe to `%TEMP%\_MEI<pid>\` on startup. On shutdown the bootloader tries to `rmrf` that dir; pywinpty's DLLs are still releasing handles → `RemoveDirectory` fails → MessageBox fires. No Python-side handler can suppress it because the dialog is thrown by the bootloader stage-3 cleanup after Python has exited.
- **Fix**: Switched the INSTALLER to PyInstaller one-folder mode via new `pyinstaller-onedir.spec`. One-folder mode has no runtime extraction → no `_MEI` → no dialog. The raw one-file .exe still publishes for back-compat auto-update.
- **Future avoidance**: For any desktop PyInstaller project with native DLL children (pywinpty, PyQt, pygame, etc.), default to one-folder from the start. One-file is only worth it for tiny CLI tools.

## L-24: Git-Bash on Windows MSYS-translates `/D...` args → iscc mangles them

- **What happened**: First v1.2.0 release failed on "Build installer" step. `iscc` reported `You may not specify more than one script filename`.
- **Root cause**: GitHub Actions `shell: bash` on windows-latest is Git-Bash (MSYS). MSYS auto-translates any argument starting with `/` into a filesystem path like `C:/Program Files/Git/D...`. Inno Setup's `/D<var>=<value>` flags became paths. ISCC saw them as additional script filenames.
- **Fix**: Switched the "Build installer" step to `shell: pwsh`. PowerShell doesn't path-translate. Documented the reason in the step comments.
- **Future avoidance**: For any Windows exe that takes `/<flag>` arguments (most Microsoft tools: `msbuild`, `signtool`, `iscc`, `choco`, `powershell`), use `shell: pwsh` OR set `MSYS_NO_PATHCONV=1` in the bash env.

## L-25: Ruff pre-commit pin is authoritative; local ruff version drift = CI churn

- **What happened**: Three consecutive CI red runs on PR #55 despite local ruff check+format clean. Each iteration the CI's pre-commit ran ruff 0.7.4 (pinned in `.pre-commit-config.yaml`) and demanded different formatting than my local ruff 0.14.
- **Root cause**: `.pre-commit-config.yaml` pins `astral-sh/ruff-pre-commit` at `rev: v0.7.4`. My local pip had a newer major. Different ruff versions normalize different things (e.g. collapse-or-split multi-line conditionals, implicit string concat).
- **Fix**: `pip install --quiet "ruff==0.7.4"` locally. Now I match CI exactly.
- **Future avoidance**: After cloning/onboarding, ALWAYS install pre-commit's pinned tool versions. `pre-commit install && pre-commit run --all-files` is the fastest local equivalent to CI's lint job.

## L-26: Bandit B101 forbids plain `assert` — use `typing.cast` for mypy narrowing

- **What happened**: PR #57 failed on bandit (SAST) job. My `assert session is not None` (added to satisfy mypy's union-attr narrowing) was flagged as B101 (`assert_used`).
- **Root cause**: Bandit's B101 rule: `assert` statements are removed under `python -O` so you can't rely on them for runtime safety. It flags every plain assert.
- **Fix**: Replaced `assert session is not None` with `from typing import cast; session = cast(PtySession, session)`. Functionally equivalent for mypy; not flagged by bandit.
- **Future avoidance**: For pure type narrowing (not runtime safety), always prefer `typing.cast`. Save `assert` for tests.

## L-27: Mypy sees Windows-only code as "unreachable" on Linux CI

- **What happened**: CI mypy ran on Linux. My `daemon/bootstrap.py` had `if sys.platform != "win32": return` followed by `try: import ntsecuritycon ...`. Mypy narrowed `sys.platform` to `not "win32"` and reported the entire try block as unreachable.
- **Root cause**: `sys.platform` is typed as `Literal["linux", "darwin", "win32", ...]`. Mypy does narrowing across branches.
- **Fix**: `# type: ignore[unreachable]` on the `try:` line plus `[import-not-found,import-untyped]` on the imports. `warn_unused_ignores = false` in `pyproject.toml::[tool.mypy]` means the Windows local mypy (where the block IS reachable) doesn't complain about the unused ignore.
- **Future avoidance**: For platform-conditional imports, always combine both ignore codes. Check `pyproject.toml` for `warn_unused_ignores` — if it's `true`, you need a different pattern.

## L-28: Pin-to-top bug was in `normalize()`, not in sort

- **What happened**: Pin API + sort all looked correct in unit tests, but the DOM rendered sessions in wrong order after reload.
- **Root cause**: `backend/frontend/data.jsx::normalize()` hand-lists known fields (`id, title, userLabel, ...`) and returns a fresh object. `pinned` wasn't in the list → dropped on every SSE event. The initial `/api/sessions` fetch had `pinned`, but subsequent `session_updated` events stripped it.
- **Fix**: Added `pinned: !!s.pinned` to `normalize()`.
- **Future avoidance**: Any new field added to the backend session shape has to be added to `normalize()` too. There's no schema sync — future-refactor candidate to replace the hand-list with `{...s}` + explicit defaults for mandatory fields.
- **Debugging technique that worked**: Wrote a throwaway probe test (`_probe_pin.spec.ts`) that dumped BEFORE/AFTER/DOM/JSSORT/APIRAW states to console. Within one run, I saw API+sort were right but DOM was wrong → narrowed the problem to between data arrival and render. Saved hours vs reading source.

## L-29: Stale dev server on port 8769 served cached frontend JSX

- **What happened**: Changes to `backend/frontend/utils.jsx` weren't reflected in a re-run test.
- **Root cause**: Playwright `webServer` config has `reuseExistingServer: !process.env.CI` so locally the dev server persists across test runs. It was still serving the old JSX.
- **Fix**: `taskkill /F /PID <python-pid>` then re-run.
- **Future avoidance**: When frontend changes aren't taking effect, kill the python process by PID and re-run. Alternative: set `reuseExistingServer: false` during active development.

## L-30: The step skill's time-formatting uses local time (24-hour) — `date '+%d-%m-%Y-%H-%M'`

- **What happened**: Had to compute the step directory name `step-000004-24-04-2026-06-46` from the current clock.
- **Future avoidance**: Run `date '+%d-%m-%Y-%H-%M'` in Git Bash to get the exact format the skill expects. Don't try to compute it by mental math.
