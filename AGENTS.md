# AGENTS.md — handoff notes for future Claude agents

You're inheriting this codebase. Read this first. It is the single page that
tells you where things are, how to not break them, and where to look when
something is weird.

This is **not** a tutorial — it's a cheat sheet that assumes you've already
read `README.md` and `CONTRIBUTING.md` once.

---

## 1. Repo layout (the parts that matter)

```
backend/
  __version__.py       ← single source of truth for the version
  __init__.py          ← re-exports __version__
  app.py               ← FastAPI server, JSONL scanning, SSE, Win focus path
  cli.py               ← CLI + desktop mode (pywebview)
  frontend/            ← React SPA (Babel-standalone, no build step)
  requirements.txt     ← pinned runtime deps for the legacy launcher.bat flow
hooks/
  session_start.py     ← Claude Code hook — stamps tab titles via OSC-0
launcher/
  launch.bat           ← legacy double-click launcher (self-setup venv)
  install-shortcut.bat ← Desktop .lnk creator (pre-release era)
tests/
  conftest.py          ← CLAUDE_HOME env + TestClient fixture
  fixtures/claude-home/ ← mock JSONL sessions for hermetic CI
  test_backend_api.py   ← endpoint tests via TestClient
  test_hook.py          ← hooks/session_start.py tests
  test_packaging.py     ← builds the wheel and asserts shape
  test_user_label_flow.py ← LOCAL-ONLY Playwright e2e (skipped in CI)
  visual_check.py        ← LOCAL-ONLY screenshot debug helper
.github/
  workflows/ci.yml            ← tests + lint + pre-commit on push/PR
  workflows/release.yml       ← on v* tag → wheel+sdist+zip+exe + Release
  workflows/security.yml      ← pip-audit + bandit + CodeQL (weekly cron)
  workflows/dependabot-auto-merge.yml ← patch/security auto-merge
  codeql/codeql-config.yml    ← CodeQL query-filter suppressions
  dependabot.yml              ← weekly pip + github-actions bumps
pyinstaller.spec     ← one-file Windows exe build spec
pyproject.toml       ← project metadata + ruff + mypy + bandit + pytest config
MANIFEST.in          ← what ships in the sdist
CHANGELOG.md         ← Keep-a-Changelog; RELEASE WORKFLOW REQUIRES AN ENTRY
SECURITY.md          ← disclosure policy + /api/open audit notes
CONTRIBUTING.md      ← dev loop + PR checklist
docs/
  screenshots/       ← demo PNGs, regenerable from fixture
  RELEASE.md         ← step-by-step release recipe
  ARCHITECTURE.md    ← decisions and rationale
```

---

## 2. The golden rules

These aren't opinions; they're load-bearing invariants. Break them and CI breaks.

1. **Version lives in one place**: `backend/__version__.py`. `pyproject.toml`
   reads it via `setuptools.dynamic`, `/api/status` returns it, and the
   release workflow verifies the git tag matches it. **Bump this before
   tagging** or the `build` job aborts.
2. **Every release needs a matching `CHANGELOG.md` entry**. Header must be
   exactly `## [X.Y.Z] — YYYY-MM-DD`. The `release` job extracts this for
   the GitHub Release body and aborts if it's missing.
3. **Never commit/push directly to `main`**. The sandbox will block you
   and you'll waste a turn. Always: branch → PR → merge.
4. **Tags are immutable**. If a release workflow fails, don't delete the tag —
   bump to the next patch and re-tag. (See CHANGELOG v0.3.0/0.3.1/0.3.2 and
   v0.4.0/0.4.1 for examples.)
5. **`frontend/` is inside the backend package** (`backend/frontend/`). Do not
   move it back to the repo root without updating `FRONTEND_DIR` resolution
   in `app.py` + `cli.py` (they also handle `sys._MEIPASS` for the
   PyInstaller-frozen case).
6. **Windows-only code must be guarded** by `IS_WINDOWS` in `app.py`. CI
   runs tests on ubuntu-latest too, and `import uiautomation` / `ctypes.windll`
   explode there.
7. **Subprocess inputs must be whitelist-validated** (`_UUID_RE` for
   `sessionId`, enum for `mode`, `Path.resolve()` for `cwd`). CodeQL caught a
   real command-injection issue in v0.3.x — see SECURITY.md.

