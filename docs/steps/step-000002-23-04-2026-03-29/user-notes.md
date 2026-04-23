# User notes — step 000002 (23-04-2026 03:29)

Direct asks and signals from this ~10-minute window covering
v0.9.3 + v0.9.4 ship + QA expansion PR #38 + step snapshot.

## Asks (verbatim or tight paraphrase)

- **"before we move on, 1. execute the step guide. 2. complete your connrt in progress tasksm only then repriorirtie next and implement. 3. when session is started using the sessionmanagenr (no matter how_) it always must start with '--dangerously-skip-permissions'"**
  Three ordered items. (1) ship a step snapshot first, (2) finish in-flight work before picking up new tasks, (3) hard requirement: EVERY session-start path spawned by the viewer must include the `--dangerously-skip-permissions` flag — no exceptions. Applies to "In viewer" PTY, external wt.exe, and any future automatic-resume flows (e.g. the restart ping).

- **"btw the silver bullet of sessions, is to run in background in some thin management layer, and on platform upgrade - all session will still kept run - but the platform we build will do updated. if the update include changes of the session-liveness layer too, the user will see in-app popup that alert that all session will be closed and resume on restart and then its the case where all be resumed with --dangerously-skip-permission + the ping message"**
  Architecture vision: split the app into a thin session-liveness daemon (holds PTY children alive across platform restarts) + the platform (UI / updater / everything else). Normal updates are transparent to sessions. Only liveness-layer updates trigger a confirm modal → close + resume all sessions, each with the skip-permissions flag + the restart ping. Filed as task #42.

- **"make sure to test this app well before do the restart sinec i runing stuff usingit"**
  Urgent guardrail: the user has active Claude Code sessions running through the installed v0.9.3 viewer. Do NOT restart their app. Expand Playwright coverage so they feel confident BEFORE a future manual restart. All QA work must use an isolated dev server on a separate port + fixture `CLAUDE_HOME`.

- **"make sure to document your work"** (current /step args)
  This step snapshot.

## Implicit signals

- User is managing many concurrent agent sessions (99 total, ~10 active visible in a recent screenshot). Continuity is high-value — features that disrupt active sessions are expensive.
- User's language pattern continues to be typo-heavy stream-of-thought; intent is clear. Don't mirror the typos in commits or user-facing strings.
- User expects: one /step at natural break points, then autonomous next-action selection. The "reprioritize + implement" directive in the step args confirms this.
