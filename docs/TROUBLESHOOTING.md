# Troubleshooting

End-user and developer quick fixes. Check here before filing an issue.

## End-user

### Double-clicking the `.exe` does nothing

- **Antivirus quarantined it.** PyInstaller bootloaders get false-positive
  flagged. Check Windows Defender → Protection History. Allow the app and
  re-run. The binary is built from public CI — SHA256 on the Release page
  matches what you downloaded.
- **Edge WebView2 is missing.** Windows 11 ships with it; Windows 10 may not.
  Install the Evergreen Bootstrapper from Microsoft.

### "Windows protected your PC" SmartScreen warning

The binary isn't code-signed (open-source project, no cert budget). Click
**More info → Run anyway**. SHA256 on the Release page is the trust anchor.

### App window opens but shows "This site can't be reached"

The backend didn't boot in time. Usually caused by port collision.

1. Launch with `claude-sessions-viewer --server-only --no-browser --port 8765`
   from a terminal and watch the log.
2. If you see `OSError: [Errno 98] Address already in use` — another process
   owns the port. Pass `--port <other>`.

### "No sessions showing" when you know you have some

- Confirm `~/.claude/projects/` exists and contains `<uuid>.jsonl` files
  (not just `agent-*.jsonl` in `subagents/` — those are filtered out).
- Check `/api/status` — if `phase: scanning`, the initial index is still
  building. On a machine with 20k+ sessions this takes ~30 seconds.
- Check a specific folder isn't auto-unchecked: folders with >1000 sessions
  are unchecked by default via the folder filter (top of left sidebar).

### `Focus` button does nothing

The SessionStart hook isn't installed, so the tab title isn't stamped and
UI Automation can't find the tab.

```bash
curl -XPOST http://127.0.0.1:8765/api/hook/install
```

Check `~/.claude/settings.json` has a `SessionStart` entry with the
viewer's script path.

### Inline rename doesn't save

- Check `~/.claude/viewer-labels.json` is writable.
- Check `/api/sessions/<id>/label` returns 200 when PUT with
  `{"userLabel": "test"}`.

## Developer

### `pytest` fails with "Address already in use"

Something is bound to port 8765. Kill it:
`(Get-NetTCPConnection -LocalPort 8765).OwningProcess | Stop-Process -Force`
(PowerShell). Or use `--port 0` in your own tests.

### `pre-commit` mypy fails with `unused-ignore`

Probably on the `ctypes.windll` lines in `backend/app.py`. They use
`# type: ignore[attr-defined,unused-ignore]` specifically because the ignore
is unused on Windows but needed on Linux. If you see a fresh one on new code:
use the same double-tag.

### `pytest tests/test_packaging.py` is slow

Expected — it runs `python -m build --wheel` in a temp dir. Scope is
`module`, so it runs once per session. Skip with
`-k "not packaging"` if you're iterating on non-packaging code.

### PyInstaller exe boots but UI is blank / 404 on static files

`FRONTEND_DIR` resolution broke. Re-check that `backend/frontend/index.html`
is in the built exe:

```bash
# Unpack the one-file exe
pyi-archive_viewer dist/claude-sessions-viewer.exe
# List TOC → look for backend/frontend/index.html
```

If missing, check `pyinstaller.spec` `datas=` includes `backend/frontend`.

### Release workflow succeeded but no GitHub Release appeared

The `release` job runs last and depends on `build`, `verify`, and `exe`
all succeeding. Check:

```bash
gh run view <run-id> --json jobs
```

If any upstream failed, `release` is skipped. The artifacts exist on the run
page but aren't published. Fix the failing job, bump to the next patch
version, re-tag.

### CI runs on Dependabot PRs but doesn't auto-merge

Expected for minor/major bumps. Auto-merge only fires for:
- `update-type == "version-update:semver-patch"`, OR
- `update-type == "security"`

Minor and major bumps open a PR that needs human review — by design.

### "Vulnerability alerts are disabled" from GitHub API

Enable once per repo:

```bash
gh api --method PUT repos/<owner>/<repo>/vulnerability-alerts
gh api --method PUT repos/<owner>/<repo>/automated-security-fixes
```

### Git keeps printing CRLF warnings

```
warning: in the working copy of 'X', LF will be replaced by CRLF the next time Git touches it
```

Expected. Pre-commit's `mixed-line-ending` hook normalizes everything to LF
on commit. Don't try to "fix" by setting `core.autocrlf false` — CI still
enforces LF via the hook.
