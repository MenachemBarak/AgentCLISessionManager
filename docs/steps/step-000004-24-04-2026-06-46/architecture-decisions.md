# Architecture decisions — step 000004

## ADR-18: Daemon/UI split for zero-downtime upgrades (full writeup at docs/design/adr-18-daemon-split.md)

- **Decision**: Ship AgentManager as two binaries — short-lived UI (`AgentManager.exe`) + long-lived daemon (`AgentManager-Daemon.exe`). Loopback IPC on `127.0.0.1:8765` with a per-install bearer token.
- **Alternatives considered**:
  - Detach PTY from current process via DETACHED_PROCESS — rejected; ConPTY ties children to the spawning console.
  - Windows Service — rejected; needs UAC at install, we install per-user.
  - Keep single-exe, accept session loss on update — rejected; user explicit "highest priority" directive.
- **Why**: Matches VSCode ptyHost / Cursor / Docker Desktop / WezTerm mux patterns. HPCON non-transferable (github.com/microsoft/terminal #4479) forces a stable owner.
- **Blast radius**: `daemon/` package, `backend/app.py`, `backend/cli.py`, all PyInstaller specs, release workflow. Opt-in via `AGENTMANAGER_DAEMON=1` for v1.2.x; default-on planned v1.3.0.
- **Reversibility**: Opt-in flag makes it two-way for this release. Default-on would be one-way for users who already have split data in `%LOCALAPPDATA%\AgentManager\`.

## ADR-19: Installer wraps one-folder, raw exe stays one-file (dual-shape ship)

- **Decision**: From v1.2.2 onward, the Inno Setup installer packages the PyInstaller one-folder output. The raw `AgentManager-<ver>-windows-x64.exe` asset keeps being built from the one-file spec.
- **Alternatives considered**:
  - All-one-file: keeps auto-updater simple but leaves the `_MEI<pid>` cleanup dialog visible to every user.
  - All-one-folder: eliminates _MEI dialog but breaks v0.9.x→v1.x auto-update (those clients expect a drop-in single-exe swap).
- **Why**: Gives installer users the cleaner experience immediately while preserving the existing in-place update chain for users on the raw-exe path.
- **Blast radius**: `pyinstaller.spec` (unchanged one-file), `pyinstaller-onedir.spec` (new), `release.yml` (builds both), `installer/agentmanager.iss` (points at folder now).
- **Reversibility**: Two-way until we deprecate the raw exe (earliest v1.4).

## ADR-20: Bearer-token auth via URL fragment → window.fetch patch

- **Decision**: Daemon mode injects the bearer token into the webview URL as a fragment (`http://127.0.0.1:8765/#token=<hex>`). Frontend inline script reads the fragment, strips it from the URL bar, patches `window.fetch` + `WebSocket` constructor to attach the token to every same-origin request.
- **Alternatives considered**:
  - Named-pipe IPC — rejected; WebKit inside pywebview can't speak named pipes from JS.
  - Cookie from an initial bootstrap request — considered; more plumbing and still exposes cookie to other processes on the same user account.
  - Query parameter — rejected; ends up in server logs / referer headers.
- **Why**: URL fragments are NEVER sent to the server (RFC 3986 + browser behaviour), so the token can't leak via access logs. The inline script runs BEFORE every module script in `index.html`, so the token is patched in before any `fetch`/`WebSocket` call.
- **Blast radius**: `backend/frontend/index.html` (inline auth-init script), `backend/app.py` middleware allowlist.
- **Reversibility**: Trivial — remove the inline script + middleware gate. Nothing is stored durably on the client.

## ADR-21: Pin state lives in viewer-labels.json (additive schema)

- **Decision**: `pinned: bool` + `pinnedAt: epoch` fields added to the existing `~/.claude/viewer-labels.json` per-sid entry, next to `userLabel`. Sort order: pinned-first, then existing sort mode.
- **Alternatives considered**:
  - New `viewer-pins.json` file — rejected; two files for related UI state is worse than one.
  - Local-storage only — rejected; pins should survive reinstalls like labels do.
- **Why**: Additive, zero migration, backward-compatible (older viewers that don't know about pinned just ignore the field).
- **Blast radius**: `backend/app.py::_get_pinned` / `_set_pinned` / `/api/sessions/{sid}/pin`, `backend/frontend/compact-list.jsx` PinStar component + `sortSessions` + `groupByCwd`, `backend/frontend/data.jsx::normalize`.
- **Reversibility**: Trivial.

## ADR-22: Local-first smart search (no API key, no model)

- **Decision**: Backend `/api/search` uses a local TF-weighted ranker with field weights (`userLabel`×5, `title`×3, `claudeTitle`×2.5, `firstUserMessages`×1, `cwd`×0.4), length normalization, co-occurrence boost, phrase-match boost, simple ASCII-only stemmer, small stopword list.
- **Alternatives considered**:
  - Claude SDK re-rank — deferred; needs `ANTHROPIC_API_KEY` most users don't have set up.
  - Full BM25 — overkill for this dataset size.
- **Why**: Works offline, zero setup friction, still sharp enough for 10k-session corpora.
- **Blast radius**: `backend/search.py`, `backend/app.py::/api/search`, `backend/frontend/compact-list.jsx` (debounced call), `backend/frontend/palette.jsx` (used by Ctrl+K).
- **Reversibility**: Trivial; the endpoint is additive and falls back to local substring filter on the frontend.

## ADR-23: Release cadence — independent minor/patch releases per feature

- **Decision**: Rather than batching features into a single bigger release, cut a release per merged PR or small logical batch. Released v1.1.1 through v1.2.7 (8 tags) in this session.
- **Alternatives considered**:
  - Single v1.3.0 with everything — rejected; user feedback loop would have been 6+ hours delayed.
- **Why**: Users get features immediately via the auto-update banner. Regression surface of each release is small → easier to bisect if something breaks.
- **Blast radius**: CHANGELOG.md gets lots of entries; release page gets long. No code cost.
- **Reversibility**: Trivial per-release; can always revert a tag and cut a hotfix.

## ADR-24: `--uninstall` first, then Inno uninstaller

- **Decision**: The Inno Setup installer's `[UninstallRun]` invokes `AgentManager.exe --uninstall --yes` BEFORE Inno removes the files. That Phase-6 CLI kills the running daemon + walks the PTY tree (`psutil.Process.children(recursive=True).kill()`).
- **Alternatives considered**:
  - Let Inno kill via `CloseApplications=force` alone — doesn't walk the PTY grandchildren (the known Squirrel/VSCode orphan-process class of bug).
- **Why**: Matches Law 3 (UNINSTALLABLE) — no orphan claude processes after uninstall.
- **Blast radius**: `installer/agentmanager.iss` `[UninstallRun]` section, `daemon/uninstall.py`, `backend/cli.py` flag.
- **Reversibility**: Trivial.
