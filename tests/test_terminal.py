"""Deep tests for the PTY backend.

Three layers, cheapest first:

1. `subprocess_list_to_windows_str` — pure function, no I/O
2. `PtySession` spawn/write/read/close against a real shell — proves
   bytes flow through the PTY and the child is reaped cleanly
3. FastAPI WebSocket (`/api/pty/ws`) end-to-end via `TestClient`:
   handshake → spawn → input → output → close — exercises the exact
   wire protocol the xterm.js frontend will use in PR #3

Windows-only gating: pywinpty is in our Windows deps; posix uses
ptyprocess. Tests that need a PTY use `pytest.importorskip` so CI on
Linux without ptyprocess still collects (should be installed via
requirements.txt, but we belt-and-suspender).
"""

from __future__ import annotations

import platform
import time

import pytest

from backend.terminal import (
    IS_WINDOWS,
    PtySession,
    PtySessionManager,
    subprocess_list_to_windows_str,
)

pytestmark = pytest.mark.filterwarnings("ignore::DeprecationWarning")


# ─────────────────────── Layer 1: pure ─────────────────────────────
def test_windows_quote_no_spaces_or_quotes() -> None:
    assert subprocess_list_to_windows_str(["cmd.exe", "/c", "echo", "hi"]) == "cmd.exe /c echo hi"


def test_windows_quote_wraps_whitespace() -> None:
    # path with a space must get wrapped
    got = subprocess_list_to_windows_str(["claude", "--resume", "my session id"])
    assert got == 'claude --resume "my session id"'


def test_windows_quote_doubles_embedded_quotes() -> None:
    got = subprocess_list_to_windows_str(["echo", 'he said "hi"'])
    assert got == 'echo "he said ""hi"""'


# ─────────────────────── Layer 2: real PTY ──────────────────────────
def _pty_lib_available() -> bool:
    try:
        if IS_WINDOWS:
            import winpty  # noqa: F401
        else:
            import ptyprocess  # noqa: F401
        return True
    except ImportError:
        return False


needs_pty = pytest.mark.skipif(not _pty_lib_available(), reason="no PTY lib installed")


@needs_pty
def test_ptysession_spawn_echo_and_close() -> None:
    """Spawn a shell that echoes a known marker; assert we capture it,
    the process exits cleanly, and close() is idempotent.

    ConPTY on Windows has a ~3-second "first paint" delay after spawn
    before the child's stdout reaches the reader — the deadline below
    accommodates that. On posix this is typically <50ms.
    """
    received: list[str] = []

    cmd = ["cmd.exe", "/c", "echo PTY_MARKER_42"] if IS_WINDOWS else ["sh", "-c", "echo PTY_MARKER_42"]
    s = PtySession(cmd=cmd)
    s.spawn(on_output=lambda data: received.append(data))

    # wait up to 8s — ConPTY's first-paint lag eats ~3s on a cold start
    deadline = time.monotonic() + 8.0
    while time.monotonic() < deadline:
        if "PTY_MARKER_42" in "".join(received):
            break
        time.sleep(0.1)
    combined = "".join(received)
    assert "PTY_MARKER_42" in combined, f"marker not found in output: {combined[:200]!r}"

    # idempotent close
    s.close()
    s.close()


@needs_pty
def test_ptysession_interactive_write() -> None:
    """Keep a shell alive, write a command, read its echo back."""
    received: list[str] = []

    cmd = ["cmd.exe"] if IS_WINDOWS else ["bash", "--norc", "-i"]
    s = PtySession(cmd=cmd, cols=120, rows=30)
    s.spawn(on_output=lambda data: received.append(data))

    # let the shell print its initial prompt — ConPTY's ~3s first-paint
    # delay on Windows means we need to wait a beat before writing
    time.sleep(4.0 if IS_WINDOWS else 0.6)
    assert s.is_alive()

    s.write("echo LIVE_MARKER\r\n" if IS_WINDOWS else "echo LIVE_MARKER\n")
    deadline = time.monotonic() + 6.0
    while time.monotonic() < deadline:
        if "LIVE_MARKER" in "".join(received):
            break
        time.sleep(0.05)
    combined = "".join(received)
    assert "LIVE_MARKER" in combined, f"marker not echoed: {combined[-300:]!r}"

    s.close()


