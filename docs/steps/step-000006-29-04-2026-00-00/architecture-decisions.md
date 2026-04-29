# Architecture Decisions — step 000006 (29-04-2026)

_No new architectural decisions were made in this step — this was an onboarding/audit session. The decisions below are the key standing architectural choices discovered during onboarding research._

---

## Decision: Shell-wrap architecture for session tabs (ADR-15 / v1.1.0)

**Decision:** Session tabs spawn `cmd.exe` as a shell, then type `claude --dangerously-skip-permissions --resume <sid>` into it. `/exit` returns to shell without killing the tab.

**Alternatives considered:** Direct PTY spawn of claude process; killing tab on session end.

**Why:** Allows the user to run other commands in the same terminal after a session ends. Preserves tab for reuse. Prevents zombie PTY processes.

**Blast radius:** `backend/providers/claude_code.py`, `backend/terminal.py`, all e2e specs that interact with terminal tabs.

**Reversibility:** Requires migration — all existing resume flows depend on this shape.

---

## Decision: Keystroke splitting rule — never send `text+\r` in one PTY frame (ADR-15)

**Decision:** Always use `typeIntoPty()` or manually split text and Enter with ≥200ms delay between chunks.

**Alternatives considered:** Sending full command + newline as one string (simpler code).

**Why:** Ink-TUI's bracketed-paste detection ate Enter and compacted real user sessions in v1.0.0 when text and `\r` arrived in the same payload.

**Blast radius:** Every place a command is typed into a PTY: `terminal.py`, `providers/claude_code.py`, any future automation that sends keystrokes.

**Reversibility:** Trivial to revert the code; regression is severe and silent.

---

## Decision: ADR-18 Daemon/UI split — two-exe architecture

**Decision:** Split AgentManager into `AgentManager.exe` (UI, short-lived pywebview) and `AgentManager-Daemon.exe` (FastAPI+PTYs+watchdog, long-lived). Opt-in via `AGENTMANAGER_DAEMON=1`. Three laws: INVISIBLE, FULLY TESTABLE, UNINSTALLABLE.

**Alternatives considered:** Single-process architecture (current default); OS service (requires admin, complicates uninstall).

**Why:** Single-exe crashes lost all open PTY sessions. Daemon keeps sessions alive across UI restarts. Bearer auth + ring buffer rehydrate solves reconnection.

**Blast radius:** `daemon/`, `backend/cli.py`, all e2e daemon specs, installer, uninstall flow.

**Reversibility:** One-way door for the default-on v1.3.0 flip; opt-in phase is reversible.

---

## Decision: Vendor CDN deps into `backend/frontend/vendor/` (v1.2.18)

**Decision:** Copy React 18, ReactDOM, Babel-standalone, xterm.js + addons into repo under `backend/frontend/vendor/`. Replace all CDN `<script>` tags in `index.html` with relative paths.

**Alternatives considered:** Keep CDN links; use a proper bundler (webpack/vite); service worker cache.

**Why:** Users on air-gapped networks or with DNS issues saw a completely black pywebview window because CDN resources failed to load. No build step preferred to keep dev simple.

**Blast radius:** `backend/frontend/index.html`, new `backend/frontend/vendor/` directory (~4.5 MB added to repo/exe).

**Reversibility:** Trivial — revert index.html and delete vendor/.

---

## Decision: Raw-exe swap chain for user's machine (no Inno installer managed)

**Decision:** User's machine uses direct file swap at `%LOCALAPPDATA%\Programs\AgentManager\AgentManager.exe`, not an Inno Setup managed installation.

**Alternatives considered:** Full Inno Setup reinstall each update.

**Why:** User prefers raw-exe swap for speed and to avoid UAC prompts. No `unins000.exe` present confirms this.

**Blast radius:** Any install/update automation must check for `unins000.exe` before deciding approach.

**Reversibility:** Can switch to Inno-managed at any time.

---

## Decision: TDD for bugfixes — write failing test first, then fix

**Decision:** Every bugfix PR must include a test that would have caught the original bug, committed in the same PR, confirmed red before fix and green after.

**Alternatives considered:** Fix first, test after (common but rejected).

**Why:** Multiple critical bugs shipped because tests only checked positive behavior, not the failure mode.

**Blast radius:** All future bugfix PRs.

**Reversibility:** Process decision, always reversible.

---

## Decision: `--dangerously-skip-permissions` always in resume command

**Decision:** `backend/providers/claude_code.py::resume_command()` unconditionally appends `--dangerously-skip-permissions` to every session launch.

**Alternatives considered:** Making it configurable; only applying to auto-resume.

**Why:** User runs unattended agents that cannot tolerate permission prompts. Any prompt would block an autonomous agent indefinitely.

**Blast radius:** Every session spawn in the app.

**Reversibility:** Trivial code change, but would break user's unattended workflows.
