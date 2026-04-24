"""AgentManager uninstall orchestrator (ADR-18 / Task #42 Phase 6, Law 3).

Entry point: `AgentManager.exe --uninstall [--yes]` (or
`python -m backend.cli --uninstall [--yes]` in dev).

The seven-step tear-down (every step is exists-check + best-effort — a
missing file or already-dead daemon doesn't abort the sequence):

1. Look up the daemon PID from %LOCALAPPDATA%\\AgentManager\\daemon.pid
2. POST /api/shutdown with a 5s timeout — graceful shutdown asks the
   daemon to close PTYs and exit cleanly
3. If the daemon didn't exit within 5s, TerminateProcess by PID and
   walk the process tree to kill PTY grandchildren (psutil)
4. Remove %LOCALAPPDATA%\\AgentManager\\ tree (exes, pid file, token,
   layout state, logs, ring buffer dumps, update staging)
5. Remove Desktop shortcut
6. Remove Start-menu shortcuts (AgentManager + Uninstall)
7. Remove HKCU\\Software\\AgentManager registry key if present

Step order matters: must kill the daemon BEFORE removing its state dir,
else the running daemon re-creates files we just deleted. Shortcuts +
registry are last (cheapest; least likely to fail; reversible with
reinstall).
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


# ─────────────────────── locations ───────────────────────


def state_dir() -> Path:
    env = os.environ.get("AGENTMANAGER_STATE_DIR")
    if env:
        return Path(env).resolve()
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
    return Path(base) / "AgentManager"


def desktop_shortcut() -> Path:
    userprofile = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    return Path(userprofile) / "Desktop" / "AgentManager.lnk"


def start_menu_shortcut() -> Path:
    appdata = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Roaming")
    return Path(appdata) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "AgentManager.lnk"


def start_menu_uninstall_shortcut() -> Path:
    appdata = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Roaming")
    return Path(appdata) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Uninstall AgentManager.lnk"


# ─────────────────────── steps ───────────────────────


def _read_daemon_pid() -> int | None:
    pidfile = state_dir() / "daemon.pid"
    if not pidfile.is_file():
        return None
    try:
        entry: dict[str, Any] = json.loads(pidfile.read_text(encoding="utf-8"))
        pid = entry.get("pid")
        return int(pid) if isinstance(pid, int) else None
    except (OSError, ValueError, json.JSONDecodeError):
        return None


def _try_graceful_shutdown(pid: int, timeout: float = 5.0) -> bool:
    """Ask the daemon to shut down via POST /api/shutdown with its bearer
    token. Returns True if the daemon exited within `timeout`.

    Uses plain urllib to avoid importing FastAPI/requests just for this.
    Token is read from the same state dir the daemon wrote it to; a
    missing token file is not fatal — we fall through to TerminateProcess.
    """
    import urllib.error
    import urllib.request

    token_path = state_dir() / "token"
    token = None
    if token_path.is_file():
        try:
            token = token_path.read_text(encoding="utf-8").strip() or None
        except OSError:
            pass

    req = urllib.request.Request("http://127.0.0.1:8765/api/shutdown", method="POST")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        urllib.request.urlopen(req, timeout=2.0)  # noqa: S310 — loopback only
    except (urllib.error.URLError, TimeoutError, OSError):
        # Endpoint may not exist (pre-Phase-6 daemon) or the daemon is
        # already dying — fall through and wait-or-kill.
        pass

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not _pid_is_alive(pid):
            return True
        time.sleep(0.1)
    return False


def _pid_is_alive(pid: int) -> bool:
    try:
        import psutil
    except ImportError:
        return False
    try:
        return psutil.pid_exists(pid) and psutil.Process(pid).is_running()
    except Exception:  # noqa: BLE001
        return False


def _force_kill_with_pty_tree(pid: int) -> None:
    """TerminateProcess on the daemon and walk its process tree to kill
    PTY grandchildren (cmd.exe + claude). This is the regression guard
    against the Squirrel/VSCode uninstaller orphan class of bug cited in
    the ADR-18 research."""
    try:
        import psutil
    except ImportError:
        log.warning("psutil not available — cannot force-kill daemon tree; PID %s may linger", pid)
        return
    try:
        daemon = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return

    # Kill grandchildren first (PTY cmd.exe + claude) so they don't get
    # reparented to PID 1 / wininit when the daemon dies.
    try:
        tree = list(daemon.children(recursive=True))
    except psutil.NoSuchProcess:
        tree = []
    for child in tree:
        try:
            child.kill()
        except psutil.NoSuchProcess:
            pass
        except psutil.AccessDenied:
            log.warning("access denied killing child pid %s", child.pid)

    try:
        daemon.kill()
    except psutil.NoSuchProcess:
        pass
    except psutil.AccessDenied:
        log.warning("access denied killing daemon pid %s", pid)


def _remove_tree(path: Path) -> None:
    if not path.exists():
        return
    try:
        shutil.rmtree(path, ignore_errors=False)
    except OSError as exc:
        log.warning("failed to remove %s: %s", path, exc)


def _remove_file(path: Path) -> None:
    if not path.exists():
        return
    try:
        path.unlink()
    except OSError as exc:
        log.warning("failed to remove %s: %s", path, exc)


def _remove_registry_key() -> None:
    """Best-effort HKCU\\Software\\AgentManager removal. We don't currently
    write registry entries, but the uninstaller checks anyway in case a
    future change does — defence against the Docker Desktop-style
    leftover-state class of bug."""
    if sys.platform != "win32":
        return
    try:  # type: ignore[unreachable]
        import winreg  # type: ignore[import-not-found,import-untyped]

        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, r"Software\AgentManager")
        except FileNotFoundError:
            pass
        except OSError as exc:
            log.warning("failed to delete HKCU\\Software\\AgentManager: %s", exc)
    except ImportError:  # noqa: BLE001
        pass


# ─────────────────────── orchestrator ───────────────────────


def run_uninstall(dry_run: bool = False) -> int:
    """Execute the full seven-step tear-down. Returns exit code (always 0
    in practice — steps are best-effort). `dry_run=True` only reports
    what would happen without touching anything.
    """
    actions: list[str] = []

    # 1 + 2 + 3: find daemon + shut down + force-kill if needed.
    pid = _read_daemon_pid()
    if pid and _pid_is_alive(pid):
        actions.append(f"[kill] daemon pid {pid}")
        if not dry_run:
            graceful = _try_graceful_shutdown(pid, timeout=5.0)
            if not graceful:
                _force_kill_with_pty_tree(pid)
    elif pid:
        actions.append(f"[skip] daemon pid {pid} already dead")
    else:
        actions.append("[skip] no daemon pid file")

    # 4: state dir
    sd = state_dir()
    if sd.exists():
        actions.append(f"[rm  ] {sd}")
        if not dry_run:
            _remove_tree(sd)
    else:
        actions.append(f"[skip] {sd} (already absent)")

    # 5 + 6: shortcuts
    for lnk in (desktop_shortcut(), start_menu_shortcut(), start_menu_uninstall_shortcut()):
        if lnk.exists():
            actions.append(f"[rm  ] {lnk}")
            if not dry_run:
                _remove_file(lnk)
        else:
            actions.append(f"[skip] {lnk} (already absent)")

    # 7: registry
    actions.append("[reg ] HKCU\\Software\\AgentManager (delete if present)")
    if not dry_run:
        _remove_registry_key()

    for a in actions:
        print(a)
    if dry_run:
        print("(dry-run — no changes made)")
    else:
        print("AgentManager uninstalled.")
    return 0
