"""Claude Sessions Viewer — FastAPI backend.

Reads Claude Code JSONL sessions from ~/.claude/projects/**/*.jsonl and serves
them to the React frontend. Live updates via SSE + watchdog.
"""

from __future__ import annotations

import asyncio
import json
import os
import platform
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import psutil
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from backend import updater
from backend.__version__ import __version__
from backend.providers import PROVIDERS
from backend.providers import available as _available_providers
from backend.terminal import (
    PtySession,
    PtySessionManager,
    bridge_pty_to_websocket,
)

IS_WINDOWS = platform.system() == "Windows"

# CLAUDE_HOME env overrides ~/.claude (used by tests to inject fixtures).
_CLAUDE_HOME_ENV = os.environ.get("CLAUDE_HOME")
if _CLAUDE_HOME_ENV:
    CLAUDE_HOME = Path(_CLAUDE_HOME_ENV).resolve()
else:
    CLAUDE_HOME = Path(os.path.expanduser("~")) / ".claude"

HOME = CLAUDE_HOME.parent
PROJECTS_DIR = CLAUDE_HOME / "projects"
ACTIVE_DIR = CLAUDE_HOME / "sessions"
SETTINGS_FILE = CLAUDE_HOME / "settings.json"
LABELS_FILE = CLAUDE_HOME / "viewer-labels.json"
PROJECT_ROOT = Path(__file__).resolve().parent.parent


# frontend/ ships inside the backend package so the wheel is self-contained.
# In a PyInstaller one-file exe, data files land under sys._MEIPASS instead.
def _resolve_frontend_dir() -> Path:
    here = Path(__file__).resolve().parent / "frontend"
    if here.is_dir():
        return here
    import sys as _sys

    meipass = getattr(_sys, "_MEIPASS", None)
    if meipass:
        fallback = Path(meipass) / "backend" / "frontend"
        if fallback.is_dir():
            return fallback
    return here  # will fail at mount-time with a clear error


FRONTEND_DIR = _resolve_frontend_dir()
HOOK_SCRIPT = PROJECT_ROOT / "hooks" / "session_start.py"

import threading  # noqa: E402

_LABELS_LOCK = threading.Lock()


