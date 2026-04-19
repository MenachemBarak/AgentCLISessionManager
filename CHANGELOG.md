# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.2] — 2026-04-19

### Fixed
- Release workflow: changelog extractor now uses a Python snippet instead of
  awk so bracketed headers (e.g. `## [0.3.2]`) aren't parsed as regex
  character classes. v0.3.1 build+verify succeeded but release-notes step
  produced an empty file.

## [0.3.1] — 2026-04-19

### Fixed
- Release workflow: bump twine to `>=6.1.0` so it recognizes Metadata-Version 2.4
  emitted by modern setuptools. The v0.3.0 tag was pushed but its release workflow
  failed at the twine-check step, so v0.3.1 is the first successfully published
  release of the 0.3 series.

## [0.3.0] — 2026-04-19

### Added
- `pipx install`-compatible packaging — `claude-sessions-viewer` CLI entry point
- `backend/__version__.py` as single source of version truth; exposed at `/api/status`
- `MANIFEST.in` + `[tool.setuptools]` config so the wheel ships `backend/frontend/`
  and `hooks/` self-contained
- `.github/workflows/release.yml` — on `v*` tag push: builds wheel + sdist +
  Windows zip, creates a GitHub Release with all three as assets
- `release-verify` CI job that installs the built wheel in a fresh venv and
  smoke-tests `--version` + `/api/status` against the mock fixture
- `CHANGELOG.md` (this file) — Keep-a-Changelog style

### Changed
- `frontend/` moved to `backend/frontend/` so it ships inside the wheel. Dev
  behavior unchanged since `app.py` looks up `FRONTEND_DIR` relative to its own
  location.
- `pyproject.toml` — dynamic version via `backend.__version__.__version__`;
  runtime dependencies declared here (previously only in `backend/requirements.txt`)

## [0.2.0] — 2026-04-19

### Added
- Production hardening PR (#2):
  - Pre-commit hooks: ruff, ruff-format, mypy, bandit + stdlib hygiene
  - CVE scanning: pip-audit + bandit + CodeQL (on push/PR + weekly cron)
  - Dependabot weekly PRs for pip + github-actions
  - Dependabot auto-merge workflow for security/patch updates
  - Full type annotations; mypy clean with `disallow_untyped_defs`
  - Demo screenshots in `docs/screenshots/` (synthetic, no PII) + generator script
  - `SECURITY.md` (disclosure policy, hardening notes)
  - `CONTRIBUTING.md` (dev loop, PR checklist)

### Security
- Bump `fastapi` to 0.136.0 and floor-pin `starlette>=0.48.0` to close
  `GHSA-f96h-pmfr-66vw` and `GHSA-2c2j-9gv5-cj73` (caught by pip-audit)
- Harden `/api/open` against command injection (CWE-78): strict UUID validation
  of `sessionId`, enum validation of `mode`, pathlib canonicalization of `cwd`;
  removed the vulnerable `cmd.exe /k` fallback

## [0.1.5] — 2026-04-19

### Added
- Read Claude's `/rename` session titles (`custom-title` JSONL entries) from
  the tail of each session file; exposed as `claudeTitle` on `/api/sessions`

### Fixed
- Hebrew / non-ASCII session titles now display correctly

## [0.1.4] — 2026-04-19

### Fixed
- Inline label save: UI now updates in place without requiring a page reload
- Playwright e2e test covers the full label roundtrip

## [0.1.3] — 2026-04-19

### Removed
- `claude -p` auto-labeling (caused a feedback loop that spawned orphan
  sessions). Kept only user-set labels via the inline-edit GUI.

## [0.1.2] — 2026-04-19

### Added
- User-editable session titles from the GUI

## [0.1.1] — 2026-04-19

### Added
- AI-generated session labels (later removed in 0.1.3 due to feedback loop)

## [0.0.2] — 2026-04-18

### Added
- Per-tab Windows Terminal focus via UI Automation + SessionStart hook that
  stamps OSC-0 titles

## [0.0.1] — 2026-04-18

### Added
- Initial working Claude Sessions Viewer:
  - FastAPI backend on `127.0.0.1:8765` reading `~/.claude/projects/**/*.jsonl`
  - React frontend with session list, active strip, folder filter, transcript
  - Live updates via SSE + watchdog
  - "New tab" / "Split" buttons spawn `wt.exe ... claude --resume <uuid>`
  - Self-installing Desktop shortcut launcher

[Unreleased]: https://github.com/MenachemBarak/AgentCLISessionManager/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.3.2
[0.3.1]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.3.1
[0.3.0]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.3.0
[0.2.0]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.2.0
[0.1.5]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.1.5
[0.1.4]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.1.4
[0.1.3]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.1.3
[0.1.2]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.1.2
[0.1.1]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.1.1
[0.0.2]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.0.2
[0.0.1]: https://github.com/MenachemBarak/AgentCLISessionManager/releases/tag/v0.0.1