---

## 3. Quick commands (the 10 you'll actually use)

```bash
# one-time dev setup
python -m venv .venv
.venv/Scripts/python -m pip install -e .
.venv/Scripts/python -m pip install pytest httpx ruff mypy pre-commit bandit build pywebview pyinstaller

# the CI gate — run before every commit
.venv/Scripts/python -m pytest
.venv/Scripts/python -m pre_commit run --all-files

# build the wheel locally
.venv/Scripts/python -m build --wheel --sdist

# build the one-file Windows exe locally
.venv/Scripts/python -m PyInstaller pyinstaller.spec --noconfirm --clean

# boot the app in dev (desktop mode)
.venv/Scripts/python -m backend.cli

# boot headless (no pywebview)
.venv/Scripts/python -m backend.cli --server-only --no-browser

# point at the mock fixture instead of your real sessions
CLAUDE_HOME=tests/fixtures/claude-home .venv/Scripts/python -m backend.cli

# release: bump → PR → merge → tag (SEE docs/RELEASE.md)
git tag -a v0.X.Y -m "v0.X.Y — <one-liner>"
git push origin v0.X.Y

# check release workflow
gh run list --workflow=release.yml --limit 3
gh release view v0.X.Y
```

---

## 4. Known quirks & gotchas

- **CRLF warnings on git add**: Harmless. `mixed-line-ending` pre-commit hook
  normalizes everything to LF. Don't "fix" these.
- **`M:/tmp/...` paths in bash**: When Python scripts spawned from bash-for-Windows
  write to `/tmp/...`, they resolve relative to the current drive root. Use
  `cygpath -w` to convert or always pass absolute Windows paths to Python.
- **pywebview fails on headless Linux**: No display → no GTK/Qt. CI uses
  `--server-only` in the verify job. Don't remove that flag or v0.4.0-style
  failures recur.
- **Twine + modern setuptools**: Must be `twine>=6.1.0` to handle
  Metadata-Version 2.4 emitted by `setuptools>=68`. See v0.3.0/0.3.1 incident.
- **awk + bracketed CHANGELOG headers**: `## [0.4.1]` — awk regex treats
  `[…]` as a character class. The release workflow uses a Python extractor
  to avoid this. Don't revert to awk.
- **CodeQL GHAS vs workflow CodeQL**: Two different checks. The `CodeQL` check
  is the GitHub Advanced Security app (inline annotations on PRs). The
  `CodeQL (Python)` check is our workflow. Both must pass. Suppress
  false-positives via `.github/codeql/codeql-config.yml`, not inline noqa.
- **`_next_tab_index` unused warning**: CodeQL flags this as unused. It's
  load-bearing for Windows Terminal tab indexing in `/api/open`. Leave it.
- **Dependabot opens 9+ PRs on first run**: Expected. They're gated to
  auto-merge only on patch/security. Minor/major bumps need manual review.
- **Bandit noisy on `try/except/pass`**: These are intentional defensive
  JSONL parsing (skip malformed lines). Already skipped in
  `[tool.bandit].skips` — don't chase these warnings.

---

## 5. Where to look when something's wrong

| Symptom | Look here |
|---|---|
| CI red | `gh pr checks <n>` → click the failing job → `gh run view <id> --log-failed` |
| Release didn't publish | `gh run view <release-run-id> --json jobs` — `verify` usually the culprit |
| UI not loading | `FRONTEND_DIR` in `app.py` / `cli.py`; check `backend/frontend/index.html` exists in wheel via `python -m zipfile -l dist/*.whl` |
| `/api/focus` doesn't switch tab | Hook isn't installed → `POST /api/hook/install`; or UIA lib can't find WT window class |
| Antivirus flags the exe | PyInstaller bootloader false-positive; build without UPX (already the case in spec) |
| Tests pass locally, fail CI | Check OS (Linux-only Win-guards); line endings (pre-commit normalizes); env vars not in fixture |

---

## 6. References

- Upstream release pattern: https://github.com/hantmac/tmax (cloned to `playground/tmax` while studying, gitignored)
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- pywebview docs: https://pywebview.flow.io/
- PyInstaller one-file mode: https://pyinstaller.org/en/stable/operating-mode.html
- Keep-a-Changelog: https://keepachangelog.com/en/1.1.0/
