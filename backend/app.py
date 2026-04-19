"""Claude Sessions Viewer — FastAPI backend.

Reads Claude Code JSONL sessions from ~/.claude/projects/**/*.jsonl and serves
them to the React frontend. Live updates via SSE + watchdog.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Iterator

import psutil
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

HOME = Path(os.path.expanduser("~"))
PROJECTS_DIR = HOME / ".claude" / "projects"
ACTIVE_DIR = HOME / ".claude" / "sessions"
SETTINGS_FILE = HOME / ".claude" / "settings.json"
LABELS_FILE = HOME / ".claude" / "viewer-labels.json"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
HOOK_SCRIPT = PROJECT_ROOT / "hooks" / "session_start.py"

import threading  # noqa: E402
_LABELS_LOCK = threading.Lock()


def _load_labels() -> dict:
    try:
        return json.loads(LABELS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_labels(d: dict) -> None:
    with _LABELS_LOCK:
        LABELS_FILE.parent.mkdir(parents=True, exist_ok=True)
        LABELS_FILE.write_text(json.dumps(d, indent=2), encoding="utf-8")


def _get_user_label(sid: str) -> str | None:
    e = _load_labels().get(sid)
    return e.get("userLabel") if isinstance(e, dict) else None


def _set_user_label(sid: str, label: str | None) -> None:
    d = _load_labels()
    entry = d.get(sid) if isinstance(d.get(sid), dict) else {}
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

app = FastAPI(title="Claude Sessions Viewer")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


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


def _is_meta(line_obj: dict) -> bool:
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


def _iter_lines(path: Path) -> Iterator[dict]:
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


def _scan_session_meta(path: Path, deep: bool = False) -> dict | None:
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

    return {
        "id": session_id,
        "title": title,
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
def _get_active_session_ids() -> set[str]:
    active: set[str] = set()
    if not ACTIVE_DIR.is_dir():
        return active
    for f in ACTIVE_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            pid = data.get("pid")
            sid = data.get("sessionId")
            if pid and sid and psutil.pid_exists(int(pid)):
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
_INDEX: dict[str, dict] = {}
_INDEX_BUILT = False
_INDEX_PROGRESS = {"done": 0, "total": 0, "phase": "idle"}


_UUID_RE = __import__("re").compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


def _all_jsonl() -> list[Path]:
    """Top-level session files only.

    Claude Code top-level sessions live directly under ~/.claude/projects/<encoded>/<uuid>.jsonl.
    Sub-agent sessions live under <uuid>/subagents/agent-*.jsonl and are NOT
    resumable via `claude --resume`, so we exclude them.
    """
    if not PROJECTS_DIR.is_dir():
        return []
    out: list[Path] = []
    for p in PROJECTS_DIR.rglob("*.jsonl"):
        parts = p.parts
        # Exclude anything inside a subagents/ directory.
        if "subagents" in parts:
            continue
        # Exclude files whose name isn't a UUID (e.g. agent-*.jsonl).
        if not _UUID_RE.match(p.stem):
            continue
        # Must be direct child of the <encoded-project> dir.
        # i.e. path == PROJECTS_DIR / <project> / <uuid>.jsonl
        try:
            rel = p.relative_to(PROJECTS_DIR)
        except ValueError:
            continue
        if len(rel.parts) != 2:
            continue
        out.append(p)
    return out


def build_index() -> None:
    global _INDEX_BUILT
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
def status():
    return {
        "ready": _INDEX_BUILT,
        "done": _INDEX_PROGRESS["done"],
        "total": _INDEX_PROGRESS["total"],
        "phase": _INDEX_PROGRESS["phase"],
    }


# ─────────────────────── API ───────────────────────
class OpenReq(BaseModel):
    sessionId: str
    mode: str  # "tab" | "split"


@app.on_event("startup")
async def _startup() -> None:
    # initial scan in background so server starts fast
    asyncio.create_task(asyncio.to_thread(build_index))
    start_watcher()


@app.get("/api/sessions")
def list_sessions(limit: int = 1000, offset: int = 0):
    if not _INDEX_BUILT:
        build_index()
    active_ids = _get_active_session_ids()
    labels = _load_labels()
    items = []
    for meta in _INDEX.values():
        m = {k: v for k, v in meta.items() if not k.startswith("_")}
        if m["id"] in active_ids:
            m["active"] = True
            m["activityLabel"] = _activity_for(Path(meta["path"]))
        entry = labels.get(m["id"]) if isinstance(labels.get(m["id"]), dict) else {}
        m["userLabel"] = entry.get("userLabel") if entry else None
        items.append(m)
    items.sort(key=lambda s: s["lastActive"], reverse=True)
    return {
        "total": len(items),
        "items": items[offset : offset + limit],
    }


@app.get("/api/sessions/{sid}/label")
def get_session_label(sid: str):
    return {"id": sid, "userLabel": _get_user_label(sid)}


class UserLabelReq(BaseModel):
    userLabel: str | None = None


@app.put("/api/sessions/{sid}/label")
def set_session_user_label(sid: str, req: UserLabelReq):
    _set_user_label(sid, req.userLabel)
    return {"id": sid, "userLabel": _get_user_label(sid)}


@app.get("/api/sessions/{session_id}/preview")
def session_preview(session_id: str):
    meta = _INDEX.get(session_id)
    if not meta:
        raise HTTPException(404, "not found")
    deep = _scan_session_meta(Path(meta["path"]), deep=True)
    if not deep:
        raise HTTPException(404, "unreadable")
    return deep


@app.get("/api/sessions/{session_id}/transcript")
def session_transcript(session_id: str, limit: int = 400):
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
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    EnumWindows = user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
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

    def cb(hwnd, _lparam):
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
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
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
        def _walk(el, depth=0):
            nonlocal matched_tab
            if matched_tab or depth > 10:
                return
            try:
                for c in el.GetChildren():
                    if matched_tab:
                        return
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
            win.SetActive()
        except Exception:
            pass
        hwnd = getattr(win, "NativeWindowHandle", None)
        return {"ok": True, "hwnd": int(hwnd) if hwnd else None,
                "windowTitle": win.Name, "tabName": tab.Name}

    return {"ok": False, "error": "no matching tab"}


@app.post("/api/focus")
def focus_session(req: FocusReq):
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
        return {"ok": True, "pid": None, "hwnd": uia.get("hwnd"),
                "tabIndex": None, "focusedTab": True,
                "appActivate": False, "ctypes": False,
                "uia": True, "methods": focus_methods}

    # Strategy 1: wt.exe focus-tab by tracked index (for tabs opened via viewer).
    tab_idx = _tab_indices.get(req.sessionId)
    focused_tab = False

    if tab_idx is not None:
        try:
            subprocess.run(
                ["wt.exe", "-w", WT_WINDOW, "focus-tab", "--target", str(tab_idx)],
                check=False, timeout=3,
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
                check=False, timeout=3,
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
                    "powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command",
                    f"$r = (New-Object -ComObject WScript.Shell).AppActivate({target_pid}); "
                    f"if (-not $r) {{ exit 1 }}",
                ],
                check=False, timeout=3,
            )
            ps_ok = (r.returncode == 0)
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
        "ok": ok, "pid": target_pid, "hwnd": hwnd,
        "tabIndex": tab_idx, "focusedTab": focused_tab,
        "appActivate": ps_ok, "ctypes": ct_ok,
        "uia": False, "uiaError": uia.get("error"),
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
def hook_status():
    data = _load_settings()
    hooks = (data.get("hooks") or {}).get("SessionStart") or []
    installed = any(h.get("__mark") == HOOK_MARKER for h in hooks if isinstance(h, dict))
    return {"installed": installed, "settingsFile": str(SETTINGS_FILE),
            "hookScript": str(HOOK_SCRIPT), "command": _hook_command()}


@app.post("/api/hook/install")
def hook_install():
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
def hook_uninstall():
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
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    EnumWindows = user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    GetWindowThreadProcessId = user32.GetWindowThreadProcessId
    IsWindowVisible = user32.IsWindowVisible

    found: list[int] = []

    def cb(hwnd, _lparam):
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
def open_session(req: OpenReq):
    global _next_tab_index
    meta = _INDEX.get(req.sessionId)
    if not meta:
        raise HTTPException(404, "not found")
    cwd = meta["cwd"]
    sid = req.sessionId
    sub = "sp" if req.mode == "split" else "nt"
    title = f"claude:{sid[:8]}"
    # wt.exe -w <named-window> {nt|sp} -d <cwd> --title <t> claude --resume <uuid>
    cmd = [
        "wt.exe", "-w", WT_WINDOW, sub,
        "-d", cwd, "--title", title,
        "claude", "--resume", sid,
    ]
    try:
        subprocess.Popen(cmd, shell=False)
        # Only "new tab" gets its own tab index; split panes share the current tab.
        if sub == "nt":
            _tab_indices[sid] = _next_tab_index
            _next_tab_index += 1
    except FileNotFoundError:
        subprocess.Popen(
            ["cmd.exe", "/c", "start", "cmd", "/k", f"cd /d {cwd} && claude --resume {sid}"],
            shell=False,
        )
    return {"ok": True, "cmd": " ".join(cmd),
            "tabIndex": _tab_indices.get(sid)}


# ─────────────────────── SSE live updates ───────────────────────
_event_queue: asyncio.Queue | None = None
_event_loop: asyncio.AbstractEventLoop | None = None


class _Watcher(FileSystemEventHandler):
    def _push(self, path_str: str, kind: str) -> None:
        p = Path(path_str)
        if p.suffix != ".jsonl":
            return
        # Apply the same filtering as _all_jsonl (exclude sub-agents etc.)
        if "subagents" in p.parts or not _UUID_RE.match(p.stem):
            return
        try:
            rel = p.relative_to(PROJECTS_DIR)
        except ValueError:
            return
        if len(rel.parts) != 2:
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
        if _event_queue is not None and _event_loop is not None:
            # Cross-check PID state so the SSE event carries the correct
            # active flag (otherwise frontend state drifts to inactive).
            active_ids = _get_active_session_ids()
            out = {k: v for k, v in meta.items() if not k.startswith("_")}
            if out["id"] in active_ids:
                out["active"] = True
                out["activityLabel"] = _activity_for(p)
            ev = {"type": "session_created" if is_new else "session_updated", "session": out}
            try:
                _event_loop.call_soon_threadsafe(_event_queue.put_nowait, ev)
            except RuntimeError:
                pass

    def on_created(self, event):
        if not event.is_directory:
            self._push(event.src_path, "created")

    def on_modified(self, event):
        if not event.is_directory:
            self._push(event.src_path, "modified")


_observer: Observer | None = None


def start_watcher() -> None:
    global _observer
    if _observer or not PROJECTS_DIR.is_dir():
        return
    obs = Observer()
    obs.schedule(_Watcher(), str(PROJECTS_DIR), recursive=True)
    obs.daemon = True
    obs.start()
    _observer = obs


@app.get("/api/stream")
async def stream_events():
    global _event_queue, _event_loop
    if _event_queue is None:
        _event_queue = asyncio.Queue()
        _event_loop = asyncio.get_running_loop()

    async def gen():
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