def _load_labels() -> dict[str, Any]:
    try:
        data = json.loads(LABELS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_labels(d: dict[str, Any]) -> None:
    with _LABELS_LOCK:
        LABELS_FILE.parent.mkdir(parents=True, exist_ok=True)
        LABELS_FILE.write_text(json.dumps(d, indent=2), encoding="utf-8")


def _get_user_label(sid: str) -> str | None:
    e = _load_labels().get(sid)
    return e.get("userLabel") if isinstance(e, dict) else None


def _set_user_label(sid: str, label: str | None) -> None:
    d = _load_labels()
    raw = d.get(sid)
    entry: dict[str, Any] = raw if isinstance(raw, dict) else {}
    if label is None or not label.strip():
        entry.pop("userLabel", None)
        if not entry:
            d.pop(sid, None)
        else:
            d[sid] = entry
    else:
        entry["userLabel"] = label.strip()[:80]
        entry["userAt"] = time.time()
        d[sid] = entry
    _save_labels(d)


def _get_pinned(sid: str) -> bool:
    e = _load_labels().get(sid)
    return bool(e.get("pinned")) if isinstance(e, dict) else False


def _set_pinned(sid: str, pinned: bool) -> None:
    """Flip the pinned flag in the shared viewer-labels.json store.

    Additive to the existing userLabel entry — both coexist in the
    same file under the same sid key. Unpinning drops the field (and
    deletes the whole entry if nothing else is there) to keep the
    file from accumulating cruft.
    """
    d = _load_labels()
    raw = d.get(sid)
    entry: dict[str, Any] = raw if isinstance(raw, dict) else {}
    if pinned:
        entry["pinned"] = True
        entry["pinnedAt"] = time.time()
        d[sid] = entry
    else:
        entry.pop("pinned", None)
        entry.pop("pinnedAt", None)
        if not entry:
            d.pop(sid, None)
        else:
            d[sid] = entry
    _save_labels(d)


app = FastAPI(title="AgentManager", version=__version__)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ─────────────────────── daemon-mode bearer auth (ADR-18 / Task #42) ─
# When launched via `python -m daemon`, the entrypoint sets
# `app.state.require_bearer_token` to the per-install secret read from
# %LOCALAPPDATA%\AgentManager\token. Every request except a small
# allowlist must present `Authorization: Bearer <token>` or get 401.
# In non-daemon mode (legacy dev server / existing PyInstaller exe)
# `require_bearer_token` stays None → the middleware is a no-op, so
# callers that haven't opted in see zero behaviour change.
_AUTH_ALLOWLIST = {
    "/api/health",  # UI shim probes this BEFORE it has the token
    "/docs",
    "/redoc",
    "/openapi.json",
}


@app.middleware("http")
async def _bearer_auth(request, call_next):  # type: ignore[no-untyped-def]
    required = getattr(app.state, "require_bearer_token", None)
    if not required:
        return await call_next(request)
    if request.url.path in _AUTH_ALLOWLIST:
        return await call_next(request)
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        from starlette.responses import JSONResponse

        return JSONResponse({"error": "missing bearer token"}, status_code=401)
    if header[len("bearer ") :].strip() != required:
        from starlette.responses import JSONResponse

        return JSONResponse({"error": "invalid bearer token"}, status_code=401)
    return await call_next(request)


# ─────────────────────── JSONL parsing ───────────────────────
def _extract_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "\n".join(parts).strip()
    return ""


def _is_meta(line_obj: dict[str, Any]) -> bool:
    if line_obj.get("isMeta"):
        return True
    msg = line_obj.get("message") or {}
    text = _extract_text(msg.get("content"))
    if not text:
        return True
    # skip system-injected caveats
    if text.startswith("<local-command") or text.startswith("<command-") or text.startswith("Caveat:"):
        return True
    return False


def _iter_lines(path: Path) -> Iterator[dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
    except OSError:
        return


def _scan_tail_claude_title(path: Path, bytes_from_end: int = 131072) -> str | None:
    """Return the latest Claude-set session title from a JSONL's tail.

    Claude Code appends `{"type":"custom-title","customTitle":"...",}` and
    `{"type":"agent-name",...}` entries when the user runs `/rename` or when
    a hook returns `sessionTitle`. The latest wins.
    """
    try:
        size = path.stat().st_size
        with path.open("rb") as f:
            if size > bytes_from_end:
                f.seek(size - bytes_from_end)
                f.readline()  # discard partial line at the seek point
            data = f.read()
    except OSError:
        return None
    text = data.decode("utf-8", errors="replace")
    latest: str | None = None
    for line in text.splitlines():
        if '"custom-title"' not in line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if obj.get("type") == "custom-title":
            t = obj.get("customTitle")
            if isinstance(t, str) and t.strip():
                latest = t.strip()
    return latest


def _scan_session_meta(path: Path, deep: bool = False) -> dict[str, Any] | None:
    """Return minimal metadata for a session file.

    deep=False: only first ~40 lines (cheap, for list view).
    deep=True:  read first 10 user messages (for hover/preview).
    """
    try:
        stat = path.stat()
    except OSError:
        return None

    session_id = path.stem
    title = ""
    cwd = ""
    branch = ""
    model = ""
    created_ms = int(stat.st_mtime * 1000)
    first_user_messages: list[str] = []
    line_count = 0

    limit = 400 if deep else 60
    for i, obj in enumerate(_iter_lines(path)):
        line_count += 1
        if not cwd and obj.get("cwd"):
            cwd = obj["cwd"]
        if not branch and obj.get("gitBranch"):
            branch = obj["gitBranch"]
        ts = obj.get("timestamp")
        if ts and not title and i == 0:
            # parse ISO → ms
            try:
                from datetime import datetime

                created_ms = int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)
            except Exception:
                pass
        msg = obj.get("message") or {}
        if not model and isinstance(msg, dict) and msg.get("model"):
            model = msg["model"]
        if obj.get("type") == "user" and not _is_meta(obj):
            text = _extract_text(msg.get("content"))
            if text:
                if not title:
                    title = text.splitlines()[0][:140]
                if len(first_user_messages) < 10:
                    first_user_messages.append(text[:300])
        if not deep and i >= limit and title and cwd:
            break
        if deep and len(first_user_messages) >= 10 and i > 80:
            break

    if not title:
        title = f"(no user message) {session_id[:8]}"
    if not cwd:
        # fall back to encoded project dir name
        cwd = path.parent.name.replace("--", ":/").replace("-", "/")

    # Extract latest Claude-set session title from the tail of the file.
    claude_title = _scan_tail_claude_title(path)

    return {
        "id": session_id,
        "title": title,
        "claudeTitle": claude_title,
        "cwd": cwd,
        "branch": branch or "-",
        "model": model or "claude",
        "createdAt": created_ms,
        "lastActive": int(stat.st_mtime * 1000),
        "messageCount": line_count,  # approximation; full count requires full read
        "tokens": 0,
        "active": False,
        "activityLabel": None,
        "firstUserMessages": first_user_messages,
        "path": str(path),
    }


# ─────────────────────── Active PID detection ───────────────────────
# Tolerance in seconds for comparing marker.startedAt (ms, written by
# Claude Code CLI) against psutil.Process(pid).create_time() (unix sec).
# Windows clock resolution + our rounding can drift a second either way.
_PID_REUSE_TOLERANCE_S = 3.0


def _is_live_marker(pid: int, started_at_ms: int | None) -> bool:
    """True iff `pid` exists AND the process started close enough to the
    marker's recorded startedAt to rule out PID reuse.

    Windows recycles PIDs quickly: closing a shell that was hosting
    `claude` frees its PID, and the OS may hand it to an unrelated
    process seconds later. `psutil.pid_exists(pid)` then returns True
    for the *wrong* process, so the marker would stay "active" forever
    even after a `rescan`. The fix is to cross-check the process's
    actual start time against what Claude Code recorded.

    Falls back to the old pid_exists-only check when the marker has no
    startedAt (pre-Claude-Code-2.x markers) — this keeps legacy markers
    working, accepting that those remain vulnerable to PID reuse until
    they get overwritten by a fresh session.
    """
    try:
        if not psutil.pid_exists(pid):
            return False
        if not started_at_ms:
            return True  # legacy marker without startedAt — best-effort
        proc = psutil.Process(pid)
        expected = started_at_ms / 1000.0
        return abs(proc.create_time() - expected) < _PID_REUSE_TOLERANCE_S
    except (psutil.NoSuchProcess, psutil.AccessDenied, OSError):
        return False


def _get_active_session_ids() -> set[str]:
    active: set[str] = set()
    if not ACTIVE_DIR.is_dir():
        return active
    for f in ACTIVE_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            pid = data.get("pid")
            sid = data.get("sessionId")
            started_at = data.get("startedAt")
            if pid and sid and _is_live_marker(int(pid), started_at):
                active.add(sid)
        except Exception:
            continue
    return active


def _activity_for(path: Path) -> str:
    age = time.time() - path.stat().st_mtime
    if age < 3:
        return "streaming"
    if age < 15:
        return "thinking"
    return "active"


# ─────────────────────── Session index (cache) ───────────────────────
_INDEX: dict[str, dict[str, Any]] = {}
_INDEX_BUILT = False
_INDEX_PROGRESS: dict[str, Any] = {"done": 0, "total": 0, "phase": "idle"}


_UUID_RE = __import__("re").compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def _is_indexable_session_path(p: Path) -> bool:
    """True if `p` is a path the index would track.

    Shared by `_all_jsonl` (initial scan) and `_Watcher` (live updates) so
    the two agree exactly on what counts as a session. Anything else is a
    sub-agent file, a non-UUID name, or lives at the wrong depth.
    """
    if p.suffix != ".jsonl":
        return False
    if "subagents" in p.parts:
        return False
    if not _UUID_RE.match(p.stem):
        return False
    try:
        rel = p.relative_to(PROJECTS_DIR)
    except ValueError:
        return False
    return len(rel.parts) == 2


def _all_jsonl() -> list[Path]:
    """Top-level session files only.

    Claude Code top-level sessions live directly under
    ~/.claude/projects/<encoded>/<uuid>.jsonl. Sub-agent sessions live under
    <uuid>/subagents/agent-*.jsonl and are NOT resumable via `claude --resume`,
    so we exclude them. Shares its predicate with `_is_indexable_session_path`
    (defined below) so the initial scan and the watchdog agree on every file.
    """
    if not PROJECTS_DIR.is_dir():
        return []
    return [p for p in PROJECTS_DIR.rglob("*.jsonl") if _is_indexable_session_path(p)]


def _cleanup_stale_active_markers() -> int:
    """Delete `~/.claude/sessions/<pid>.json` files whose process is
    gone — or whose PID has been recycled to a different process.

    Called on startup + on explicit rescan. Without the PID-reuse
    defense this accumulated ghost markers on Windows: closing a
    PowerShell hosting `claude` freed its PID, the OS handed it to
    e.g. notepad, `pid_exists` returned True for the new owner, and
    the marker stayed "active" forever. `_is_live_marker` cross-checks
    `psutil.Process(pid).create_time()` against the marker's own
    `startedAt` with a small tolerance.

    Returns the number of stale files removed.
    """
    if not ACTIVE_DIR.is_dir():
        return 0
    removed = 0
    for f in ACTIVE_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            pid = int(data.get("pid") or 0)
            started_at = data.get("startedAt")
        except Exception:  # noqa: BLE001
            # Unreadable / corrupt marker — drop it.
            try:
                f.unlink()
                removed += 1
            except OSError:
                pass
            continue
        if pid and not _is_live_marker(pid, started_at):
            try:
                f.unlink()
                removed += 1
            except OSError:
                pass
    return removed


def build_index(force: bool = False) -> None:
    """(Re)build the in-memory session index.

    `force=True` clears the cache first so a full rescan happens even when
    the file mtimes haven't changed. Useful after a power loss / app
    restart where we want to re-read everything fresh.
    """
    global _INDEX_BUILT
    if force:
        _INDEX.clear()
    _cleanup_stale_active_markers()
    files = _all_jsonl()
    _INDEX_PROGRESS["total"] = len(files)
    _INDEX_PROGRESS["done"] = 0
    _INDEX_PROGRESS["phase"] = "scanning"
    for p in files:
        try:
            mtime = p.stat().st_mtime
        except OSError:
            _INDEX_PROGRESS["done"] += 1
            continue
        cached = _INDEX.get(p.stem)
        if cached and cached.get("_mtime") == mtime:
            _INDEX_PROGRESS["done"] += 1
            continue
        meta = _scan_session_meta(p, deep=False)
        if meta:
            meta["_mtime"] = mtime
            _INDEX[p.stem] = meta
        _INDEX_PROGRESS["done"] += 1
    _INDEX_PROGRESS["phase"] = "ready"
    _INDEX_BUILT = True


@app.get("/api/status")
def status() -> dict[str, Any]:
    return {
        "version": __version__,
        "ready": _INDEX_BUILT,
        "done": _INDEX_PROGRESS["done"],
        "total": _INDEX_PROGRESS["total"],
        "phase": _INDEX_PROGRESS["phase"],
    }


@app.post("/api/shutdown")
def shutdown() -> dict[str, Any]:
    """Ask the daemon to exit cleanly (ADR-18 Law 3 / Phase 6).

    Used by `AgentManager --uninstall` before force-killing. Auth-gated
    in daemon mode — a rogue same-user process shouldn't be able to
    kill the user's daemon with a single unauthenticated POST.

    Implementation: close all PTYs, then schedule os._exit on a short
    timer so the HTTP response has time to drain back to the caller
    before the process vanishes.
    """
    import threading

    _pty_manager.close_all()

    def _bye() -> None:
        time.sleep(0.15)
        os._exit(0)

    threading.Thread(target=_bye, name="AgentManager-shutdown", daemon=True).start()
    return {"ok": True, "message": "shutting down"}


@app.get("/api/health")
def health() -> dict[str, Any]:
    """Cheap liveness probe used by the UI shim (ADR-18 / Task #42) to
    decide whether a daemon is already running on port 8765.

    Returns immediately without touching the index — the UI shim may hit
    this every ~200ms during startup while polling for daemon availability.
    Keep it free of I/O; `daemonVersion` comes from the in-process constant.
    """
    return {"ok": True, "daemonVersion": __version__}


@app.get("/api/providers")
def list_providers() -> dict[str, Any]:
    """List every known agent-CLI provider and whether it's active on this
    machine (home dir exists). Only `claude-code` is implemented today; the
    registry is the extension point — new adapters drop into
    `backend/providers/<agent>.py` and register in `PROVIDERS`.
    """
    registered = []
    available_ids = {p.name for p in _available_providers()}
    for pid, cls in PROVIDERS.items():
        # instantiate lazily to get display_name without triggering any I/O
        try:
            display = cls.display_name
        except AttributeError:
            display = pid
        registered.append({"id": pid, "displayName": display, "available": pid in available_ids})
    return {"registered": registered, "active": sorted(available_ids)}


# ─────────────────────── API ───────────────────────
class OpenReq(BaseModel):
    sessionId: str
    mode: str  # "tab" | "split"


@app.on_event("startup")
async def _startup() -> None:
    # initial scan in background so server starts fast
    asyncio.create_task(asyncio.to_thread(build_index))
    start_watcher()
    # Self-update: clean any stale `.old` left by a prior swap, then
    # kick off a non-blocking check for a newer GitHub Release.
    updater.remove_stale_old_file()
    updater.start_background_check()
    # Plus a periodic re-check so a long-running viewer notices new
    # releases without a process restart. Fires every 30 min by default.
    updater.start_periodic_recheck()


@app.post("/api/rescan")
def rescan() -> dict[str, Any]:
    """Drop the cached index and the stale active-session markers, then
    rebuild from disk. Surfaced to the UI as a "Rescan" button for when
    the system has been through a power loss and `ACTIVE` might show
    stale rows."""
    removed = _cleanup_stale_active_markers()
    build_index(force=True)
    return {
        "ok": True,
        "staleActiveMarkersRemoved": removed,
        "indexed": _INDEX_PROGRESS.get("done", 0),
    }


LAYOUT_STATE_FILE = CLAUDE_HOME / "viewer-terminal-state.json"


@app.get("/api/layout-state")
def get_layout_state() -> dict[str, Any]:
    """Return the persisted terminal-tab + split-tree layout, or an empty
    default. Frontend reads this on mount to rehydrate the right-pane
    state (tabs, splits, which sessions were open as terminals)."""
    try:
        data = json.loads(LAYOUT_STATE_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:  # noqa: BLE001
        pass
    return {"terminals": [], "activeId": "transcript", "focusedPaneId": None}


class LayoutStateReq(BaseModel):
    terminals: list[dict[str, Any]]
    activeId: str | None = None
    focusedPaneId: str | None = None


@app.put("/api/layout-state")
def put_layout_state(req: LayoutStateReq) -> dict[str, Any]:
    """Persist the current right-pane layout. The frontend calls this on
    every tab add/close/split/resize so a crash or clean exit doesn't
    lose the arrangement. We store it per-user at
    ~/.claude/viewer-terminal-state.json."""
    LAYOUT_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "terminals": req.terminals,
        "activeId": req.activeId,
        "focusedPaneId": req.focusedPaneId,
    }
    LAYOUT_STATE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return {"ok": True}


@app.get("/api/update-status")
def update_status() -> dict[str, Any]:
    """Return latest-version info. Frontend polls on mount + after any
    successful download so the banner can reflect the new state."""
    return updater.STATE.snapshot()


@app.post("/api/update/download")
def update_download() -> dict[str, Any]:
    """Fetch the newer exe into a sibling `.new` file. Returns when the
    download completes — the frontend then tells the user to relaunch."""
    return updater.download_and_stage()


@app.post("/api/update/check")
def update_check() -> dict[str, Any]:
    """Re-fetch the latest release info from GitHub right now.

    Forces a synchronous check that bypasses any cached state. Used by
    the title-bar refresh button and the banner's hourly re-check, so
    the user sees newly published releases without restarting the app.
    """
    return dict(updater.force_recheck())


class _TestSeedReq(BaseModel):
    latestVersion: str
    checked: bool = True
    staged: bool = False


@app.post("/api/_test/seed-update-state")
def _test_seed_update_state(req: _TestSeedReq) -> dict[str, Any]:
    """Test-only hook — only active when CSV_TEST_MODE=1.

    Lets Playwright force the updater state to "newer version available"
    without waiting for a real release. The env-gate is checked per
    request so a running exe cannot be flipped into test mode remotely.
    """
    if os.environ.get("CSV_TEST_MODE") != "1":
        raise HTTPException(status_code=404, detail="not found")
    with updater.STATE.lock:
        updater.STATE.latest_version = req.latestVersion
        updater.STATE.checked = req.checked
        updater.STATE.staged_path = "fake-staged.exe.new" if req.staged else None
    return {"ok": True, "snapshot": updater.STATE.snapshot()}


@app.post("/api/update/apply")
def update_apply() -> dict[str, Any]:
    """Launch the Windows swap helper, then schedule our own exit.

    The helper script waits for this PID to exit before renaming the
    locked exe, so we must actually leave — otherwise it spins forever.
    We give the HTTP response ~0.8s to reach the browser before os._exit.
    """
    result = updater.apply_update()
    if result.get("ok"):

        def _suicide() -> None:
            time.sleep(0.8)
            os._exit(0)

        threading.Thread(target=_suicide, name="cs-update-exit", daemon=True).start()
    return dict(result)


# ADR-18 Phase 7: stub endpoints that will become meaningful once the
# two-binary split ships in Phase 9. Today they exist so the Phase-1
# daemon e2e test file (update.spec.ts) can compile against stable
# names; today they return 501 Not Implemented. Once we publish a
# separate AgentManager-Daemon.exe, apply-ui-only will swap just the UI
# while the daemon stays up (the payoff of the whole split), and
# apply-daemon will run the daemon migration path with restart-ping.


@app.post("/api/update/apply-ui-only")
def update_apply_ui_only() -> dict[str, Any]:
    """Swap the UI exe only; leave the daemon running (Phase 9 payoff).

    Today: stub that returns 501 with a machine-parseable reason code
    so the Phase-1 e2e test can assert the contract is in place.
    """
    raise HTTPException(
        status_code=501,
        detail={
            "code": "DAEMON_NOT_SPLIT",
            "message": (
                "UI-only updates require the two-binary ship (Phase 9). "
                "Current builds package UI+daemon in one exe; use /api/update/apply."
            ),
        },
    )


@app.post("/api/update/apply-daemon")
def update_apply_daemon() -> dict[str, Any]:
    """Swap the daemon exe; PTYs restart (covered by restart-ping)."""
    raise HTTPException(
        status_code=501,
        detail={
            "code": "DAEMON_NOT_SPLIT",
            "message": (
                "Daemon-only updates require the two-binary ship (Phase 9). "
                "Use /api/update/apply for the combined swap."
            ),
        },
    )


@app.get("/api/search")
def search_sessions(q: str = "", limit: int = 20) -> dict[str, Any]:
    """Smart session search (task #40).

    Natural-language query → ranked session list. Local TF-weighted
    ranking (see backend/search.py); no external calls. Returns the
    same row shape as /api/sessions plus a `_score` field so the UI
    can show a relevance indicator if wanted.
    """
    from backend.search import rank_sessions

    if not _INDEX_BUILT:
        build_index()
    if not q.strip():
        return {"query": q, "total": 0, "items": []}

    active_ids = _get_active_session_ids()
    labels = _load_labels()
    rows: list[dict[str, Any]] = []
    for meta in _INDEX.values():
        m: dict[str, Any] = {k: v for k, v in meta.items() if not k.startswith("_")}
        m.setdefault("provider", "claude-code")
        if m["id"] in active_ids:
            m["active"] = True
            m["activityLabel"] = _activity_for(Path(meta["path"]))
        entry = labels.get(m["id"]) if isinstance(labels.get(m["id"]), dict) else {}
        m["userLabel"] = entry.get("userLabel") if entry else None
        m["pinned"] = bool(entry.get("pinned")) if entry else False
        rows.append(m)
    # Pre-sort: pinned first, then recency, so score-ties break toward
    # the user's preferred order (stable sort in rank_sessions
    # preserves this input order).
    rows.sort(key=lambda s: (0 if s.get("pinned") else 1, -s["lastActive"]))
    ranked = rank_sessions(q, rows, limit=max(1, min(limit, 100)))
    return {"query": q, "total": len(ranked), "items": ranked}


@app.get("/api/sessions")
def list_sessions(limit: int = 1000, offset: int = 0) -> dict[str, Any]:
    if not _INDEX_BUILT:
        build_index()
    active_ids = _get_active_session_ids()
    labels = _load_labels()
    items: list[dict[str, Any]] = []
    for meta in _INDEX.values():
        m: dict[str, Any] = {k: v for k, v in meta.items() if not k.startswith("_")}
        # Tag every row with its provider — frontend uses this for the
        # per-provider filter, and API consumers use it to know which
        # agent-CLI adapter to route follow-up requests through.
        m.setdefault("provider", "claude-code")
        if m["id"] in active_ids:
            m["active"] = True
            m["activityLabel"] = _activity_for(Path(meta["path"]))
        entry = labels.get(m["id"]) if isinstance(labels.get(m["id"]), dict) else {}
        m["userLabel"] = entry.get("userLabel") if entry else None
        m["pinned"] = bool(entry.get("pinned")) if entry else False
        items.append(m)
    # Pinned-first, then recency. Sort is stable so ties preserve the
    # original (mtime) order within each group.
    items.sort(key=lambda s: (0 if s.get("pinned") else 1, -s["lastActive"]))
    return {
        "total": len(items),
        "items": items[offset : offset + limit],
    }


class PinReq(BaseModel):
    pinned: bool


@app.post("/api/sessions/{sid}/pin")
def pin_session(sid: str, req: PinReq) -> dict[str, Any]:
    """Toggle the pinned flag for a session. Pinned sessions sort first
    in /api/sessions regardless of last-active time."""
    _set_pinned(sid, req.pinned)
    return {"id": sid, "pinned": _get_pinned(sid)}


@app.get("/api/sessions/{sid}/label")
def get_session_label(sid: str) -> dict[str, Any]:
    return {"id": sid, "userLabel": _get_user_label(sid)}


class UserLabelReq(BaseModel):
    userLabel: str | None = None


@app.put("/api/sessions/{sid}/label")
def set_session_user_label(sid: str, req: UserLabelReq) -> dict[str, Any]:
    _set_user_label(sid, req.userLabel)
    return {"id": sid, "userLabel": _get_user_label(sid)}


# ─────────────────────── session move ───────────────────────
class SessionMovePlanReq(BaseModel):
    targetCwd: str


class SessionMoveExecuteReq(BaseModel):
    targetCwd: str
    confirm: bool = False


@app.post("/api/sessions/{sid}/move/plan")
def session_move_plan(sid: str, req: SessionMovePlanReq) -> dict[str, Any]:
    """Dry-run for a session move — read-only.

    Returns the structured plan from `move_session.plan_move`. Frontend
    must show this to the user verbatim and only enable the confirm
    button when `safe_to_move=True`. NEVER does I/O beyond reading.
    """
    from backend import move_session

    return move_session.plan_move(PROJECTS_DIR, sid, req.targetCwd)


@app.post("/api/sessions/{sid}/move/execute")
def session_move_execute(sid: str, req: SessionMoveExecuteReq) -> dict[str, Any]:
    """Perform the move. Requires explicit `confirm=true` in the body —
    a missing confirm flag returns a 400 instead of silently moving.
    """
    if not req.confirm:
        raise HTTPException(
            status_code=400,
            detail="confirm=true is required; call /move/plan first to see what will happen",
        )
    from backend import move_session

    result = move_session.execute_move(PROJECTS_DIR, sid, req.targetCwd)
    # On success, refresh the in-memory index eagerly — the watchdog
    # Observer would eventually fire on_created at the new path, but
    # callers that list /api/sessions immediately after the move would
    # hit the old-entry-deleted, new-entry-not-yet-seen window and see
    # the session disappear. Drop the stale entry AND re-scan the new
    # path in the same request so `/api/sessions` is correct on the
    # very next call.
    if result.get("ok"):
        _INDEX.pop(sid, None)
        plan = result.get("plan") or {}
        new_path = plan.get("dest_path") if isinstance(plan, dict) else None
        if isinstance(new_path, str):
            try:
                meta = _scan_session_meta(Path(new_path), deep=False)
                if meta is not None:
                    meta["_mtime"] = Path(new_path).stat().st_mtime
                    _INDEX[sid] = meta
            except Exception:  # noqa: BLE001 — scan failure is recoverable
                pass
        # Defence in depth: full rebuild on ANY miss. build_index reads
        # mtimes and skips unchanged entries, so the cost is bounded even
        # for large installs. `force=True` clears the cache first so a
        # cwd-rename doesn't leave stale entries around.
        if sid not in _INDEX:
            try:
                build_index(force=True)
            except Exception:  # noqa: BLE001 — best-effort; we already succeeded on disk
                pass
    return result


@app.get("/api/sessions/{session_id}/preview")
def session_preview(session_id: str) -> dict[str, Any]:
    meta = _INDEX.get(session_id)
    if not meta:
        raise HTTPException(404, "not found")
    deep = _scan_session_meta(Path(meta["path"]), deep=True)
    if not deep:
        raise HTTPException(404, "unreadable")
    deep.setdefault("provider", "claude-code")
    return deep


@app.get("/api/sessions/{session_id}/transcript.md")
def session_transcript_markdown(session_id: str, limit: int = 5000) -> Any:
    """Export a session as a markdown file the user can save / share.

    Title line uses the friendliest name available (userLabel →
    claudeTitle → first user message → sid). Metadata block follows.
    Each message rendered as `### user` / `### assistant` + ISO-8601
    timestamp + content verbatim. Served with a Content-Disposition
    header so browsers offer "save as" instead of rendering inline.
    """
    from datetime import datetime, timezone

    from starlette.responses import PlainTextResponse

    meta = _INDEX.get(session_id)
    if not meta:
        raise HTTPException(404, "not found")
    path = Path(meta["path"])
    title = (
        _get_user_label(session_id)
        or meta.get("claudeTitle")
        or meta.get("title")
        or f"Session {session_id[:8]}"
    )
    lines: list[str] = [
        f"# {title}",
        "",
        f"- **Session ID**: `{session_id}`",
    ]
    if meta.get("cwd"):
        lines.append(f"- **cwd**: `{meta['cwd']}`")
    if meta.get("branch") and meta["branch"] != "-":
        lines.append(f"- **branch**: `{meta['branch']}`")
    if meta.get("model"):
        lines.append(f"- **model**: `{meta['model']}`")
    if meta.get("createdAt"):
        try:
            lines.append(
                f"- **created**: {datetime.fromtimestamp(meta['createdAt'] / 1000, tz=timezone.utc).isoformat()}"
            )
        except (OSError, ValueError):
            pass
    lines.append("")
    lines.append("---")
    lines.append("")

    msg_count = 0
    for obj in _iter_lines(path):
        t = obj.get("type")
        if t not in ("user", "assistant"):
            continue
        if _is_meta(obj):
            continue
        msg = obj.get("message") or {}
        text = _extract_text(msg.get("content"))
        if not text:
            continue
        ts_iso = ""
        ts_raw = obj.get("timestamp")
        if ts_raw:
            try:
                ts_iso = datetime.fromisoformat(ts_raw.replace("Z", "+00:00")).isoformat()
            except (OSError, ValueError):
                pass
        lines.append(f"### {t}")
        if ts_iso:
            lines.append(f"*{ts_iso}*")
        lines.append("")
        lines.append(text)
        lines.append("")
        msg_count += 1
        if msg_count >= limit:
            break

    body = "\n".join(lines)
    filename = f"session-{session_id[:8]}.md"
    return PlainTextResponse(
        body,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/sessions/{session_id}/transcript")
def session_transcript(session_id: str, limit: int = 400) -> dict[str, Any]:
    meta = _INDEX.get(session_id)
    if not meta:
        raise HTTPException(404, "not found")
    path = Path(meta["path"])
    msgs: list[dict] = []
    for obj in _iter_lines(path):
        t = obj.get("type")
        if t not in ("user", "assistant"):
            continue
        if _is_meta(obj):
            continue
        msg = obj.get("message") or {}
        text = _extract_text(msg.get("content"))
        if not text:
            continue
        ts_raw = obj.get("timestamp")
        ts = int(time.time() * 1000)
        if ts_raw:
            try:
                from datetime import datetime

                ts = int(datetime.fromisoformat(ts_raw.replace("Z", "+00:00")).timestamp() * 1000)
            except Exception:
                pass
        msgs.append({"role": t, "content": text, "ts": ts})
        if len(msgs) >= limit:
            break
    return {"id": session_id, "messages": msgs}


def _find_window_for_pid(pid: int) -> int | None:
    """Walk up the process tree to find an ancestor with a visible top-level
    window, and return its HWND. Returns None if nothing focusable found."""
    if not IS_WINDOWS:
        return None
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32  # type: ignore[attr-defined,unused-ignore]
    EnumWindows = user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)  # type: ignore[attr-defined,unused-ignore]
    GetWindowThreadProcessId = user32.GetWindowThreadProcessId
    IsWindowVisible = user32.IsWindowVisible

    try:
        proc = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return None

    # collect candidate pids: the pid + its ancestors
    pids: list[int] = [pid]
    cur = proc
    for _ in range(8):
        try:
            parent = cur.parent()
        except psutil.Error:
            break
        if not parent:
            break
        pids.append(parent.pid)
        cur = parent

    # Windows Terminal runs sessions in WindowsTerminal.exe; also collect its siblings
    for p in list(pids):
        try:
            for child in psutil.Process(p).children(recursive=False):
                if child.pid not in pids:
                    pids.append(child.pid)
        except psutil.Error:
            continue

    pid_set = set(pids)
    found: list[int] = []

    def cb(hwnd: int, _lparam: int) -> bool:
        if not IsWindowVisible(hwnd):
            return True
        wpid = wintypes.DWORD()
        GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
        if wpid.value in pid_set:
            found.append(int(hwnd))
        return True

    EnumWindows(EnumWindowsProc(cb), 0)
    return found[0] if found else None


def _focus_hwnd(hwnd: int) -> bool:
    """Reliably bring a window to the foreground on Windows.

    Windows restricts SetForegroundWindow so we use the classic AttachThreadInput
    workaround plus a simulated ALT keypress (tricks the OS into allowing the
    switch) and a minimize/restore if the window is iconic.
    """
    if not IS_WINDOWS:
        return False
    import ctypes

    user32 = ctypes.windll.user32  # type: ignore[attr-defined,unused-ignore]
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined,unused-ignore]
    SW_RESTORE = 9

    # Restore if minimized
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, SW_RESTORE)

    # Synthetic ALT keypress — unlocks SetForegroundWindow restrictions
    VK_MENU = 0x12
    KEYEVENTF_KEYUP = 2
    user32.keybd_event(VK_MENU, 0, 0, 0)
    user32.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)

    # AttachThreadInput to share input state with the current foreground window
    fg = user32.GetForegroundWindow()
    fg_tid = user32.GetWindowThreadProcessId(fg, None) if fg else 0
    my_tid = kernel32.GetCurrentThreadId()
    target_tid = user32.GetWindowThreadProcessId(hwnd, None)

    # Unlock foreground (in case some app called LockSetForegroundWindow)
    try:
        user32.LockSetForegroundWindow(2)  # LSFW_UNLOCK
    except Exception:
        pass

    attached = []
    ok = False
    try:
        if fg_tid and fg_tid != my_tid:
            if user32.AttachThreadInput(my_tid, fg_tid, True):
                attached.append(fg_tid)
        if target_tid and target_tid != my_tid and target_tid != fg_tid:
            if user32.AttachThreadInput(my_tid, target_tid, True):
                attached.append(target_tid)
        user32.BringWindowToTop(hwnd)
        user32.ShowWindow(hwnd, SW_RESTORE)
        user32.SetFocus(hwnd)
        ok = bool(user32.SetForegroundWindow(hwnd))
    finally:
        for tid in attached:
            user32.AttachThreadInput(my_tid, tid, False)

    # Fallback: SwitchToThisWindow is undocumented but reliably brings a
    # window to the foreground regardless of foreground restrictions.
    if not ok:
        try:
            user32.SwitchToThisWindow(hwnd, True)
            ok = True
        except Exception:
            pass

    # Another fallback: minimize + restore forces the window to the front.
    if not ok:
        try:
            user32.ShowWindow(hwnd, 6)  # SW_MINIMIZE
            user32.ShowWindow(hwnd, SW_RESTORE)
            ok = True
        except Exception:
            pass

    return ok


