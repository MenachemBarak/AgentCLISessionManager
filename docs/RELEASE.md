# Release Recipe

End-to-end instructions for cutting a new tagged release. Follow this verbatim
— deviations have historically caused the `release` job to skip artifact
publication.

## TL;DR

```bash
# 1. Bump the version in a PR
git checkout -b chore/bump-vX.Y.Z
# edit backend/__version__.py     → "X.Y.Z"
# edit CHANGELOG.md                → add `## [X.Y.Z] — YYYY-MM-DD` section
# edit CHANGELOG.md                → add `[X.Y.Z]:` link at bottom
# edit CHANGELOG.md                → update `[Unreleased]` compare link
# edit README.md                   → bump @vX.Y.Z in the pipx example
git add -A && git commit -m "chore: bump version to X.Y.Z"
git push -u origin chore/bump-vX.Y.Z
gh pr create --base main --title "chore: bump to vX.Y.Z" --body "..."

# 2. Wait for green CI, merge
gh pr checks <n>
gh pr merge <n> --squash --delete-branch

# 3. Tag on main
git checkout main && git pull --ff-only
git tag -a vX.Y.Z -m "vX.Y.Z — <one-liner>"
git push origin vX.Y.Z

# 4. Watch the release workflow (~4-5 min incl. PyInstaller)
gh run list --workflow=release.yml --limit 2
gh run view <run-id> --json jobs

# 5. Confirm the GitHub Release has all 4 assets
gh release view vX.Y.Z --repo MenachemBarak/AgentCLISessionManager
```

## What the release workflow does

On every `v*.*.*` tag push, `.github/workflows/release.yml`:

1. **`build`** (ubuntu) — validates `__version__` == tag, runs
   `python -m build --wheel --sdist`, `twine check --strict`, and zips the
   repo into `claude-sessions-viewer-X.Y.Z-windows.zip`. Uploads to the
   `release-artifacts` workflow artifact.
2. **`exe`** (windows-latest, parallel to verify) — installs runtime deps +
   PyInstaller 6.11, runs `pyinstaller pyinstaller.spec`, renames the output
   to `claude-sessions-viewer-X.Y.Z-windows-x64.exe`, smoke-tests `--version`
   and `--server-only` against the mock fixture. Uploads as `windows-exe`.
3. **`verify`** (ubuntu) — installs the built wheel in a fresh venv, asserts
   `--version` matches the tag, boots `--server-only --no-browser --port 8799`
   against `tests/fixtures/claude-home`, and curls `/api/status` + `/api/sessions`.
4. **`release`** (ubuntu, needs `build` + `verify` + `exe`) — downloads both
   artifact bundles, extracts the matching `## [X.Y.Z]` section from
   `CHANGELOG.md` via the Python extractor, and calls `gh release create`
   with all four assets.

## Expected assets on every GitHub Release

| Asset | Size | Who uses it |
|---|---|---|
| `claude_sessions_viewer-X.Y.Z-py3-none-any.whl` | ~40 KB | `pipx install`, `pip install` |
| `claude_sessions_viewer-X.Y.Z.tar.gz` | ~45 KB | source distribution (PyPI) |
| `claude-sessions-viewer-X.Y.Z-windows.zip` | ~55 KB | legacy `launcher\install-shortcut.bat` flow |
| `claude-sessions-viewer-X.Y.Z-windows-x64.exe` | ~18 MB | double-click desktop app (no Python needed) |

## Failure modes and fixes (historical record)

### v0.3.0 — twine rejected modern metadata
`twine check --strict` against `Metadata-Version 2.4` from `setuptools>=68`
failed with "Metadata is missing required fields: Name, Version". Fixed by
pinning `twine>=6.1.0`. v0.3.1 bumped.

### v0.3.1 — awk treated `[0.3.1]` as a character class
Changelog extractor used `awk -v ver="[$VER]"` which interpreted `[0.3.1]` as
the char class `{0, ., 3, 1}` instead of a literal substring, so
`release_notes.md` came out empty and the `release` job aborted. Replaced
with a Python heredoc. v0.3.2 bumped.

### v0.4.0 — verify job crashed pywebview on Linux
Verify ran `claude-sessions-viewer --no-browser` which defaulted to desktop
mode → `webview.start()` → `WebViewException: You must have either QT or
GTK…`. Fixed by adding `--server-only` to the verify command. v0.4.1 bumped.

## Things that will NOT fail the release but you still need to do

- Update README's `pipx install ...@vX.Y.Z` example to the new tag
- Update the `[Unreleased]` compare-link footer in CHANGELOG
- If the release introduces a new install method or binary, add it to the
  "Expected assets" table above

## Post-release sanity check

```bash
# Download the exe from the Release (not the workflow artifact) and test it
mkdir -p /tmp/release-check && cd /tmp/release-check
gh release download vX.Y.Z --repo MenachemBarak/AgentCLISessionManager --pattern "*.exe"
./claude-sessions-viewer-X.Y.Z-windows-x64.exe --version
# Should print: claude-sessions-viewer X.Y.Z
```

## Manual publish (last-resort only)

If the workflow is hopelessly broken but you need to ship:

```bash
python -m build --wheel --sdist
pyinstaller pyinstaller.spec --noconfirm --clean
gh release create vX.Y.Z \
  --title "vX.Y.Z" \
  --notes-from-tag \
  dist/*.whl dist/*.tar.gz dist/*.exe
```

Only do this after you understand why the workflow failed — it's almost
always cheaper to fix the workflow and re-tag as vX.Y.(Z+1).
