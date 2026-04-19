# Contributing

Thanks for your interest! This project is small and opinionated — here's what
to know before opening a PR.

## Dev setup

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r backend/requirements.txt
.venv/Scripts/python -m pip install pytest httpx ruff mypy pre-commit bandit
.venv/Scripts/python -m pre_commit install
```

## Before you push

The CI mirrors what pre-commit runs locally. Pre-commit blocks the commit if
any of these fail, so install the hook once and you're covered:

```bash
.venv/Scripts/python -m pre_commit run --all-files
```

Under the hood this runs:

- **ruff** — lint + format
- **mypy** — type check (strict-ish; see `[tool.mypy]` in `pyproject.toml`)
- **bandit** — Python SAST
- stdlib hygiene (trailing whitespace, EOF newline, YAML/JSON/TOML, private keys)

## Tests

```bash
.venv/Scripts/python -m pytest
```

Tests use a **mocked `CLAUDE_HOME`** fixture — no real Claude Code install
needed. If you're adding a new endpoint, add a test in
`tests/test_backend_api.py` against the `client` fixture.

Playwright e2e tests (`tests/test_user_label_flow.py`, `tests/visual_check.py`)
are local-only — they need a running viewer + Chrome, so they're excluded from
the default pytest run.

## Commit style

One logical change per commit. Commit messages: imperative subject ≤ 70 chars,
optional body explaining *why*. Example:

```
feat: add /api/focus endpoint for per-tab WT switching

Windows Terminal shares one HWND across tabs, so raising the window isn't
enough. This uses UI Automation to find the tab by its OSC-0 title (stamped
by the SessionStart hook) and calls Select() on the TabItemControl.
```

## Branches

- `main` — protected; PRs only
- `feat/*`, `fix/*`, `deps/*` — topic branches

## PR checklist

- [ ] Tests cover the new behavior (or explain why not)
- [ ] `pre-commit run --all-files` is clean locally
- [ ] `README.md` / `SECURITY.md` updated if the contract changed
- [ ] No hardcoded user paths, emails, or identifiers