class FocusReq(BaseModel):
    sessionId: str


# Windows Terminal window name used for all viewer-opened tabs, so we can
# target it reliably with `wt -w <name> focus-tab --target <idx>`.
WT_WINDOW = "claude-sessions"

# In-memory tracking of tabs we opened via /api/open.
# sessionId -> tab index within WT_WINDOW.
_tab_indices: dict[str, int] = {}
_next_tab_index: int = 0


# ─────────────────────── UI Automation (per-tab focus) ───────────────────────
def _uia_select_tab(session_id: str) -> dict:
    """Use UI Automation to find and select the WT tab whose title is `cc-<sid>`.

    This relies on the SessionStart hook having run for that session (which
    stamps the tab title via OSC-0). Falls back gracefully if UIA isn't
    available or no matching tab is found.
    """
    if not IS_WINDOWS:
        return {"ok": False, "error": "uiautomation is Windows-only"}
    try:
        import uiautomation as auto
    except Exception as e:
        return {"ok": False, "error": f"uiautomation unavailable: {e}"}

    # The hook stamps titles as either "cc-<sid8>" or "<label> · <sid8>".
    # Match on the 8-char prefix which is stable across both forms.
    sid8 = session_id[:8]

    def _matches(name: str) -> bool:
        return bool(name) and sid8 in name

    desktop = auto.GetRootControl()
    # Enumerate all top-level Windows Terminal windows.
    try:
        wt_windows = desktop.GetChildren()
    except Exception as e:
        return {"ok": False, "error": f"GetChildren failed: {e}"}

    for win in wt_windows:
        try:
            if win.ClassName != "CASCADIA_HOSTING_WINDOW_CLASS":
                continue
        except Exception:
            continue
        # Enumerate descendants looking for any TabItem with matching Name.
        matched_tab = None

        def _walk(el: Any, depth: int = 0) -> None:
            nonlocal matched_tab
            if matched_tab or depth > 10:
                return
            try:
                for c in el.GetChildren():
                    if matched_tab:
                        return  # type: ignore[unreachable]
                    try:
                        if c.ControlTypeName == "TabItemControl" and _matches(c.Name):
                            matched_tab = c
                            return
                    except Exception:
                        pass
                    _walk(c, depth + 1)
            except Exception:
                pass

        _walk(win)
        if matched_tab is None:
            continue
        tab = matched_tab
        # Select the tab (switches to it) and raise the window.
        try:
            tab.GetSelectionItemPattern().Select()
        except Exception:
            try:
                tab.Click(simulateMove=False)
            except Exception:
                pass
        try:
            win.SetActive()  # type: ignore[attr-defined]
        except Exception:
            pass
        hwnd = getattr(win, "NativeWindowHandle", None)
        return {"ok": True, "hwnd": int(hwnd) if hwnd else None, "windowTitle": win.Name, "tabName": tab.Name}

    return {"ok": False, "error": "no matching tab"}


