# User notes — step 000003 (23-04-2026 22:05)

Direct asks and signals during this ~10-minute window spanning the
v1.0.0 rebrand aftermath, the CRITICAL paste-split bugs, the v1.1.0
shell-wrap arch, and the install-checkpoint request.

## Asks

- **"why i have 2 icons? i expect well strucutred app to have one app there, call it AgentManager"**
  Screenshot showed duplicate Start-menu entries ("Claude Sessions Viewer" + "Claude Sessions" star icon) and a directive to rebrand.
  Led to: stale shortcut quarantine + v1.0.0 rebrand PR + task #46.

- **"please install it properly on my pc"**
  Install v1.0.0 into a well-structured location — not a patch on top of the old `ClaudeSessionsViewer` dir. Led to new `%LOCALAPPDATA%\Programs\AgentManager\` directory + renamed Desktop/Start-Menu shortcuts + quarantined old ones.

- **"once you done start with the #42 this is the highest priotiry"**
  User specifically flagged the session-liveness daemon as top backlog priority. Queued for after the critical hotfixes.

- **"CRITICAL ISSUE: it start from compactying instead of continueuing the conversation as-is and also the message didnt sent!"**
  Two screenshots showed (a) the SOFTWARE RESTARTED ping triggering `/compact` instead of a clean resume, (b) the ping text sitting in Claude's chat input un-submitted.
  Diagnosed: Ink-TUI's bracketed-paste detection swallowed the trailing `\r` — it confirmed the resume-choice menu's default (option 1 = summary) AND treated the Enter as a literal newline inside the paste, so the text never got submitted. Led to v1.0.1 hotfix.

- **"we need to handle exit gracefullly: if somehno e do exit, it should get back to the terminal, when started a session, it should first start terminal, and then in the terminla cd to the folder and claude --resume <session id> --dangerously-skip-permissions"**
  Architectural directive — the whole model of "claude as argv[0] of the PTY" is wrong. Needs to be shell-wrapped. Led to v1.1.0 shell-wrap PR #47.

- **"so on exit it will just go back to the terminal"** (reinforcement)

- **"also this is means that some tabs can be non-session related, only when session is active inside of them they became bind to a sessions"**
  Session-tab binding becomes dynamic — tabs are plain shells by default, become session-bound only while claude is running inside, revert to plain shells when claude exits. Captured in the v1.1.0 design.

- **"pLEASE ADD TEST - REPRODUCE THE BUG AND THEN START FIXING"**
  Explicit TDD directive. Changed workflow: wrote `keystroke-splitting.spec.ts`, verified it fails against the reverted (buggy) code, restored the fix, confirmed green. Same TDD for `shell-wrap-resume.spec.ts`.

- **"lets store this as checkppoint"** (current /step args)
  This snapshot.

## Implicit signals

- User's CRITICAL issues came from ACTUAL session damage (their agents got compacted) — trust-in-releases took another hit after this. Testing bar goes up further: the TDD rule now applies to every bugfix PR going forward.

- Pattern: user will direct a rebrand/rename (#46), immediately hit a critical bug produced by the underlying code path, then demand the architecture fix (#47). They're moving from "superficial polish" to "root-cause redesign" in one conversation — the sequence matters.

- User tolerates the CodeQL auto-dismiss loop but flags it as churn. A proper `.github/codeql/codeql-config.yml` path-filter would be the proper fix; the per-alert dismissal is working but noisy.
