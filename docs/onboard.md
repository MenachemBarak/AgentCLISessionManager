# Agent Onboarding Playbook

A general-purpose onboarding process for any project. Follow all phases in order at the start of a new engagement or after a long absence.

---

## Phase 1: Orient — repo basics

```bash
# Where are we, what branch, what's the state
git status
git branch -a | head -20
git remote -v

# Last 20 commits — skim shape and cadence
git log --oneline -20

# Active and recently merged branches
git branch -a --sort=-committerdate | head -30
```

---

## Phase 2: Read all documentation

List every `.md` file in the repo and read the first 200 lines of each. The goal is to extract:
- What the project is and who it's for
- Architecture and key design decisions
- Development workflow (branching, CI, release)
- Current backlog and known issues
- Any agent-specific rules or constraints

```bash
# Find all .md files, sorted by path
find . -name "*.md" -not -path "*/.git/*" -not -path "*/node_modules/*" | sort
```

Read in this priority order if the list is long:
1. `README.md` — identity, quickstart
2. Any `ARCHITECTURE.md`, `DESIGN.md`, `ADR-*.md` — structural decisions
3. Any `AGENTS.md`, `CLAUDE.md`, `.cursorrules` — agent-specific rules (mandatory)
4. `CHANGELOG.md` — last 5 entries minimum
5. Backlog/ticket files (`tickets.md`, `TODO.md`, `ROADMAP.md`)
6. `CONTRIBUTING.md`, `RELEASE.md` — process
7. Everything else under `docs/`

---

## Phase 3: Inspect recent commits in depth

Go over the last 10 commits. For each, read the diff and any linked PR description.

```bash
# Full diff of last 10 commits, one at a time
git log --oneline -10

# For each commit SHA, read the full diff
git show <sha> --stat
git show <sha>

# Or show all 10 at once (large output)
git log -10 -p --stat
```

For each commit extract:
- What feature or fix was shipped
- Which files changed and how
- Any TODO / follow-up comments left in code
- PR number if referenced (look up with `gh pr view <N>`)

---

## Phase 4: Find and read recent Claude Code sessions

Claude Code saves session transcripts under `~/.claude/projects/`. Find sessions related to this project from the past X days and read what was discussed, built, and left pending.

```bash
# Locate Claude project directory for this repo
# The path is derived from the working directory:
# ~/.claude/projects/<path-with-slashes-replaced-by-dashes>/

# On Windows (replace C:\projects\myproject with actual path):
# dir "C:\Users\%USERNAME%\.claude\projects\C--projects-myproject\"

# List session files, most recent first
ls -lt ~/.claude/projects/<project-dir>/*.jsonl 2>/dev/null | head -20

# Also check for step snapshot files (if project uses them)
find . -path "*/docs/steps/*/step-tasks.md" | sort -r | head -5
```

For each session file found (last X days), read the step snapshot files if they exist — they are pre-digested summaries that avoid JSONL encoding issues:

```bash
# Read the 3 most recent step snapshots
ls -d docs/steps/*/ | sort -r | head -3
# Then read: user-notes.md, step-tasks.md, lessons-learned.md from each
```

From sessions and steps, extract:
- Features developed and their current status (done / in-progress / blocked)
- Branches created, PRs opened/merged
- Bugs fixed and bugs found but not yet fixed
- Explicit TODOs left for the next session
- Any "don't do X" instructions from the user

---

## Phase 5: Check current project health

```bash
# Tests passing?
# (adapt command to project stack)
# Python:
python -m pytest --tb=short 2>&1 | tail -20

# Node/JS:
npm test 2>&1 | tail -20

# Coverage (if applicable):
python -m pytest --cov=. --cov-report=term-missing 2>&1 | grep -E "TOTAL|[0-9]+%"

# Any open PRs?
gh pr list

# CI status on current branch:
gh run list --branch $(git branch --show-current) | head -5
```

---

## Phase 6: Synthesize — produce a status summary

After phases 1-5, write a brief status summary (in conversation or in a new step snapshot). Cover:

1. **What is this project?** — one paragraph
2. **What has been built recently?** — last 10 commits in plain English
3. **What is in-flight?** — features started but not merged, open PRs, blocked items
4. **What is missing or broken?** — failing tests, known bugs, coverage gaps, tech debt
5. **What branches are active?** — and what they contain
6. **What should happen next?** — by priority

---

## Phase 7: Store findings in memory

Write memory files so the next session doesn't repeat this onboarding:

```
~/.claude/projects/<project-dir>/memory/
```

Minimum memory files to create:
- `project_overview.md` — what the project is, stack, key paths
- `user_preferences.md` — any mandatory rules learned from agent-specific docs
- `status_YYYY_MM_DD.md` — dev status snapshot with what's done/in-flight/missing
- `MEMORY.md` — index pointing to all other files (one line per entry)

---

## Checklist

- [ ] Phase 1: Git status, branch list, remote confirmed
- [ ] Phase 2: All `.md` files found and first 200 lines of each read
- [ ] Phase 3: Last 10 commits diffed, PR descriptions read
- [ ] Phase 4: Recent Claude sessions / step snapshots read
- [ ] Phase 5: Tests run, CI status checked, open PRs listed
- [ ] Phase 6: Status summary written
- [ ] Phase 7: Memory files written (or updated if they already exist)