@app.post("/api/focus")
def focus_session(req: FocusReq) -> dict[str, Any]:
    # find the pid whose session matches
    target_pid: int | None = None
    if ACTIVE_DIR.is_dir():
        for f in ACTIVE_DIR.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                if data.get("sessionId") == req.sessionId:
                    target_pid = int(data.get("pid"))
                    break
            except Exception:
                continue

    focus_methods = []

    # Strategy 0 (primary): UI Automation finds the tab by its OSC-0 title
    # stamped by the SessionStart hook. This is the only method that can
    # switch to the *specific* tab for externally-started sessions.
    uia = _uia_select_tab(req.sessionId)
    if uia.get("ok"):
        focus_methods.append("uia:select-tab-by-name")
        return {
            "ok": True,
            "pid": None,
            "hwnd": uia.get("hwnd"),
            "tabIndex": None,
            "focusedTab": True,
            "appActivate": False,
            "ctypes": False,
            "uia": True,
            "methods": focus_methods,
        }

    # Strategy 1: wt.exe focus-tab by tracked index (for tabs opened via viewer).
    tab_idx = _tab_indices.get(req.sessionId)
    focused_tab = False

    if tab_idx is not None:
        try:
            subprocess.run(
                ["wt.exe", "-w", WT_WINDOW, "focus-tab", "--target", str(tab_idx)],
                check=False,
                timeout=3,
            )
            focused_tab = True
            focus_methods.append(f"wt:{WT_WINDOW}:tab{tab_idx}")
        except Exception:
            pass
    else:
        # Untracked session — raise whatever WT window exists.
        try:
            subprocess.run(
                ["wt.exe", "--window", "0", "focus-tab"],
                check=False,
                timeout=3,
            )
            focused_tab = True
            focus_methods.append("wt:0:current-tab")
        except Exception:
            pass

    hwnd = None
    if target_pid and psutil.pid_exists(target_pid):
        hwnd = _find_window_for_pid(target_pid)
    if hwnd is None:
        hwnd = _find_wt_window()

    # AppActivate via PowerShell — succeeds more often than raw ctypes because
    # PowerShell/WScript sends a synthetic input event first.
    ps_ok = False
    if target_pid:
        try:
            r = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-WindowStyle",
                    "Hidden",
                    "-Command",
                    f"$r = (New-Object -ComObject WScript.Shell).AppActivate({target_pid}); "
                    f"if (-not $r) {{ exit 1 }}",
                ],
                check=False,
                timeout=3,
            )
            ps_ok = r.returncode == 0
            if ps_ok:
                focus_methods.append("powershell:AppActivate")
        except Exception:
            pass

    # Last-resort ctypes sequence
    ct_ok = False
    if hwnd:
        ct_ok = _focus_hwnd(hwnd)
        if ct_ok:
            focus_methods.append("ctypes:SwitchToThisWindow")

    if hwnd is None and not focused_tab and not ps_ok and not ct_ok:
        raise HTTPException(404, "no window found")

    ok = focused_tab or ps_ok or ct_ok
    return {
        "ok": ok,
        "pid": target_pid,
        "hwnd": hwnd,
        "tabIndex": tab_idx,
        "focusedTab": focused_tab,
        "appActivate": ps_ok,
        "ctypes": ct_ok,
        "uia": False,
        "uiaError": uia.get("error"),
        "methods": focus_methods,
    }


