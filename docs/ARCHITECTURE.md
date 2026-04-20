# Architecture

Why the code looks the way it does. If you're about to change something that
feels weird, read the matching section first — there's probably a reason.

## One-paragraph summary

FastAPI + uvicorn backend reads Claude Code's per-session JSONL files from
`~/.claude/projects/**/*.jsonl`, exposes a REST/SSE API, and serves a
React-via-Babel SPA at `/`. The `claude-sessions-viewer` CLI wraps this in a
native OS webview window (pywebview). On Windows, two Win32-specific paths
let the user launch new Windows Terminal tabs running `claude --resume <uuid>`
and focus existing WT tabs by name.

## Layer diagram

```
┌──────────────────────────────────────────────────────────────┐
│ pywebview window (Edge WebView2 / WebKit / WebKitGTK)         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ React SPA (Babel-standalone)                            │  │
│  │  app.jsx → data.jsx (SSE + fetch) → compact-list / …    │  │
│  └────────────────────────────────────────────────────────┘  │
│                  ▲   HTTP + SSE (http://127.0.0.1:<port>)    │
└──────────────────┼───────────────────────────────────────────┘
                   │
┌──────────────────┼───────────────────────────────────────────┐
│ uvicorn / FastAPI (backend/app.py)                            │
│                                                                │
│  /api/status      → index progress + __version__              │
│  /api/sessions    → list from _INDEX                          │
│  /api/sessions/*  → preview / transcript / label GET+PUT      │
│  /api/open        → wt.exe ... claude --resume <uuid>         │
│  /api/focus       → UIA select tab by OSC-0 title             │
│  /api/stream      → SSE from watchdog                         │
│  /api/hook/*      → install/uninstall/status the SessionStart │
│                      hook in ~/.claude/settings.json          │
│                                                                │
│  watchdog.Observer on PROJECTS_DIR → SSE push                 │
│  threading.Lock on LABELS_FILE writes                         │
└────────────────────────────────────────────────────────────────┘
                   │ file I/O
                   ▼
      ~/.claude/projects/<encoded>/<uuid>.jsonl   ← Claude Code owns these
      ~/.claude/sessions/<pid>.json               ← Claude Code owns these
      ~/.claude/viewer-labels.json                ← WE own this
      ~/.claude/settings.json                     ← shared; we add one hook
```

## Key design decisions

### JSONL tail-scan for `custom-title`

Claude Code's `/rename` command appends
`{"type":"custom-title","customTitle":"…"}` as a JSONL line at the end of the
session file. Sessions can be huge (MB+), so we scan only the last 128 KB via
`_scan_tail_claude_title` in `app.py`. The *last* matching line wins.

### Sub-agent files are excluded from the session list

Sub-agent sessions live at `~/.claude/projects/<encoded>/<uuid>/subagents/agent-*.jsonl`.
They are **not** resumable via `claude --resume`, so listing them produces a
"No sessions match 'agent-ab33…'" error when the user clicks Resume.
`_all_jsonl()` filters them out with:
- `"subagents" in path.parts`
- filename must match `_UUID_RE` (not `agent-*`)
- must be a direct child of `PROJECTS_DIR/<project>/`

### Labels: user-set only, no auto-generation

An earlier version (v0.1.1) auto-generated 3-5 word labels by calling
`claude -p "summarize this"`. This spawned new sessions that the viewer then
tried to label, creating a feedback loop that produced 438 orphan JSONLs and
26 stuck processes. Removed in v0.1.3. **Do not reintroduce any
auto-labeling that invokes the Claude CLI.**

### Per-tab focus on Windows Terminal

Windows Terminal multiplexes many tabs into a single HWND, so
`SetForegroundWindow(wt_hwnd)` only raises the window — it can't select a
specific tab. Two-part solution:

1. **`hooks/session_start.py`** (a Claude Code hook) stamps the tab title
   with `\x1b]0;<title>\x07` (OSC-0) and returns `sessionTitle` JSON on
   `UserPromptSubmit`. The title is `cc-<sid8>` or `<user-label> · <sid8>`.
2. **`_uia_select_tab`** uses `uiautomation` to walk the Windows Terminal
   UI tree, find the `TabItemControl` whose `Name` contains the 8-char
   session ID, and call `GetSelectionItemPattern().Select()` + `SetActive()`.

This is the only method that worked reliably for *externally-started*
sessions. Fallbacks (`powershell AppActivate`, ctypes `SetForegroundWindow`)
are kept for WT tabs we ourselves spawned.

### Two front-end layouts, one source of truth

Originally `frontend/` lived at the repo root. For `pipx install` to work,
the wheel must be self-contained, so we moved the SPA to `backend/frontend/`.
`FRONTEND_DIR` resolution handles three install shapes:

1. Source checkout: `backend/frontend/` next to `app.py`
2. Installed wheel: same, inside site-packages
3. PyInstaller one-file exe: `<sys._MEIPASS>/backend/frontend/` (datas from spec)

### CLAUDE_HOME env override

`backend.app` reads `~/.claude` via `CLAUDE_HOME` env override:

```python
_CLAUDE_HOME_ENV = os.environ.get("CLAUDE_HOME")
CLAUDE_HOME = Path(_CLAUDE_HOME_ENV).resolve() if _CLAUDE_HOME_ENV else Path(expanduser("~/.claude"))
```

This is what makes hermetic CI possible. Tests set `CLAUDE_HOME=tests/fixtures/claude-home`
and get a reproducible 2-session world with a known sub-agent file to filter out.

### Command-injection defense in `/api/open`

`/api/open` invokes `wt.exe` with user-visible `cwd` and `sessionId`. Defense-in-depth:

1. `sessionId` must match `_UUID_RE`; the regex **match object**'s `.group(0)`
   becomes the value passed to subprocess. (CodeQL's taint tracker recognizes
   regex-match extraction as a sanitizer.)
2. `mode` must be exactly `"tab"` or `"split"` (mapped to constants).
3. `cwd` is canonicalized via `Path(...).resolve()`.
4. `subprocess.Popen(cmd, shell=False)`.
5. The previous `cmd.exe /k` fallback (which *was* a real injection sink) was
   removed in v0.2.0.

See `SECURITY.md` for the full audit write-up.

## Things not to do

- **Don't re-export frontend from the repo root**. Wheel packaging breaks.
- **Don't auto-generate session labels** by shelling out to `claude`. Feedback loop.
- **Don't widen the bind** past `127.0.0.1`. The app has no auth and reads the
  user's entire session history.
- **Don't amend published commits** on `main` or force-push tags. Bump and re-tag.
- **Don't skip the CHANGELOG entry**. The release workflow will abort on
  "No changelog entry for vX.Y.Z".

## Things to do when adding a feature

- New endpoint → add a test in `tests/test_backend_api.py` using the
  `client` fixture.
- New runtime dep → add to `pyproject.toml` `dependencies` AND
  `backend/requirements.txt` (the legacy launcher reads the latter).
- New CLI flag → document in `README.md` Install section and `cli.py` argparse `help=`.
- New release asset → add to `docs/RELEASE.md` "Expected assets" table and
  the `gh release create` call in `release.yml`.
