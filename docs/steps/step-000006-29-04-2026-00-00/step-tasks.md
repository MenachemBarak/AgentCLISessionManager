# Step Tasks — step 000006 (29-04-2026)

## Task 1: Clean and rebuild project after relocation

**Task:** Delete all build artifacts and reinstall Python package at new project path `C:\projects\agent-manager`.

**State BEFORE:** Project at `C:\projects\agent-manager` had stale `build/`, `dist/`, `claude_sessions_viewer.egg-info/`, `.coverage`, and `__pycache__` directories from the M:\ origin. Package was either not installed at new path or installed with wrong paths.

**State AFTER:** All artifacts deleted. `pip install -e ".[test]"` completed successfully. Package installs cleanly. `claude_sessions_viewer.egg-info/` regenerated at new path. FastAPI upgraded 0.115→0.136, starlette 0.38→1.0 (within `pyproject.toml` floor constraints).

**Files touched:**
- Deleted: `build/`, `dist/`, `*.egg-info/`, `.coverage`, all `__pycache__/`
- Regenerated: `claude_sessions_viewer.egg-info/`

**Related prior steps:** N/A (project move is new)

**Related sibling files:** lessons-learned.md §3 (pip upgrade side effects)

---

## Task 2: Fix broken Claude Code hooks (M:\ → C:\ path)

**Task:** Update `~/.claude/settings.json` SessionStart and UserPromptSubmit hooks from old M:\ path to new C:\ path.

**State BEFORE:** Both hooks pointed to:
```
M:\UserGlobalMemory\global-memory-plane\projects\claude-sessions-viewer\.venv\Scripts\python.exe
```
Error on session start: `python.exe: No such file or directory`

**State AFTER:** Both hooks updated to:
```
C:\projects\agent-manager\.venv\Scripts\python.exe C:\projects\agent-manager\hooks\session_start.py
```

**Files touched:**
- `C:\Users\User\.claude\settings.json` — both `SessionStart` and `UserPromptSubmit` hook commands

**Related prior steps:** N/A

**Related sibling files:** lessons-learned.md §1, knowledge.md (Claude Code hooks section), maintenance.md (hooks section)

---

## Task 3: Full onboarding — read all .md files and store in memory

**Task:** Read 200 lines of each .md file in the project, learn project structure, and persist to auto-memory system.

**State BEFORE:** No memory files existed at `~/.claude/projects/C--projects-agent-manager/memory/`.

**State AFTER:** Memory system fully populated:
- `MEMORY.md` — index file
- `project_overview.md` — what AgentManager is
- `folder_structure.md` — repo layout
- `architecture.md` — key architectural patterns
- `release_workflow.md` — version/changelog/release process
- `project_location.md` — project move history
- `status_2026_04_29.md` — full development status snapshot
- `user_preferences.md` — mandatory rules for working on this project

**Files touched:**
- All files under `~/.claude/projects/C--projects-agent-manager/memory/` (created)
- Read: `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `ARCHITECTURE.md`, `RELEASE.md`, `TROUBLESHOOTING.md`, `e2e/README.md`, `docs/design/adr-18-daemon-split.md`, all 5 prior step files

**Related prior steps:**
- `docs/steps/step-000001-*/` through `docs/steps/step-000005-*/` — all read for history

**Related sibling files:** knowledge.md, architecture-decisions.md

---

## Task 4: Analyze last 10 commits and synthesize development status

**Task:** Run `git log`, read PR diffs, identify what's done vs. pending, produce a status snapshot.

**State BEFORE:** No current-state synthesis existed in memory.

**State AFTER:** `status_2026_04_29.md` memory file written with:
- Full table of last 10 commits (#104-#112 + v1.2.18)
- In-flight items: T-62 (coverage), ADR-18 Phases 8-10, T-56 (dogfood), T-58/T-54 (parked)
- Coverage breakdown per module
- Next logical work items by priority
- Task completion status for tasks #39-#42

**Commits analyzed:**
- `055a243` v1.2.18 vendor CDN deps
- `f54bd0f` #112 claude_code.py coverage 58%→95%
- `7d4e835` #111 cli.py coverage 50%→82%
- `a7530d1` #110 watcher bug fix T-60
- `b8521e6` #109 e2e Active row Focus + Open in manager
- and 5 earlier (#104-#108)

**Files touched:** `~/.claude/projects/C--projects-agent-manager/memory/status_2026_04_29.md` (created)

**Related prior steps:** `docs/steps/step-000005-*/` — tickets.md sync from Apr 24-25 run

**Related sibling files:** knowledge.md (coverage table), maintenance.md (test commands)

---

## Task 5: Write step-000006 snapshot files

**Task:** Capture all onboarding research into 6 step snapshot files.

**State BEFORE:** `docs/steps/step-000006-29-04-2026-00-00/` directory existed but only `user-notes.md` had been written (written before session was summarized/compacted).

**State AFTER:** All 6 files written:
- `user-notes.md` ✓ (written pre-compaction)
- `knowledge.md` ✓
- `architecture-decisions.md` ✓
- `lessons-learned.md` ✓
- `maintenance.md` ✓
- `step-tasks.md` ✓ (this file)

**Files touched:**
- `docs/steps/step-000006-29-04-2026-00-00/knowledge.md`
- `docs/steps/step-000006-29-04-2026-00-00/architecture-decisions.md`
- `docs/steps/step-000006-29-04-2026-00-00/lessons-learned.md`
- `docs/steps/step-000006-29-04-2026-00-00/maintenance.md`
- `docs/steps/step-000006-29-04-2026-00-00/step-tasks.md`

**Related prior steps:** All 5 prior steps read as input.

**Related sibling files:** All other files in this step.

---

## Task 6: Create onboard.md for future agents

**Task:** Write `docs/onboard.md` documenting the onboarding process for new agents — what to read, in what order, what commands to run, what memory to store.

**State BEFORE:** No onboard.md existed.

**State AFTER:** `docs/onboard.md` created with complete onboarding playbook.

**Files touched:**
- `docs/onboard.md` (created)

**Related prior steps:** All prior steps informed the content.

**Related sibling files:** knowledge.md (file paths), maintenance.md (commands)
