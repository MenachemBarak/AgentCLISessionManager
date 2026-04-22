"""Claude Code adapter.

Reads sessions from `~/.claude/projects/**/*.jsonl` (one JSONL file per
session), detects active sessions via `~/.claude/sessions/<pid>.json`, and
watches the projects dir with `watchdog` for live updates.

This is the first and only concrete `SessionProvider` — the abstraction in
`backend/providers/base.py` was designed around its contract. Codex and
friends will be added in later PRs.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

import psutil
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from backend.providers.base import (
    Message,
    Preview,
    SessionMeta,
    WatcherCallback,
)

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


# ─────────────────────── generic JSONL helpers ───────────────────────
def _extract_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
        return "\n".join(parts).strip()
    return ""


def _is_meta(line_obj: dict[str, Any]) -> bool:
    if line_obj.get("isMeta"):
        return True
    msg = line_obj.get("message") or {}
    text = _extract_text(msg.get("content"))
    if not text:
        return True
    # system-injected caveats from Claude Code itself — treat as meta
    return text.startswith("<local-command") or text.startswith("<command-") or text.startswith("Caveat:")


def _iter_lines(path: Path) -> Iterator[dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                s = line.strip()
                if not s:
                    continue
                try:
                    yield json.loads(s)
                except json.JSONDecodeError:
                    continue
    except OSError:
        return


def _scan_tail_claude_title(path: Path, bytes_from_end: int = 131072) -> str | None:
    """Return the latest `/rename` title from the file's tail.

    Claude Code appends `{"type":"custom-title","customTitle":"..."}` on
    `/rename`; the last occurrence wins.
    """
    try:
        size = path.stat().st_size
        with path.open("rb") as f:
            if size > bytes_from_end:
                f.seek(size - bytes_from_end)
                f.readline()
            data = f.read()
    except OSError:
        return None
    latest: str | None = None
    for line in data.decode("utf-8", errors="replace").splitlines():
        if '"custom-title"' not in line:
            continue
        try:
            obj = json.loads(line)
        except Exception:  # noqa: BLE001 — JSONL can be malformed, skip silently
            continue
        if obj.get("type") == "custom-title":
            t = obj.get("customTitle")
            if isinstance(t, str) and t.strip():
                latest = t.strip()
    return latest


# ─────────────────────── provider class ───────────────────────
class ClaudeCodeProvider:
    name: str = "claude-code"
    display_name: str = "Claude Code"

    def __init__(self, home_dir: Path | None = None) -> None:
        """Claude Code's home dir is `~/.claude` by default. Overridable for
        tests (the `CLAUDE_HOME` env var). Raises `ProviderUnavailable` if
        the dir is absent — caller drops the provider silently."""
        if home_dir is None:
            env = os.environ.get("CLAUDE_HOME")
            home_dir = Path(env).resolve() if env else Path(os.path.expanduser("~")) / ".claude"
        self.home_dir = home_dir
        self.projects_dir = home_dir / "projects"
        self.active_dir = home_dir / "sessions"
        self.labels_file = home_dir / "viewer-labels.json"
        # Relaxed: home_dir may be absent on a machine without Claude Code,
        # but we still register the provider so `/api/providers` can list
        # it as `available: false`. Only raise if the caller explicitly
        # opted into strict mode (reserved for a future option).
        self._index: dict[str, dict[str, Any]] = {}
        self._index_built = False
        self._index_progress: dict[str, Any] = {"done": 0, "total": 0, "phase": "idle"}
        self._labels_lock = threading.Lock()
        self._observer: Any = None

    # ── label storage (provider-local) ───────────────────────────
    def _load_labels(self) -> dict[str, Any]:
        try:
            data = json.loads(self.labels_file.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:  # noqa: BLE001
            return {}

    def _save_labels(self, d: dict[str, Any]) -> None:
        with self._labels_lock:
            self.labels_file.parent.mkdir(parents=True, exist_ok=True)
            self.labels_file.write_text(json.dumps(d, indent=2), encoding="utf-8")

    def get_user_label(self, sid: str) -> str | None:
        e = self._load_labels().get(sid)
        return e.get("userLabel") if isinstance(e, dict) else None

    def set_user_label(self, sid: str, label: str | None) -> None:
        d = self._load_labels()
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
        self._save_labels(d)

    # ── discovery ─────────────────────────────────────────────────
    def is_indexable_session_path(self, p: Path) -> bool:
        if p.suffix != ".jsonl":
            return False
        if "subagents" in p.parts:
            return False
        if not UUID_RE.match(p.stem):
            return False
        try:
            rel = p.relative_to(self.projects_dir)
        except ValueError:
            return False
        return len(rel.parts) == 2

    def _all_jsonl(self) -> list[Path]:
        if not self.projects_dir.is_dir():
            return []
        return [p for p in self.projects_dir.rglob("*.jsonl") if self.is_indexable_session_path(p)]

    def _scan_session_meta(self, path: Path, deep: bool = False) -> dict[str, Any] | None:
        try:
            stat = path.stat()
        except OSError:
            return None
        session_id = path.stem
        title, cwd, branch, model = "", "", "", ""
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
                try:
                    created_ms = int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)
                except Exception:  # noqa: BLE001
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
            cwd = path.parent.name.replace("--", ":/").replace("-", "/")
        return {
            "id": session_id,
            "provider": self.name,
            "title": title,
            "claudeTitle": _scan_tail_claude_title(path),
            "cwd": cwd,
            "branch": branch or "-",
            "model": model or "claude",
            "createdAt": created_ms,
            "lastActive": int(stat.st_mtime * 1000),
            "messageCount": line_count,
            "tokens": 0,
            "active": False,
            "activityLabel": None,
            "firstUserMessages": first_user_messages,
            "path": str(path),
        }

    def _activity_for(self, path: Path) -> str:
        age = time.time() - path.stat().st_mtime
        if age < 3:
            return "streaming"
        if age < 15:
            return "thinking"
        return "active"

    def active_ids(self) -> set[str]:
        active: set[str] = set()
        if not self.active_dir.is_dir():
            return active
        for f in self.active_dir.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                pid = data.get("pid")
                sid = data.get("sessionId")
                if pid and sid and psutil.pid_exists(int(pid)):
                    active.add(sid)
            except Exception:  # noqa: BLE001
                continue
        return active

    def build_index(self) -> None:
        files = self._all_jsonl()
        self._index_progress["total"] = len(files)
        self._index_progress["done"] = 0
        self._index_progress["phase"] = "scanning"
        for p in files:
            try:
                mtime = p.stat().st_mtime
            except OSError:
                self._index_progress["done"] += 1
                continue
            cached = self._index.get(p.stem)
            if cached and cached.get("_mtime") == mtime:
                self._index_progress["done"] += 1
                continue
            meta = self._scan_session_meta(p, deep=False)
            if meta:
                meta["_mtime"] = mtime
                self._index[p.stem] = meta
            self._index_progress["done"] += 1
        self._index_progress["phase"] = "ready"
        self._index_built = True

    def index_progress(self) -> dict[str, Any]:
        return {**self._index_progress, "ready": self._index_built}

    def discover(self) -> list[SessionMeta]:
        """Return the cached index (build on first call)."""
        if not self._index_built:
            self.build_index()
        active_ids = self.active_ids()
        labels = self._load_labels()
        items: list[SessionMeta] = []
        for meta in self._index.values():
            m: dict[str, Any] = {k: v for k, v in meta.items() if not k.startswith("_")}
            if m["id"] in active_ids:
                m["active"] = True
                m["activityLabel"] = self._activity_for(Path(meta["path"]))
            entry = labels.get(m["id"]) if isinstance(labels.get(m["id"]), dict) else {}
            m["userLabel"] = entry.get("userLabel") if entry else None
            items.append(m)  # type: ignore[arg-type]
        items.sort(key=lambda s: s["lastActive"], reverse=True)  # type: ignore[typeddict-item]
        return items

    def preview(self, session_id: str) -> Preview | None:
        meta = self._index.get(session_id)
        if not meta:
            return None
        deep = self._scan_session_meta(Path(meta["path"]), deep=True)
        if not deep:
            return None
        return Preview(
            id=deep["id"],
            provider=self.name,
            firstUserMessages=deep["firstUserMessages"],
            claudeTitle=deep["claudeTitle"],
        )

    def preview_raw(self, session_id: str) -> dict[str, Any] | None:
        """Legacy: returns the full deep scan (used by the existing /preview
        route that the frontend normalizes). Will be narrowed to `preview()`
        once the frontend migrates."""
        meta = self._index.get(session_id)
        if not meta:
            return None
        return self._scan_session_meta(Path(meta["path"]), deep=True)

    def transcript(self, session_id: str, limit: int = 400) -> list[Message]:
        meta = self._index.get(session_id)
        if not meta:
            return []
        msgs: list[Message] = []
        for obj in _iter_lines(Path(meta["path"])):
            t = obj.get("type")
            if t not in ("user", "assistant"):
                continue
            if _is_meta(obj):
                continue
            m = obj.get("message") or {}
            text = _extract_text(m.get("content"))
            if not text:
                continue
            ts_raw = obj.get("timestamp")
            ts = int(time.time() * 1000)
            if ts_raw:
                try:
                    ts = int(datetime.fromisoformat(ts_raw.replace("Z", "+00:00")).timestamp() * 1000)
                except Exception:  # noqa: BLE001
                    pass
            msgs.append(Message(role=t, content=text, ts=ts))
            if len(msgs) >= limit:
                break
        return msgs

    def resume_command(self, session_id: str) -> list[str]:
        """argv to resume the session in a shell. Consumed by every resume
        path — `/api/open` (wrapped in `wt.exe`), the internal PTY
        terminal, and (upcoming) the restart-resume ping flow.

        The `--dangerously-skip-permissions` flag is always included: the
        viewer is a local tool running the user's own agents on their own
        machine, and permission prompts on resume stall unattended
        workflows (the whole point of the "continue from where you left
        off" flow is that the user ISN'T there to click OK). All resume
        call sites funnel through this function, so flipping the default
        here covers every path without drift.

        Security note: the flag bypasses Claude Code's per-action
        confirmation. Do not repurpose this function for a multi-tenant
        or remote-operator context without revisiting the default.
        """
        return ["claude", "--dangerously-skip-permissions", "--resume", session_id]

    # ── watchdog ─────────────────────────────────────────────────
    def start_watcher(self, on_change: WatcherCallback) -> None:
        if self._observer or not self.projects_dir.is_dir():
            return
        obs = Observer()
        obs.schedule(_Watcher(self, on_change), str(self.projects_dir), recursive=True)
        obs.daemon = True
        obs.start()
        self._observer = obs

    def stop_watcher(self) -> None:
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=2)
            self._observer = None

    # exposed for tests and for the SSE layer in app.py
    def upsert_from_path(self, path: Path) -> tuple[dict[str, Any], bool] | None:
        """Insert/update an index entry from an on-disk session file.

        Returns (public_row, is_new) — is_new=True if the session id wasn't
        in the index before this call, so the SSE layer can pick
        `session_created` vs `session_updated`. Returns None when the path
        isn't an indexable session or the file can't be read.
        """
        if not self.is_indexable_session_path(path):
            return None
        meta = self._scan_session_meta(path, deep=False)
        if not meta:
            return None
        try:
            meta["_mtime"] = path.stat().st_mtime
        except OSError:
            return None
        is_new = meta["id"] not in self._index
        self._index[meta["id"]] = meta
        out = {k: v for k, v in meta.items() if not k.startswith("_")}
        if out["id"] in self.active_ids():
            out["active"] = True
            out["activityLabel"] = self._activity_for(path)
        return out, is_new

    def evict_from_path(self, path: Path) -> str | None:
        if not self.is_indexable_session_path(path):
            return None
        sid = path.stem
        if sid not in self._index:
            return None
        del self._index[sid]
        return sid

    def evict_under_dir(self, parent: Path) -> list[str]:
        to_evict = [
            sid for sid, meta in self._index.items() if Path(meta.get("path", "")).is_relative_to(parent)
        ]
        for sid in to_evict:
            del self._index[sid]
        return to_evict


class _Watcher(FileSystemEventHandler):
    """Reconciles the provider's `_index` with disk in near-real-time."""

    def __init__(self, provider: ClaudeCodeProvider, on_change: WatcherCallback) -> None:
        self.p = provider
        self.cb = on_change

    def _upsert(self, path_str: str) -> None:
        result = self.p.upsert_from_path(Path(path_str))
        if result is None:
            return
        out, is_new = result
        self.cb({"type": "session_created" if is_new else "session_updated", "session": out})

    def _evict(self, path_str: str) -> None:
        sid = self.p.evict_from_path(Path(path_str))
        if sid:
            self.cb({"type": "session_deleted", "id": sid})

    def on_created(self, event: Any) -> None:
        if not event.is_directory:
            self._upsert(event.src_path)

    def on_modified(self, event: Any) -> None:
        if not event.is_directory:
            self._upsert(event.src_path)

    def on_deleted(self, event: Any) -> None:
        if event.is_directory:
            for sid in self.p.evict_under_dir(Path(event.src_path)):
                self.cb({"type": "session_deleted", "id": sid})
            return
        self._evict(event.src_path)

    def on_moved(self, event: Any) -> None:
        if event.is_directory:
            return
        self._evict(event.src_path)
        self._upsert(event.dest_path)
