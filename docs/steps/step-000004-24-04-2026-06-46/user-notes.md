# User notes — step 000004

Recorded verbatim (quoted) or closely paraphrased.

## Core directives expressed this step

- **"never assume 100% of your assumptions are fals, and always use screenshots, and logs to prooffffff, always proofe before you act and after the action take place to make sure you are in the right direction or solving the root cause of a bug."** — hard rule reminder installed as a 30-minute recurring cron (job `8d18b522`, `7,37 * * * *`).
- **"dit start ew pr till you fix and complet he old onces"** — serialize PR work: do not open a new PR until the prior one merges. Honored throughout.
- **"please install i dint fin dit"** — unable to find v1.1.1 in the auto-update banner; I manually downloaded + swapped the exe at `%LOCALAPPDATA%\Programs\AgentManager\AgentManager.exe`.
- **"why you dont create proper app installer like all app in the world"** — strong complaint that the raw-.exe ship model isn't an installer. Led to #48 Inno Setup installer and eventually v1.2.0.
- **"put task timer of next 10hours and dont stopworking on the procduct features, backlogs and quality!"** — 10-hour autonomous-work directive. Task-timer MCP not loaded in this session; operated without it.
- **"i donwloaded the version 1.1.0 and sessions does not resumed automatically"** + screenshot showing `cc-10b9beb1` tab in "session exited" state + `Failed to remove temporary directory: C:\Users\User\AppData\Local\Temp\_MEI189562` warning dialog. Triggered the v1.1.1 hotfix chain (legacy-layout migration) and eventually #45's fix via one-folder PyInstaller.
- **"1. write tests that reproduce this exact issue. 2. one you able to reproduce - solve thge issue till the testpass, only then commit the fix"** — strict TDD directive for bugfixes, which matches ADR-17.
- **"the most inportatn rule is that all will be invisialbe to the user, all must be fully testable, and all must be uninstallable, please plan deep and then start"** — the "three laws" that governed ADR-18. Locked into the ADR verbatim.
- **"make your own descition according to that after deep research and websearc idea"** — authorization to autonomously decide architecture after research. Honored by spawning a sub-agent to research VSCode ptyHost / Docker Desktop / WezTerm / ConPTY.

## Implicit signals

- User is a power user with Hebrew session titles — discovered when I reproduced the unicode-tokenizer bug (searches in Hebrew returned zero results pre-fix).
- User values fast cadence; every release I cut triggered no pushback. The `/loop` cron also kept reminding me not to assume — I took that as "keep shipping, keep verifying".
- User delegated release cadence entirely to me (multiple releases per hour acceptable).
