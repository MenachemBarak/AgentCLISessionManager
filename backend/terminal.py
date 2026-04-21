"""Embedded terminal backend — spawns PTYs and multiplexes them over
WebSockets.

Every connected xterm.js on the frontend owns one `PtySession` in this
module. The protocol is minimal and mirrored on both sides:

    client → server
        {"type":"input","data":"ls\\r"}
        {"type":"resize","cols":120,"rows":40}

    server → client
        {"type":"output","data":"<bytes from the pty>"}
        {"type":"exit","code":0}

We only send text (the PTY output is decoded utf-8 with replace — matches
what xterm.js expects on the wire).

Platform matrix
    Windows: `pywinpty` → ConPTY via `winpty.PtyProcess.spawn`.
    Linux/macOS: `ptyprocess` → `fork+execv`. Gated by platform.system().
Both libraries expose the same `read/write/setwinsize/close/isalive`
surface which is why the rest of this file doesn't care which one runs.
"""

from __future__ import annotations

import asyncio
import logging
import platform
import shlex
import threading
import time
import uuid
from collections.abc import Callable, Coroutine
from typing import Any

log = logging.getLogger(__name__)

IS_WINDOWS = platform.system() == "Windows"


def _spawn(cmd: list[str] | str, cols: int, rows: int, cwd: str | None, env: dict[str, str] | None) -> Any:
    """Spawn a PTY child running `cmd`. Returns the library-specific
    process handle — both `winpty.PtyProcess` and `ptyprocess.PtyProcess`
    implement the read/write/setwinsize/close/isalive methods we use."""
    if IS_WINDOWS:
        import winpty  # type: ignore[import-not-found]

        # pywinpty expects a single command string, not argv.
        cmd_str = cmd if isinstance(cmd, str) else subprocess_list_to_windows_str(cmd)
        return winpty.PtyProcess.spawn(cmd_str, dimensions=(rows, cols), cwd=cwd, env=env)
    import ptyprocess  # type: ignore[import-not-found]

    argv = cmd if isinstance(cmd, list) else shlex.split(cmd)
    return ptyprocess.PtyProcess.spawn(argv, dimensions=(rows, cols), cwd=cwd, env=env)


def subprocess_list_to_windows_str(argv: list[str]) -> str:
    """Quote an argv list the same way the Windows CRT would join it.

    Every argument that contains whitespace or a quote gets wrapped in
    double quotes with embedded `"` doubled. We do this ourselves rather
    than relying on `subprocess.list2cmdline` so the behaviour is
    identical whether the process is spawned via subprocess or winpty.
    """
    out: list[str] = []
    for arg in argv:
        if arg and not any(ch in arg for ch in ' \t"\n'):
            out.append(arg)
            continue
        out.append('"' + arg.replace('"', '""') + '"')
    return " ".join(out)


