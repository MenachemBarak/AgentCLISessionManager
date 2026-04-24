# Step tasks — step 000004

Covers the autonomous-mode session from ~v1.1.0 release pain through v1.2.7 release. Chronological.

## T-25: Hotfix v1.1.0 legacy-layout crash → v1.1.1

- **BEFORE**: v1.1.0 shipped. User installed it; every persisted session tab rendered "session exited" immediately. Screenshots confirmed dead `cc-<sid>` tabs.
- **AFTER**: `backend/frontend/app.jsx::migrateLegacyTerminals` walks restored tab trees and rewrites `{provider, sessionId}` leaves to `{cmd:['cmd.exe'], _autoResume:...}`. Debounced persist re-writes the file so subsequent boots start clean. v1.1.1 released.
- **Files**: `backend/frontend/app.jsx` (migration helpers + rehydrate call), `e2e/tests/feature/legacy-layout-migration.spec.ts` (reproducing test), `backend/__version__.py` → 1.1.1, `CHANGELOG.md`.
- **Related prior steps**: `step-000003::T-22` defined shell-wrap but didn't migrate old layouts.
- **Related sibling files in this step**: `lessons-learned.md::L-22`, `user-notes.md` (user's screenshot triggering directive).

## T-26: ADR-18 daemon-split architecture + 10 phases of implementation

- **BEFORE**: Single-exe model — UI + daemon + PTYs all in one PyInstaller binary. Self-update kills everything.
- **AFTER**: `docs/design/adr-18-daemon-split.md` plus shipped code for Phases 2-7:
  - Phase 2 (#51): `daemon/` package + `/api/health`
  - Phase 3a (#52): `daemon/bootstrap.py` (pid singleton + bearer token) + auth middleware
  - Phase 3b (#53): `daemon/launcher.py` (probe + spawn_detached) + `--probe-daemon` CLI
  - Phase 3c (#54): cli.py daemon-mode launcher + frontend URL-fragment token injection
  - Phase 4 (#55): RingBuffer + PTY REST endpoints
  - Phase 5 (#57): WS reattach-by-id with ring-buffer replay
  - Phase 6 (#56): `--uninstall` CLI (Law 3)
  - Phase 7 (#66): 501 stubs for dual-asset update endpoints
- **Files**: `daemon/__init__.py`, `daemon/__main__.py`, `daemon/bootstrap.py`, `daemon/launcher.py`, `daemon/uninstall.py`, `backend/app.py` (middleware + shutdown/pin/pty endpoints), `backend/cli.py` (flags), 6 new test files.
- **Related prior steps**: N/A — fresh architectural direction.
- **Related sibling files**: `architecture-decisions.md::ADR-18,ADR-20,ADR-24`, `lessons-learned.md::L-26,L-27`, `knowledge.md`.

## T-27: Inno Setup installer + switch to one-folder mode → #45 closed

- **BEFORE**: Raw-exe ship model; user complained "why you dont create proper app installer like all app in the world". Also seeing "Failed to remove temporary directory _MEI<pid>" dialog on update.
- **AFTER**: `installer/agentmanager.iss` (Inno Setup 6, per-user, Add/Remove Programs entry, closes via `--uninstall --yes`). Release workflow builds both one-file (for legacy auto-update) + one-folder (for installer) via `pyinstaller-onedir.spec`. v1.2.0 shipped installer; v1.2.2 switched installer to one-folder → no more _MEI dialog for installer users.
- **Files**: `installer/agentmanager.iss`, `pyinstaller-onedir.spec`, `.github/workflows/release.yml` (2 new build steps + silent install smoke test).
- **Related prior steps**: N/A.
- **Related sibling files**: `architecture-decisions.md::ADR-19,ADR-24`, `lessons-learned.md::L-23,L-24`, `user-notes.md`.

## T-28: Smart session search (task #40) → /api/search + frontend wiring + Unicode fix

- **BEFORE**: Left-pane search was substring-only, ASCII-only, no ranking.
- **AFTER**: `/api/search?q=&limit=` endpoint (#59) with TF-weighted ranker in `backend/search.py`. Frontend wired (#60) — debounced 250ms fetch when query has 2+ tokens; single-token stays local for zero-latency. Hebrew/Chinese/accented Latin fix (#64) — tokenizer switched from `[A-Za-z0-9_]+` to `\w+` + guarded stemmer on `.isascii()`.
- **Files**: `backend/search.py` (new), `backend/app.py::/api/search`, `backend/frontend/compact-list.jsx` (debounced smart-search effect + branch in active/idle filters), `tests/test_search.py` (22 cases).
- **Related prior steps**: N/A.
- **Related sibling files**: `architecture-decisions.md::ADR-22`.

## T-29: Ctrl+K command palette with preview + recent searches

- **BEFORE**: No global jump-to-session shortcut.
- **AFTER**: VSCode-style palette in `backend/frontend/palette.jsx`. Progressive ships: #62 (shell + wiring), #63 (2-column layout with preview pane showing first user messages + metadata), #65 (localStorage-backed recent searches shown on empty query).
- **Files**: `backend/frontend/palette.jsx` (new), `backend/frontend/index.html` (script tag), `backend/frontend/app.jsx` (Ctrl+K handler + render), `e2e/tests/feature/command-palette.spec.ts` (5 cases).
- **Related prior steps**: N/A.
- **Related sibling files**: `knowledge.md` (keyboard shortcuts).

## T-30: Transcript markdown export + copy-session-id

- **BEFORE**: No way to share a session outside the app.
- **AFTER**: `GET /api/sessions/{sid}/transcript.md` (#67) returns structured markdown with title + metadata + role headings + ISO timestamps. Transcript header has ↓ .md download link (#67) and clickable session id with "✓ copied" feedback (#68).
- **Files**: `backend/app.py::/api/sessions/{sid}/transcript.md`, `backend/frontend/transcript.jsx`, `tests/test_transcript_markdown.py` (6 cases), `e2e/tests/feature/transcript-export.spec.ts`, `e2e/tests/feature/transcript-copy-id.spec.ts`.
- **Related prior steps**: N/A.

## T-31: Pin sessions to top

- **BEFORE**: Sort by recency only.
- **AFTER**: Star icon on row hover (`backend/frontend/compact-list.jsx::PinStar`). `POST /api/sessions/{sid}/pin {pinned: bool}` persists to `~/.claude/viewer-labels.json`. Sort order pinned-first in `/api/sessions`, `/api/search`, `sortSessions`, `groupByCwd`. Load-bearing fix: `data.jsx::normalize` was dropping the `pinned` field from SSE events.
- **Files**: `backend/app.py::_get_pinned/_set_pinned/PinReq/pin_session`, `backend/frontend/compact-list.jsx::PinStar`, `backend/frontend/utils.jsx::sortSessions`, `backend/frontend/data.jsx::normalize`, `tests/test_session_pin.py` (6 cases), `e2e/tests/feature/session-pin.spec.ts` (2 cases).
- **Related prior steps**: N/A.
- **Related sibling files**: `architecture-decisions.md::ADR-21`, `lessons-learned.md::L-28`.

## T-32: Keyboard nav in session list + Ctrl+F transcript find

- **BEFORE**: Left pane required mouse; transcript had no intra-session search.
- **AFTER**: ↑/↓ moves selection, `/` focuses search, Esc clears (`compact-list.jsx` global keydown). Ctrl+F opens a find bar above the transcript with live highlighting, match counter (`3/12`), Enter/Shift+Enter cycles, Esc closes (`transcript.jsx`). Both shipped together in v1.2.7.
- **Files**: `backend/frontend/compact-list.jsx` (visibleIds memo + keydown handler), `backend/frontend/transcript.jsx` (find bar + highlightText), `e2e/tests/feature/session-list-keyboard.spec.ts`, `e2e/tests/feature/transcript-find.spec.ts`.
- **Related prior steps**: N/A.

## T-33: Dependabot cleanup — merged 5, rebased 3

- **BEFORE**: 10 open dependabot PRs.
- **AFTER**: Merged #4, #5, #8, #9, #35 (all CI-green, mergeable). Triggered `@dependabot rebase` on #6, #10, #11 (still UNKNOWN after). #7, #19 had failures; left alone.
- **Files**: N/A (just PR merges).
- **Related prior steps**: N/A.

## T-34: 8 releases cut (v1.1.1 → v1.2.7)

- **BEFORE**: At v1.1.0 at start of this step.
- **AFTER**: 8 tags shipped, each with full release workflow (build + wheel + sdist + one-file exe + one-folder + installer + smoke-test install/uninstall + GitHub Release). All green except one mid-cycle release.yml bash → pwsh fix for Inno Setup.
- **Files**: `backend/__version__.py` (8 bumps), `CHANGELOG.md` (8 new sections).
- **Related prior steps**: N/A.
- **Related sibling files**: `architecture-decisions.md::ADR-23`.