# ─────────────────────── Hook install/status ───────────────────────
def _load_settings() -> dict:
    if not SETTINGS_FILE.exists():
        return {}
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_settings(data: dict) -> None:
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


HOOK_MARKER = "claude-sessions-viewer/session_start"


def _hook_command() -> str:
    # Use the project's venv python so we don't depend on a specific system Python.
    vpy = PROJECT_ROOT / ".venv" / "Scripts" / "python.exe"
    py = str(vpy) if vpy.exists() else "python"
    return f'"{py}" "{HOOK_SCRIPT}"'


@app.get("/api/hook/status")
def hook_status() -> dict[str, Any]:
    data = _load_settings()
    hooks = (data.get("hooks") or {}).get("SessionStart") or []
    installed = any(h.get("__mark") == HOOK_MARKER for h in hooks if isinstance(h, dict))
    return {
        "installed": installed,
        "settingsFile": str(SETTINGS_FILE),
        "hookScript": str(HOOK_SCRIPT),
        "command": _hook_command(),
    }


@app.post("/api/hook/install")
def hook_install() -> dict[str, Any]:
    if not HOOK_SCRIPT.exists():
        raise HTTPException(500, f"hook script missing at {HOOK_SCRIPT}")
    data = _load_settings()
    hooks_cfg = data.setdefault("hooks", {})
    entry = {
        "__mark": HOOK_MARKER,
        "matcher": "*",
        "hooks": [{"type": "command", "command": _hook_command()}],
    }
    for event in ("SessionStart", "UserPromptSubmit"):
        arr = hooks_cfg.setdefault(event, [])
        arr[:] = [h for h in arr if not (isinstance(h, dict) and h.get("__mark") == HOOK_MARKER)]
        arr.append(entry)
    _save_settings(data)
    return {"ok": True, "installed": True, "settingsFile": str(SETTINGS_FILE)}


