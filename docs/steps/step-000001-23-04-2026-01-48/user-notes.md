# User notes — step 000001 (23-04-2026 01:48)

Direct asks and implicit signals from the ~10 min window around the
v0.9.1 install verification → v0.9.2 hotfix → restart-ping feature request.

## Asks (verbatim or tight paraphrase)

- **"you must add testing phase locally also testing phase in pr that test the eexe! it didnt start!!!"**
  Screenshot showed v0.9.0 pywebview window completely black. User was correctly angry — the release had "passed" because I only checked `/api/status`, never the UI. This is the non-negotiable rule going forward: proof must come from rendered UI + logs, not API responses.

- **"you must have playwright test!!!!! MUST!!! you need to set the playwrihgt folder as pages/pagename/actions possible in the page scripts, and then tests/feature/<feature test compbination of actions from other pages)"**
  Page Object Model layout — pages/ holds one file per surface with intent-level actions; tests/feature/ composes those actions into feature journeys. No DOM queries in feature tests.

- **"once you done fixing and add tests e2e also to the e2e, make sure to test also the version upddate"**
  The update-banner flow must be covered by the Playwright suite, not just unit tests.

- **`i closed a indows you opned`**
  User manually closed a Chrome window I had opened. Low-signal — closing a dev window during back-and-forth is normal. Adjust: don't navigate to internal app URLs in the user's primary Chrome profile without warning if they're mid-work.

- **Screenshot of terminal tab `cc-10b9beb1`**: "add more task: when use click in a terminal with active session, the relevant session must be lighted in the left side bar"
  New feature request — terminal tab focus should drive left-pane highlight. Filed as task #39.

- **Long research snippet about grep-ing session files + "please put in tyour todo list that the next task is to enable this research, like having smart research in to find the right settios/top sessions aobut a given topic in natural lanauge(t can use some claude sdk in the background with my subscription to search that way)"**
  Filed as task #40.

- **"[Image #9] why it pops up like that"** with screenshot of a Windows Terminal tab titled `find "65444"`
  Side effect of v0.9.1's broken swap helper — `tasklist | find "<pid>"` spawned `find.exe` into a detached console that Windows 11 default-terminal policy surfaced as a visible tab. Fixed in v0.9.2 helper (no tasklist, no find).

- **"HIGHLY IMPORTATN FEATURE: when the software is restarted foor any reason - IT MUST FIND ALL RESUMED SESSIONS, and sent in each of them, 'SOFTARE RESTARTED - GO ON FROM WHRE YOU LEFT OF'"**
  Filed as task #41. HIGH priority. Auto-resume + auto-ping every previously-resumed session on viewer restart so agent work continues without manual babysitting.

- **Current /step args**: "before we move on, 1. execute the step guide. 2. complete your connrt in progress tasksm only then repriorirtie next and implement. 3. when session is started using the sessionmanagenr (no matter how_) it always must start with '--dangerously-skip-permissions'"
  Three items in order:
    1. Ship this step snapshot.
    2. Finish in-progress work before picking new tasks, then reprioritize.
    3. **Every** session-start spawned by the viewer — regardless of path (in-viewer terminal, external wt, resume ping, auto-restart ping) — must include the `--dangerously-skip-permissions` flag on the `claude` invocation.

## Implicit signals

- User's trust in "done" claims is low after the v0.9.0 black-screen ship. Every future "ready" or "shipped" must come with a **browser screenshot or rendered-DOM assertion**, not a 200 status. This is a durable preference.

- User is working across many parallel session workflows (see active session list — 99+ total, 10 active). Anything that disrupts session continuity (restart, update, crash) must self-heal; that's the why behind task #41.

- User often writes in typo-heavy Hebrew-keyboard-English. Intent is almost always clear; don't nitpick phrasing — read the signal, act.