class PtySession:
    """One PTY process + a pair of read/write channels.

    Lifecycle:
        session = PtySession(cmd=["cmd.exe"])
        session.spawn()
        session.on_output = lambda data_str: ...  # wire to WebSocket.send
        session.write("dir\\r")
        session.resize(100, 30)
        session.close()

    `on_output` is called from the read thread — the caller is
    responsible for marshalling back to an event loop. `PtySessionManager`
    below takes care of that for the FastAPI integration.
    """

    def __init__(
        self,
        cmd: list[str] | str,
        cols: int = 80,
        rows: int = 24,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
    ) -> None:
        self.id = uuid.uuid4().hex
        self.cmd = cmd
        self.cols = cols
        self.rows = rows
        self.cwd = cwd
        self.env = env
        self._proc: Any = None
        self._read_thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.on_output: Callable[[str], None] | None = None
        self.on_exit: Callable[[int | None], None] | None = None

    def spawn(
        self,
        on_output: Callable[[str], None] | None = None,
        on_exit: Callable[[int | None], None] | None = None,
    ) -> None:
        """Start the PTY child. Pass callbacks here (not by setting
        attributes after) — the read thread starts immediately, and the
        first chunk (terminal init escapes) arrives within microseconds on
        Windows. Assigning `on_output = ...` after `spawn()` would race
        and drop that chunk."""
        if on_output is not None:
            self.on_output = on_output
        if on_exit is not None:
            self.on_exit = on_exit
        self._proc = _spawn(self.cmd, self.cols, self.rows, self.cwd, self.env)
        self._read_thread = threading.Thread(
            target=self._read_loop, name=f"pty-read-{self.id[:8]}", daemon=True
        )
        self._read_thread.start()

    def _read_loop(self) -> None:
        """Drain the PTY in a loop until the child exits.

        pywinpty's `read(n)` is non-blocking — returns '' when nothing is
        buffered — so naively breaking on empty output races with
        producers that haven't written yet. We poll `isalive()` to
        distinguish "no data yet" from "actually done", and sleep briefly
        between empty reads to avoid a busy loop.

        ptyprocess (posix) makes `read()` block until data or EOF, so the
        same loop works there with `isalive()` as a safety net.
        """
        # Stop polling once the child has been dead for this many seconds
        # AND no more data is being produced. Gives a graceful window for
        # the child's final output to drain out of the pipe.
        grace = 0.3
        dead_since: float | None = None

        while not self._stop.is_set():
            try:
                chunk: Any = self._proc.read(4096)
            except EOFError:
                break
            except Exception:  # noqa: BLE001 — lib differences; treat any read error as EOF
                break

            if chunk:
                dead_since = None  # got data — reset grace timer
                data = chunk if isinstance(chunk, str) else chunk.decode("utf-8", errors="replace")
                cb = self.on_output
                if cb:
                    try:
                        cb(data)
                    except Exception:  # noqa: BLE001
                        log.exception("on_output callback raised")
                continue

            # empty read — either child's still running and slow, or it died
            if not self._proc.isalive():
                if dead_since is None:
                    dead_since = time.monotonic()
                elif time.monotonic() - dead_since >= grace:
                    break
            time.sleep(0.02)

        # child exited or read failed — report exit code
        code: int | None = None
        try:
            code = int(self._proc.exitstatus) if self._proc.exitstatus is not None else None
        except Exception:  # noqa: BLE001
            code = None
        exit_cb = self.on_exit
        if exit_cb:
            try:
                exit_cb(code)
            except Exception:  # noqa: BLE001
                log.exception("on_exit callback raised")

    def write(self, data: str) -> int:
        """Send text to the child's stdin. Returns bytes written."""
        if not self.is_alive():
            return 0
        # pywinpty.PtyProcess.write accepts str; ptyprocess accepts bytes.
        payload: Any = data if IS_WINDOWS else data.encode("utf-8", errors="replace")
        try:
            return int(self._proc.write(payload) or 0)
        except Exception:  # noqa: BLE001
            return 0

    def resize(self, cols: int, rows: int) -> None:
        if not self.is_alive():
            return
        cols = max(1, min(int(cols), 1000))
        rows = max(1, min(int(rows), 500))
        self.cols, self.rows = cols, rows
        try:
            # Windows: setwinsize(rows, cols)  |  posix: same signature
            self._proc.setwinsize(rows, cols)
        except Exception:  # noqa: BLE001
            log.exception("resize failed")

    def is_alive(self) -> bool:
        return bool(self._proc and self._proc.isalive())

    def close(self) -> None:
        self._stop.set()
        if self._proc is not None:
            try:
                self._proc.close(force=True) if IS_WINDOWS else self._proc.terminate(force=True)
            except Exception:  # noqa: BLE001
                pass


# ─────────────────────── async FastAPI integration ───────────────────
PtySendFn = Callable[[dict[str, Any]], Coroutine[Any, Any, None]]


class PtySessionManager:
    """Tracks every open PTY so the server can clean up on shutdown."""

    def __init__(self) -> None:
        self.sessions: dict[str, PtySession] = {}
        self._lock = threading.Lock()

    def add(self, session: PtySession) -> None:
        with self._lock:
            self.sessions[session.id] = session

    def remove(self, session_id: str) -> PtySession | None:
        with self._lock:
            return self.sessions.pop(session_id, None)

    def close_all(self) -> None:
        with self._lock:
            sessions = list(self.sessions.values())
            self.sessions.clear()
        for s in sessions:
            s.close()

    def __len__(self) -> int:
        return len(self.sessions)


def bridge_pty_to_websocket(
    session: PtySession,
    send: PtySendFn,
    loop: asyncio.AbstractEventLoop,
) -> None:
    """Wire a PTY's output / exit events back to the async WebSocket send.

    The PTY runs on a thread; the WebSocket lives on the asyncio loop.
    `call_soon_threadsafe` bridges them. If the loop is closed (WebSocket
    torn down before the PTY) we silently drop — the session will be
    reaped by close_all.
    """

    def _on_out(data: str) -> None:
        try:
            asyncio.run_coroutine_threadsafe(send({"type": "output", "data": data}), loop)
        except RuntimeError:
            pass

    def _on_exit(code: int | None) -> None:
        try:
            asyncio.run_coroutine_threadsafe(send({"type": "exit", "code": code}), loop)
        except RuntimeError:
            pass

    session.on_output = _on_out
    session.on_exit = _on_exit