@app.post("/api/hook/uninstall")
def hook_uninstall() -> dict[str, Any]:
    data = _load_settings()
    hooks_cfg = data.get("hooks") or {}
    changed = False
    for event in ("SessionStart", "UserPromptSubmit"):
        arr = hooks_cfg.get(event) or []
        new_arr = [h for h in arr if not (isinstance(h, dict) and h.get("__mark") == HOOK_MARKER)]
        if new_arr != arr:
            changed = True
            if new_arr:
                hooks_cfg[event] = new_arr
            else:
                hooks_cfg.pop(event, None)
    if changed:
        if not hooks_cfg:
            data.pop("hooks", None)
        _save_settings(data)
    return {"ok": True, "installed": False}


def _find_wt_window() -> int | None:
    if not IS_WINDOWS:
        return None
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32  # type: ignore[attr-defined,unused-ignore]
    EnumWindows = user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)  # type: ignore[attr-defined,unused-ignore]
    GetWindowThreadProcessId = user32.GetWindowThreadProcessId
    IsWindowVisible = user32.IsWindowVisible

    found: list[int] = []

    def cb(hwnd: int, _lparam: int) -> bool:
        if not IsWindowVisible(hwnd):
            return True
        wpid = wintypes.DWORD()
        GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
        try:
            if psutil.Process(wpid.value).name().lower() == "windowsterminal.exe":
                found.append(int(hwnd))
                return False
        except psutil.Error:
            pass
        return True

    EnumWindows(EnumWindowsProc(cb), 0)
    return found[0] if found else None


