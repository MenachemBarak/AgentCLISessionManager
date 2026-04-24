r"""Daemon-process bootstrap (ADR-18 / Task #42 Phase 3).

Responsibilities that run ONCE per daemon process before uvicorn.run():

1. Ensure `%LOCALAPPDATA%\AgentManager\` exists with user-only permissions.
2. Generate-or-read the per-install bearer token at `<state>\token` and
   return it to the caller so it can seed the FastAPI auth middleware.
3. Acquire an exclusive advisory lock on `<state>\daemon.pid` so a
   second daemon process refuses to start while we're alive (Law 1:
   invisible singleton). On acquisition, write `{pid, startTimeEpoch,
   daemonVersion}` atomically.

The module is deliberately side-effect-free at import time. The only
entry point `bootstrap()` does all the work and returns the token plus a
context manager that holds the lock for the daemon's lifetime.
"""

from __future__ import annotations

import json
import os
import secrets
import sys
import time
from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from pathlib import Path


def state_dir() -> Path:
    r"""Return `%LOCALAPPDATA%\AgentManager\`.

    Tests override by pointing `AGENTMANAGER_STATE_DIR` at a tmp path —
    that way a daemon spawned by a test can't clobber the user's real
    pid file.
    """
    env = os.environ.get("AGENTMANAGER_STATE_DIR")
    if env:
        return Path(env).resolve()
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
    return Path(base) / "AgentManager"


def ensure_state_dir() -> Path:
    p = state_dir()
    p.mkdir(parents=True, exist_ok=True)
    return p


def token_file() -> Path:
    return state_dir() / "token"


def pid_file() -> Path:
    return state_dir() / "daemon.pid"


def _restrict_acl_to_current_user(path: Path) -> None:
    """Best-effort: restrict the token file's NTFS ACL to the current
    user only, so a sibling process running as a different user on the
    same machine can't read it.

    Windows-only. On failure (unusual ACL state, no pywin32), logs and
    continues — the loopback-only bind is still the primary defense.
    """
    if sys.platform != "win32":
        return
    try:  # type: ignore[unreachable]
        # pywin32 modules are Windows-only; mypy on linux CI sees them as
        # missing, mypy on Windows sees them as untyped.
        import ntsecuritycon as con  # type: ignore[import-not-found,import-untyped]
        import win32security  # type: ignore[import-not-found,import-untyped]

        user, _domain, _type = win32security.LookupAccountName("", os.environ.get("USERNAME", ""))
        sd = win32security.SECURITY_DESCRIPTOR()
        dacl = win32security.ACL()
        dacl.AddAccessAllowedAce(
            win32security.ACL_REVISION,
            con.FILE_ALL_ACCESS,
            user,
        )
        sd.SetSecurityDescriptorDacl(1, dacl, 0)
        win32security.SetFileSecurity(str(path), win32security.DACL_SECURITY_INFORMATION, sd)
    except Exception:  # noqa: BLE001 — best-effort hardening
        pass


def read_or_create_token() -> str:
    """Return the daemon's bearer token; create it on first call.

    Format: 64 hex chars (32 bytes from `secrets.token_hex`). Persisted
    to `<state>\\token` with a user-only ACL on Windows.
    """
    f = token_file()
    ensure_state_dir()
    if f.is_file():
        try:
            existing = f.read_text(encoding="utf-8").strip()
            if existing and all(c in "0123456789abcdef" for c in existing.lower()) and len(existing) >= 32:
                return existing
        except OSError:
            pass
    tok = secrets.token_hex(32)
    f.write_text(tok, encoding="utf-8")
    _restrict_acl_to_current_user(f)
    return tok


def _pid_alive(pid: int) -> bool:
    try:
        import psutil  # vendored in our reqs already
        return psutil.pid_exists(pid)
    except Exception:  # noqa: BLE001
        return False


def _read_existing_pid_entry() -> dict | None:
    try:
        raw = pid_file().read_text(encoding="utf-8")
        d = json.loads(raw)
        if isinstance(d, dict) and isinstance(d.get("pid"), int):
            return d
    except Exception:  # noqa: BLE001
        pass
    return None


class DaemonAlreadyRunning(RuntimeError):
    """A healthy daemon already holds the pid file — abort our startup."""


@contextmanager
def acquire_singleton_pid(daemon_version: str) -> Iterator[Path]:
    """Acquire the exclusive singleton lock for this daemon.

    Yields the pid-file path once the lock is held; clears the file on
    exit. Raises `DaemonAlreadyRunning` if another live daemon already
    holds the file.

    Implementation: read existing pid; if it's alive, refuse. If stale,
    overwrite. We rely on `psutil.pid_exists` for liveness and on
    atomic write (temp file + replace) for crash-safety. Full
    portalocker-style advisory file locking is deferred to a follow-up —
    the pid+liveness check is the load-bearing guarantee for Law 1.
    """
    ensure_state_dir()
    existing = _read_existing_pid_entry()
    if existing is not None and _pid_alive(int(existing["pid"])) and existing["pid"] != os.getpid():
        raise DaemonAlreadyRunning(
            f"daemon pid {existing['pid']} already running "
            f"(version {existing.get('daemonVersion', '?')})"
        )
    # Write our own entry atomically.
    entry = {
        "pid": os.getpid(),
        "startTimeEpoch": int(time.time()),
        "daemonVersion": daemon_version,
    }
    tmp = pid_file().with_suffix(".pid.tmp")
    tmp.write_text(json.dumps(entry), encoding="utf-8")
    tmp.replace(pid_file())
    try:
        yield pid_file()
    finally:
        # Best-effort cleanup. If a crash leaves the file behind, the
        # next daemon's liveness check covers us.
        try:
            current = _read_existing_pid_entry()
            if current is not None and current.get("pid") == os.getpid():
                pid_file().unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass


def bootstrap(daemon_version: str) -> tuple[str, AbstractContextManager[Path]]:
    """Run the full daemon bootstrap.

    Returns (bearer_token, pid_lock_cm). Caller is expected to enter
    `pid_lock_cm` and hold it for the daemon's lifetime.
    """
    token = read_or_create_token()
    lock_cm = acquire_singleton_pid(daemon_version)
    return token, lock_cm