@needs_pty
def test_ptysession_resize_does_not_crash() -> None:
    cmd = ["cmd.exe"] if IS_WINDOWS else ["bash", "--norc"]
    s = PtySession(cmd=cmd)
    s.spawn()
    time.sleep(0.3)
    # sanity — several resizes in a row shouldn't blow up
    for cols, rows in [(80, 24), (120, 40), (200, 60), (60, 20)]:
        s.resize(cols, rows)
        assert s.cols == cols and s.rows == rows
    # clamp + invalid inputs are coerced
    s.resize(0, 0)
    assert s.cols >= 1 and s.rows >= 1
    s.close()


def test_ptysessionmanager_tracks_and_closes_all() -> None:
    """Manager should add, remove, and bulk-close sessions. We don't
    need a real PTY for this — just a stub that records close()."""

    class _StubProc:
        def __init__(self) -> None:
            self.closed = False

        def isalive(self) -> bool:
            return not self.closed

        def close(self, force: bool = False) -> None:
            self.closed = True

        # ptyprocess-style no-op for posix path
        def terminate(self, force: bool = False) -> None:
            self.closed = True

    mgr = PtySessionManager()
    for _ in range(3):
        s = PtySession(cmd=["cmd.exe"])
        s._proc = _StubProc()  # bypass real spawn
        mgr.add(s)
    assert len(mgr) == 3

    popped = mgr.remove(next(iter(mgr.sessions)))
    assert popped is not None
    assert len(mgr) == 2

    mgr.close_all()
    assert len(mgr) == 0


# ─────────────────────── Layer 3: WebSocket end-to-end ────────────
def test_pty_websocket_rejects_non_spawn_first(client) -> None:
    with client.websocket_connect("/api/pty/ws") as ws:
        ws.send_json({"type": "input", "data": "hi"})
        msg = ws.receive_json()
        assert msg["type"] == "error"
        assert "spawn" in msg["message"]


def test_pty_websocket_rejects_unwhitelisted_cmd(client) -> None:
    """The WebSocket must not allow arbitrary argv[0] — otherwise it's a
    remote-exec primitive for any attacker who can reach 127.0.0.1:8765."""
    with client.websocket_connect("/api/pty/ws") as ws:
        ws.send_json({"type": "spawn", "cmd": ["/usr/bin/rm", "-rf", "/"]})
        msg = ws.receive_json()
        assert msg["type"] == "error"


def test_pty_websocket_rejects_unknown_provider(client) -> None:
    with client.websocket_connect("/api/pty/ws") as ws:
        ws.send_json({"type": "spawn", "provider": "no-such-agent", "sessionId": "abc"})
        msg = ws.receive_json()
        assert msg["type"] == "error"


@needs_pty
@pytest.mark.skipif(platform.system() != "Windows", reason="uses cmd.exe whitelist entry")
def test_pty_websocket_echoes_output(client) -> None:
    """Full round-trip: client opens socket → spawns cmd.exe /c echo →
    receives ready + output + exit. This is the exact protocol the
    xterm.js frontend will speak in PR #3.

    We collect frames until we see the marker in an output message, then
    assert the exit frame arrives cleanly."""
    marker = "WS_MARKER_99"
    with client.websocket_connect("/api/pty/ws") as ws:
        ws.send_json(
            {
                "type": "spawn",
                "cmd": ["cmd.exe", "/c", f"echo {marker}"],
                "cols": 120,
                "rows": 30,
            }
        )
        # First frame must be `ready`
        ready = ws.receive_json()
        assert ready["type"] == "ready"
        assert isinstance(ready["id"], str)

        combined = ""
        exit_code: int | None = None
        deadline = time.monotonic() + 10.0  # ConPTY first-paint budget
        while time.monotonic() < deadline:
            frame = ws.receive_json()
            if frame["type"] == "output":
                combined += frame["data"]
                if marker in combined and exit_code is not None:
                    break
                if marker in combined:
                    # keep looping briefly to catch the exit frame too
                    continue
            elif frame["type"] == "exit":
                exit_code = frame.get("code")
                if marker in combined:
                    break
        assert marker in combined, f"never got marker; last 300 chars: {combined[-300:]!r}"
        # exit code may be None on some pywinpty versions — not fatal for the contract
        # but the `exit` frame must have been delivered at least once.
        assert exit_code is not None or "SEEN_EXIT_FRAME" in str(exit_code)