@app.post("/api/open")
def open_session(req: OpenReq) -> dict[str, Any]:
    global _next_tab_index
    meta = _INDEX.get(req.sessionId)
    if not meta:
        raise HTTPException(404, "not found")
    if not IS_WINDOWS:
        raise HTTPException(501, "open/new-tab is only supported on Windows")

    # Defense-in-depth: reconstruct every subprocess argument from a whitelist
    # so CodeQL's taint tracker sees clean, non-user-controlled strings. Raw
    # req.sessionId / meta["cwd"] never reach argv.
    m = _UUID_RE.match(req.sessionId)
    if m is None:
        raise HTTPException(400, "sessionId must be a UUID")
    sid: str = m.group(0)  # regex-validated, fresh string

    if req.mode not in ("tab", "split"):
        raise HTTPException(400, "mode must be 'tab' or 'split'")
    sub: str = "sp" if req.mode == "split" else "nt"  # enum-validated

    cwd_raw = meta.get("cwd")
    if not isinstance(cwd_raw, str) or not cwd_raw:
        raise HTTPException(500, "session metadata has no cwd")
    try:
        cwd: str = str(Path(cwd_raw).resolve(strict=False))  # pathlib-canonicalized
    except (OSError, ValueError) as e:
        raise HTTPException(500, f"invalid cwd in session metadata: {e}") from e

    title: str = f"claude:{sid[:8]}"  # derived from regex-clean sid
    # wt.exe -w <named-window> {nt|sp} -d <cwd> --title <t> claude --resume <uuid>
    cmd = [
        "wt.exe",
        "-w",
        WT_WINDOW,
        sub,
        "-d",
        cwd,
        "--title",
        title,
        "claude",
        "--resume",
        sid,
    ]
    try:
        subprocess.Popen(cmd, shell=False)
    except FileNotFoundError as e:
        # Windows Terminal not installed — fail loudly instead of falling
        # back to a cmd.exe invocation that would interpret cwd/sid as shell.
        raise HTTPException(
            503, "Windows Terminal (wt.exe) not found on PATH — install it to open sessions"
        ) from e
    # Only "new tab" gets its own tab index; split panes share the current tab.
    if sub == "nt":
        _tab_indices[sid] = _next_tab_index
        _next_tab_index += 1
    return {"ok": True, "cmd": " ".join(cmd), "tabIndex": _tab_indices.get(sid)}


# ─────────────────────── SSE live updates ───────────────────────
_event_queue: asyncio.Queue[dict[str, Any]] | None = None
_event_loop: asyncio.AbstractEventLoop | None = None


def _emit_sse(event: dict[str, Any]) -> None:
    """Enqueue an SSE event for /api/stream subscribers; silent if no loop."""
    if _event_queue is None or _event_loop is None:
        return
    try:
        _event_loop.call_soon_threadsafe(_event_queue.put_nowait, event)
    except RuntimeError:
        # Event loop closed (shutdown) — drop the event rather than crash the watcher.
        pass


class _Watcher(FileSystemEventHandler):
    """Reconciles ~/.claude/projects with _INDEX in near-real-time.

    Handles all four file-lifecycle transitions so the in-memory index never
    drifts from disk:
      created/modified → upsert into _INDEX, emit session_created/session_updated
      deleted          → evict from _INDEX, emit session_deleted
      moved/renamed    → evict source (if indexable), then upsert destination
                         (if indexable). A rename that only changes the case
                         on Windows is a no-op evict+insert of the same id.
    """

    def _upsert(self, path_str: str) -> None:
        p = Path(path_str)
        if not _is_indexable_session_path(p):
            return
        meta = _scan_session_meta(p, deep=False)
        if not meta:
            return
        try:
            meta["_mtime"] = p.stat().st_mtime
        except OSError:
            return
        is_new = meta["id"] not in _INDEX
        _INDEX[meta["id"]] = meta
        # Cross-check PID state so the SSE event carries the correct
        # active flag (otherwise frontend state drifts to inactive).
        active_ids = _get_active_session_ids()
        out = {k: v for k, v in meta.items() if not k.startswith("_")}
        if out["id"] in active_ids:
            out["active"] = True
            out["activityLabel"] = _activity_for(p)
        _emit_sse({"type": "session_created" if is_new else "session_updated", "session": out})

    def _evict(self, path_str: str) -> None:
        p = Path(path_str)
        # For deletes we can't always use the path filter (the file is already
        # gone, so `p.stat()` would fail) — but the filter only reads from the
        # path itself, which is still intact.
        if not _is_indexable_session_path(p):
            return
        sid = p.stem
        if sid not in _INDEX:
            return
        del _INDEX[sid]
        _emit_sse({"type": "session_deleted", "id": sid})

    def on_created(self, event: Any) -> None:
        if not event.is_directory:
            self._upsert(event.src_path)

    def on_modified(self, event: Any) -> None:
        if not event.is_directory:
            self._upsert(event.src_path)

    def on_deleted(self, event: Any) -> None:
        if event.is_directory:
            # A whole project folder was deleted — evict every indexed session
            # underneath it in one pass so the UI doesn't have to wait for N
            # individual file-delete events (watchdog may not fire them for
            # bulk rm on some platforms).
            parent = Path(event.src_path)
            to_evict = [
                sid for sid, meta in _INDEX.items() if Path(meta.get("path", "")).is_relative_to(parent)
            ]
            for sid in to_evict:
                del _INDEX[sid]
                _emit_sse({"type": "session_deleted", "id": sid})
            return
        self._evict(event.src_path)

    def on_moved(self, event: Any) -> None:
        if event.is_directory:
            return
        # A rename is equivalent to delete(src) + create(dest). Handle both so
        # the UI shows the move atomically.
        self._evict(event.src_path)
        self._upsert(event.dest_path)


_observer: Any = None  # watchdog.observers.Observer has no importable type alias


def start_watcher() -> None:
    global _observer
    if _observer or not PROJECTS_DIR.is_dir():
        return
    obs = Observer()
    obs.schedule(_Watcher(), str(PROJECTS_DIR), recursive=True)
    obs.daemon = True
    obs.start()
    _observer = obs


# ─────────────────────── Embedded terminal (PTY over WebSocket) ────────
_pty_manager = PtySessionManager()


