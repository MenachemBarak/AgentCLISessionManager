# User notes — step 000006 (29-04-2026)

## Asks (verbatim or tight paraphrase)

- **"i moved the agent-manager to C:\projects\agent-manager from m:\ please remove the entire build and cache of the project and rebuild it"**
  Project was relocated from `M:\UserGlobalMemory\global-memory-plane\projects\claude-sessions-viewer` to `C:\projects\agent-manager`. Wanted a full clean build: delete all artifacts, recreate egg-info, reinstall deps.

- **"ok now list all .md files, read 200 lines of each to learn the project, and store in your cache the folder structure"**
  Full onboarding read of all core project .md files (README, AGENTS, CONTRIBUTING, SECURITY, ARCHITECTURE, RELEASE, TROUBLESHOOTING, e2e README, ADR-18, all 5 step snapshots). Store everything in the auto-memory system.

- **"look also in the old path!"** (interrupt during session search)
  User wanted Claude to search for old Claude Code sessions under the M:\ path too, not just the new C:\ path.

- **"you are now learning so its important to learn from all previous resources and history"**
  Emphasis: this is an onboarding session — extract knowledge from ALL historical sources, not just the latest state.

- **"tassk timer of 30m"** (during commit/PR analysis)
  Start a 30-minute task timer for the analysis work.

- **"put task timer, now go over the last 10 commits, find out what has been developed what is still missing by reading the diff and reading the pr docs, also find 5 last claude code sessions talking about this project and see what is still under development and missing"**
  Full project status audit: last 10 commits + PR diffs, find 5 recent Claude sessions, synthesize what's done vs. pending.

- **"/step — once you done write all your onboarding research to a step"**
  Capture all onboarding work into a durable step snapshot.

## Implicit signals

- User values thorough onboarding: they want Claude to read EVERYTHING — all .md files, all step histories, all session files — before starting any new work.
- The project move was pragmatic (C: drive, better performance), not a refactor — nothing changed except paths.
- User watches hook errors closely (screenshot showed the M:\ hook error immediately). Hooks are live infra that affects every session start.
- User interrupted mid-30m-timer to request the step — prefers checkpoints over long autonomous runs without documentation.
