# Lessons Learned — step 000006 (29-04-2026)

## 1. Hooks in `~/.claude/settings.json` encode absolute paths — move breaks them silently

**What happened:** On first session start after moving project from `M:\` to `C:\projects\agent-manager`, the SessionStart + UserPromptSubmit hooks fired with:
```
M:\UserGlobalMemory\...\claude-sessions-viewer\.venv\Scripts\python.exe: No such file or directory
```
User noticed because the hook error was visible in the screenshot.

**Root cause:** Claude Code hooks are stored with hard-coded absolute paths. Moving the project directory does not auto-update hook commands.

**Fix applied:** Edited both hook entries in `~/.claude/settings.json` to use `C:\projects\agent-manager\.venv\Scripts\python.exe` and `C:\projects\agent-manager\hooks\session_start.py`.

**How a future agent avoids this:** After ANY project relocation, immediately read `~/.claude/settings.json` and search for the old path. Update all occurrences before the next session start.

---

## 2. Session JSONL files can contain binary PTY output — reading them can fail with codec errors

**What happened:** Attempting to read the primary session JSONL file `521f89a8-fdfc-403a-894e-c8f1c1b7ff1f.jsonl` for session history failed with:
```
'charmap' codec can't decode byte 0x90 in position ...
```

**Root cause:** PTY output (terminal escape sequences, binary blobs from process output) gets embedded in JSONL messages. The file is UTF-8 but the Read tool's codec on Windows defaulted to cp1252 for portions of it.

**Fix applied:** Used step snapshot files under `docs/steps/` as the authoritative session history source instead. These are pure markdown and always readable.

**How a future agent avoids this:** Don't rely on raw JSONL for session history synthesis. Use `docs/steps/` step files as the primary history source. If you must read JSONL, use a Python script with `errors='replace'` to handle malformed bytes.

---

## 3. `pip install -e ".[test]"` after a project move can silently upgrade packages

**What happened:** After reinstalling at the new path, fastapi bumped `0.115 → 0.136` and starlette `0.38 → 1.0`. This caused 30 new deprecation warnings (`@app.on_event` removed in FastAPI 0.136).

**Root cause:** `pyproject.toml` uses `>=` floor constraints. `pip` resolves to the latest compatible version on a fresh install.

**Fix applied:** No action taken — the upgrade was acceptable. Tests still pass (288 passed, 30 warnings).

**How a future agent avoids this:** Before reinstalling after a move, pin exact versions with `pip freeze > requirements-lock.txt` to detect unexpected upgrades. The `@app.on_event` warnings are now tech debt in `backend/app.py` lines 584 + 1851.

---

## 4. The old project path exists as `deprecated-agent-manager` — not as `claude-sessions-viewer`

**What happened:** Searching for Claude Code session files under the old M:\ path found a directory named `deprecated-agent-manager` (not `claude-sessions-viewer`). The project was renamed at some point before the move. Only 2 session files existed there, not 5.

**Root cause:** The project was renamed at M:\ before being moved to C:\. Session history predating the rename is inaccessible via directory lookup.

**Fix applied:** Used all available session files (2) plus step snapshot files for history synthesis.

**How a future agent avoids this:** When searching for historical sessions, look for BOTH the current name AND any deprecated/renamed variants. Check git log for old directory references.

---

## 5. Proof-before-claiming-done rule: API 200 ≠ UI renders

**What happened:** (Historical, from step snapshots) v0.9.0 shipped a completely black pywebview window that passed all API health checks.

**Root cause:** The `/api/status` endpoint returned 200 but the frontend JavaScript failed to load because CDN resources were unavailable. The test suite never opened a real browser.

**Fix applied (v1.2.18):** Vendored all CDN deps into `backend/frontend/vendor/`. 

**How a future agent avoids this:** For any UI change or release, open the app in a real browser (or use Playwright to assert a known DOM element renders) before declaring done. An API 200 is NOT proof the UI works.

---

## 6. Playwright/Chromium intercepts `Ctrl+W` and `Alt+Shift+H/V` — these shortcuts are untestable in CI

**What happened:** (Historical) E2E specs for close-tab (`Ctrl+W`) and split-pane (`Alt+Shift+H/V`) were skipped because Playwright/Chromium intercepts these keystrokes at the browser level before they reach the app.

**Root cause:** These are browser-level shortcuts in Chromium. pywebview in production mode handles them correctly, but Playwright-driven browser does not.

**How a future agent avoids this:** Do not write Playwright tests for these shortcuts. They work in production but cannot be tested in the Playwright harness. Mark any such test as `.skip` with a comment explaining the platform limitation.

---

## 7. Daemon e2e specs are intentionally failing TDD stubs — do not try to fix them

**What happened:** Running `npx playwright test` shows 5 spec files in `e2e/tests/daemon/` failing. These are NOT regressions.

**Root cause:** Written TDD-style before ADR-18 Phases 8-10 are implemented. They define expected behavior, not current behavior.

**How a future agent avoids this:** Never try to "fix" failing daemon specs. They will pass naturally when ADR-18 Phases 8-10 are implemented. The CI pipeline excludes them from the gate.