@app.websocket("/api/pty/ws")
async def pty_websocket(websocket: WebSocket) -> None:
    """Bidirectional terminal bridge.

    Client sends (JSON text frames):
        {"type": "spawn", "cmd": ["cmd.exe"], "cols": 120, "rows": 30,
         "cwd": "C:/Users/you", "provider": "claude-code",
         "sessionId": "<uuid>"}
        {"type": "input",  "data": "<text>"}
        {"type": "resize", "cols": 120, "rows": 30}

    Server sends:
        {"type": "ready",  "id": "<pty-session-id>"}
        {"type": "output", "data": "<bytes decoded utf-8>"}
        {"type": "exit",   "code": <int|null>}
        {"type": "error",  "message": "<str>"}

    The first message from the client must be "spawn" — anything else
    closes the socket. We only allow cmd resolution through a provider's
    `resume_command(sid)` or, for ad-hoc tabs, a small whitelist
    (`cmd.exe`, `powershell.exe`, `bash`) — never a free-form user string
    as argv[0].
    """
    await websocket.accept()
    session: PtySession | None = None
    reattached = False  # True when we hooked onto a pre-existing PTY
    loop = asyncio.get_running_loop()
    try:
        first = await websocket.receive_json()
        if first.get("type") != "spawn":
            await websocket.send_json({"type": "error", "message": "first message must be type=spawn"})
            await websocket.close()
            return

        # ─── ADR-18 Phase 5: reattach-by-id ─────────────────────────
        # If the client sends `{"type":"spawn","ptyId":"<id>"}`, try to
        # hook onto that existing PTY instead of spawning a new one.
        # Used by the UI on WS reconnect after a restart — the daemon
        # kept the PTY alive and has a ring buffer we can replay.
        reattach_id = first.get("ptyId")
        if isinstance(reattach_id, str) and reattach_id:
            existing = _pty_manager.get(reattach_id)
            if existing is None:
                await websocket.send_json({"type": "error", "message": f"ptyId {reattach_id!r} not found"})
                await websocket.close()
                return
            session = existing
            reattached = True
            # Replay the ring buffer as a single batched frame BEFORE we
            # rewire the live callback — otherwise late chunks during
            # rewire may leapfrog the replay.
            replay = session.ring_buffer.read_all().decode("utf-8", errors="replace")
            if replay:
                await websocket.send_json({"type": "output", "data": replay, "replay": True})
            bridge_pty_to_websocket(session, websocket.send_json, loop)
            await websocket.send_json({"type": "ready", "id": session.id, "reattached": True})
            # Skip the spawn branch below — jump to the input/resize loop.

        try:
            cmd = _resolve_pty_command(first) if not reattached else []
        except ValueError as e:
            # Rejected by the whitelist / unknown provider — tell the client,
            # then close. Dropping silently would leave the JS receive loop
            # blocked forever.
            await websocket.send_json({"type": "error", "message": str(e)})
            await websocket.close()
            return

        if not reattached:
            cols = int(first.get("cols", 80))
            rows = int(first.get("rows", 24))

            # cwd comes from the session row (for resume spawns) or nothing (for
            # ad-hoc shells). Pin down a safe value:
            #   1. If the client passed a cwd that exists as a directory, use it.
            #   2. If it passed a cwd that no longer exists (project was moved /
            #      deleted), fall back to the user's home directory rather than
            #      let pywinpty fail mid-spawn with a cryptic error.
            #   3. If nothing was passed, pywinpty inherits this process's cwd.
            cwd_raw = first.get("cwd")
            cwd: str | None = None
            if isinstance(cwd_raw, str) and cwd_raw:
                try:
                    cwd_path = Path(cwd_raw).resolve(strict=False)
                    if cwd_path.is_dir():
                        cwd = str(cwd_path)
                    else:
                        cwd = str(Path.home())
                except (OSError, ValueError):
                    cwd = str(Path.home())

            session = PtySession(cmd=cmd, cols=cols, rows=rows, cwd=cwd)
            # Wire output/exit BEFORE starting the PTY — the first chunk (ConPTY
            # init escapes) can arrive within microseconds; assigning callbacks
            # post-spawn would race and drop that frame.
            bridge_pty_to_websocket(session, websocket.send_json, loop)
            try:
                session.spawn()
            except Exception as e:  # noqa: BLE001 — report to client and close
                await websocket.send_json({"type": "error", "message": f"spawn failed: {e}"})
                await websocket.close()
                return

            _pty_manager.add(session)
            await websocket.send_json({"type": "ready", "id": session.id})

        # By here: either `session` was assigned in the reattach branch or in
        # the spawn-new branch. Either way it's non-None; cast for mypy.
        # (bandit B101 disallows `assert` — cast is the idiomatic narrowing.)
        from typing import cast

        session = cast(PtySession, session)
        while True:
            msg = await websocket.receive_json()
            t = msg.get("type")
            if t == "input":
                session.write(str(msg.get("data", "")))
            elif t == "resize":
                session.resize(int(msg.get("cols", 80)), int(msg.get("rows", 24)))
            else:
                # unknown message — ignore rather than tear down the socket
                continue
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        # Phase 5: when we reattached to an existing PTY, the PTY must
        # OUTLIVE this WS so a future client can reattach again. Only
        # spawn-new sessions get torn down on WS close.
        if session is not None and not reattached:
            _pty_manager.remove(session.id)
            session.close()


def _resolve_pty_command(spawn_msg: dict[str, Any]) -> list[str]:
    """Pick the argv to spawn, applying strict whitelisting.

    Routes:
      1. `{provider, sessionId}` → provider.resume_command(sid) → argv
      2. `{cmd: [...]}` where argv[0] is in `_PTY_ALLOWED_SHELLS`
    Anything else raises — we do NOT accept free-form user argv[0], which
    would turn the WebSocket into a shell-injection primitive.
    """
    prov = spawn_msg.get("provider")
    sid = spawn_msg.get("sessionId")
    if prov and sid:
        for p in _available_providers():
            if p.name == prov:
                return p.resume_command(str(sid))
        raise ValueError(f"unknown provider {prov!r}")

    cmd = spawn_msg.get("cmd")
    if isinstance(cmd, list) and cmd and cmd[0] in _PTY_ALLOWED_SHELLS:
        return [str(x) for x in cmd]
    raise ValueError("spawn message must name {provider, sessionId} or an allowed shell in cmd[0]")


# Keep tight — these are the only top-of-argv values the WebSocket accepts
# when not routing through a provider's resume_command. Explicitly NOT
# including `/bin/sh` etc. because our current users (Windows) won't hit
# them; add when we implement posix support.
_PTY_ALLOWED_SHELLS: set[str] = {"cmd.exe", "powershell.exe", "pwsh.exe", "bash.exe"}


@app.on_event("shutdown")
async def _shutdown() -> None:
    """Best-effort PTY cleanup so uvicorn reloads don't orphan child
    processes (matters mostly for dev — in production the OS reaps on
    parent death)."""
    _pty_manager.close_all()


# ─────────────────────── PTY REST surface (ADR-18 Phase 4) ───────────
# These endpoints let a caller create a PTY, write into it, and replay
# its ring buffer. They're the load-bearing surface for the rehydrate-
# on-reconnect behavior the Phase 1 daemon e2e tests assert. They sit
# alongside the WebSocket flow (WS is still how live output streams);
# these are for clients that need imperative control (tests, future UI
# rehydration helpers, tooling).


class PtyCreateRequest(BaseModel):
    cmd: list[str]
    cwd: str | None = None
    cols: int = 80
    rows: int = 24


class PtyCreateResponse(BaseModel):
    id: str


class PtyWriteRequest(BaseModel):
    data: str


@app.post("/api/pty")
def pty_create(req: PtyCreateRequest) -> PtyCreateResponse:
    """Spawn a PTY and register it with the manager. Returns the id
    callers use for subsequent /write and /replay calls.

    argv[0] whitelist is the same as the WebSocket spawn path — we
    refuse to accept arbitrary user strings as exec targets.
    """
    if not req.cmd or req.cmd[0] not in _PTY_ALLOWED_SHELLS:
        raise HTTPException(status_code=400, detail=f"cmd[0] must be one of {sorted(_PTY_ALLOWED_SHELLS)}")

    # Resolve cwd the same defensive way as the WS path: missing dir falls
    # back to $HOME so pywinpty doesn't explode on a stale layout entry.
    cwd: str | None = None
    if req.cwd:
        try:
            p = Path(req.cwd).resolve(strict=False)
            cwd = str(p) if p.is_dir() else str(Path.home())
        except (OSError, ValueError):
            cwd = str(Path.home())

    session = PtySession(cmd=list(req.cmd), cols=req.cols, rows=req.rows, cwd=cwd)
    try:
        session.spawn()
    except Exception as exc:  # noqa: BLE001 — spawn failures are user-legible
        raise HTTPException(status_code=500, detail=f"pty spawn failed: {exc}") from exc
    _pty_manager.add(session)
    return PtyCreateResponse(id=session.id)


@app.post("/api/pty/{pty_id}/write")
def pty_write(pty_id: str, req: PtyWriteRequest) -> dict[str, Any]:
    session = _pty_manager.get(pty_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"pty {pty_id!r} not found")
    written = session.write(req.data)
    return {"ok": True, "bytes": written}


@app.get("/api/pty/{pty_id}/replay")
def pty_replay(pty_id: str) -> Any:
    """Return the ring buffer's current contents as plain text. Callers
    use this right after (re)connecting to rehydrate scrollback before
    switching to live WS streaming."""
    from starlette.responses import PlainTextResponse

    session = _pty_manager.get(pty_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"pty {pty_id!r} not found")
    return PlainTextResponse(
        session.ring_buffer.read_all().decode("utf-8", errors="replace"),
        media_type="text/plain; charset=utf-8",
    )


@app.get("/api/stream")
async def stream_events() -> EventSourceResponse:
    global _event_queue, _event_loop
    if _event_queue is None:
        _event_queue = asyncio.Queue()
        _event_loop = asyncio.get_running_loop()

    async def gen() -> Any:
        yield {"event": "hello", "data": json.dumps({"ok": True})}
        while True:
            ev = await _event_queue.get()
            yield {"event": "session", "data": json.dumps(ev)}

    return EventSourceResponse(gen())


# ─────────────────────── static frontend ───────────────────────
# Mount at root so relative script src="utils.jsx" resolves.
# Must come AFTER all /api routes so they take precedence.
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
