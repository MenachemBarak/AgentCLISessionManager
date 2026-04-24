"""Daemon probe + detached-spawn helpers (ADR-18 / Task #42 Phase 3b).

Surface area:

- `probe(port)` — classify whether `127.0.0.1:<port>` is:
    "ours"    — a healthy AgentManager daemon responding on /api/health
    "other"   — port is taken by something else (or responds but not ours)
    "absent"  — no listener; we're free to start a daemon

- `spawn_detached(argv, env)` — launch a child with
  `DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB` on Windows so the new
  process has no console, no taskbar presence, and survives its parent
  exiting. ADR-18 §Law 1 (invisible) is upheld here.

- `wait_for_health(port, timeout)` — poll `/api/health` until 200 or
  timeout. Used after `spawn_detached` to synchronize before the UI
  navigates the webview.

None of these touch the webview — the Phase 3c PR wires them into the
existing `backend/cli.py` desktop-mode flow.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Literal, TypedDict

ProbeState = Literal["ours", "other", "absent"]


class ProbeResult(TypedDict, total=False):
    state: ProbeState
    daemonVersion: str
    httpStatus: int
    error: str


def probe(port: int = 8765, timeout: float = 1.5) -> ProbeResult:
    """Classify the current state of the daemon port.

    Returns one of:
    - {"state": "ours",   "daemonVersion": "X.Y.Z"}
    - {"state": "other",  "httpStatus": <int>}
    - {"state": "absent", "error": "..."}
    """
    # Step 1: socket-level listener check. Distinguishes "nothing
    # listening" (we can safely start a daemon) from "something listens
    # but doesn't look like us" (DO NOT clobber). On Windows a
    # just-released port can give TimeoutError from urllib before
    # WSAECONNREFUSED fires, so we rely on `connect_ex` for the truth.
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(min(timeout, 0.5))
    try:
        err = sock.connect_ex(("127.0.0.1", port))
    finally:
        sock.close()
    if err != 0:
        return {"state": "absent", "error": f"connect_ex={err}"}

    url = f"http://127.0.0.1:{port}/api/health"
    try:
        # URL is a locally-constructed http://127.0.0.1 loopback — safe.
        with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310
            if r.status != 200:
                return {"state": "other", "httpStatus": r.status}
            import json

            body = json.loads(r.read().decode("utf-8", errors="replace"))
            if (
                isinstance(body, dict)
                and body.get("ok") is True
                and isinstance(body.get("daemonVersion"), str)
            ):
                return {"state": "ours", "daemonVersion": body["daemonVersion"]}
            return {"state": "other", "httpStatus": r.status}
    except urllib.error.HTTPError as e:
        # Port answered but not /api/health — not ours.
        return {"state": "other", "httpStatus": e.code}
    except urllib.error.URLError as e:
        reason = getattr(e, "reason", e)
        msg = str(reason).lower()
        # Connection-refused patterns we treat as "absent":
        # - POSIX: "connection refused", "network is unreachable"
        # - Windows: "[winerror 10061]" (WSAECONNREFUSED) / "actively refused"
        # - A raw `ConnectionRefusedError` / `ConnectionError` instance
        if (
            isinstance(reason, ConnectionRefusedError | ConnectionError)
            or "refused" in msg
            or "actively refused" in msg
            or "unreachable" in msg
            or "10061" in msg
        ):
            return {"state": "absent", "error": msg}
        # Timeout / other transport error — treat as "other" to be safe
        # (we don't want to clobber an unknown listener).
        return {"state": "other", "error": msg}
    except (OSError, ValueError) as e:
        return {"state": "absent", "error": str(e)}


def spawn_detached(argv: list[str], env: dict[str, str] | None = None) -> int:
    """Spawn a daemon child detached from this process.

    Windows: `DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB` (per ADR-18
    §Architecture; MS docs — `DETACHED_PROCESS` is mutually exclusive
    with `CREATE_NO_WINDOW`, so don't combine).
    Other OSes: no flags needed; pass stdin/stdout/stderr = DEVNULL so
    the child doesn't hold the parent's terminal.

    Returns the spawned PID. Does NOT wait for the child.
    """
    creationflags = 0
    if sys.platform == "win32":
        DETACHED_PROCESS = 0x00000008  # noqa: N806 — Win32 constant
        CREATE_BREAKAWAY_FROM_JOB = 0x01000000  # noqa: N806 — Win32 constant
        creationflags = DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB
    proc_env = {**os.environ, **(env or {})}
    proc = subprocess.Popen(  # noqa: S603
        argv,
        env=proc_env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
        close_fds=True,
    )
    return int(proc.pid)


def wait_for_health(port: int = 8765, timeout: float = 15.0) -> bool:
    """Poll `/api/health` until 200 or timeout. Returns True on success."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = probe(port, timeout=0.4)
        if r.get("state") == "ours":
            return True
        time.sleep(0.15)
    return False
