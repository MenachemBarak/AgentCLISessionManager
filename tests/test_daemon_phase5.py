"""Phase 5 unit tests — WS reattach-by-id with ring-buffer replay.

Covers ADR-18 / Task #42 Phase 5: a client reconnecting after UI
restart can hand the daemon a ptyId and receive the live PTY plus its
scrollback, instead of spawning a fresh shell.
"""

from __future__ import annotations

import platform
import time

import pytest
from fastapi.testclient import TestClient

from backend.app import _pty_manager, app

WIN = platform.system() == "Windows"


@pytest.fixture
def client_no_auth():
    app.state.require_bearer_token = None
    yield TestClient(app)
    # Clean any PTYs tests leak.
    _pty_manager.close_all()


# ─────────────────────── reattach error paths ───────────────────────


def test_reattach_unknown_id_returns_error_and_closes(client_no_auth):
    with client_no_auth.websocket_connect("/api/pty/ws") as ws:
        ws.send_json({"type": "spawn", "ptyId": "does-not-exist"})
        msg = ws.receive_json()
        assert msg == {"type": "error", "message": "ptyId 'does-not-exist' not found"}
        # Server closes the socket after error — next receive should raise.
        from starlette.websockets import WebSocketDisconnect

        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_reattach_empty_id_falls_through_to_spawn_new(client_no_auth):
    """An empty string ptyId must not trigger reattach — spawn-new must run instead."""
    if not WIN:
        pytest.skip("PTY spawn tests only run on Windows")

    with client_no_auth.websocket_connect("/api/pty/ws") as ws:
        ws.send_json({"type": "spawn", "ptyId": "", "cmd": ["cmd.exe"]})
        msg = ws.receive_json()
        assert msg["type"] == "ready"
        assert "id" in msg
        assert msg.get("reattached") is not True


# ─────────────────────── reattach happy path ───────────────────────


def test_reattach_replays_ring_buffer_then_streams_live(client_no_auth):
    if not WIN:
        pytest.skip("PTY spawn tests only run on Windows")

    marker = f"REATTACH-{int(time.time())}"

    # 1) Spawn a PTY via the REST endpoint (Phase 4 path) so the ring buffer
    # accumulates without needing a WS open.
    r = client_no_auth.post("/api/pty", json={"cmd": ["cmd.exe"]})
    assert r.status_code == 200
    pty_id = r.json()["id"]

    # 2) Echo a marker into it.
    w = client_no_auth.post(f"/api/pty/{pty_id}/write", json={"data": f"echo {marker}\r\n"})
    assert w.status_code == 200

    # 3) Wait for the marker to land in the ring buffer.
    deadline = time.time() + 6
    while time.time() < deadline:
        r = client_no_auth.get(f"/api/pty/{pty_id}/replay")
        if marker in r.text:
            break
        time.sleep(0.1)
    else:
        pytest.fail("marker never hit ring buffer")

    # 4) Open a WS and reattach by id. The first frame should be the batched
    # replay, flagged `replay: True`.
    with client_no_auth.websocket_connect("/api/pty/ws") as ws:
        ws.send_json({"type": "spawn", "ptyId": pty_id})
        first = ws.receive_json()
        # Replay frame comes BEFORE ready when the buffer has content.
        if first.get("type") == "output":
            assert first.get("replay") is True
            assert marker in first.get("data", "")
            ready = ws.receive_json()
        else:
            ready = first
        assert ready["type"] == "ready"
        assert ready["id"] == pty_id
        assert ready.get("reattached") is True


def test_reattach_keeps_pty_alive_across_ws_disconnects(client_no_auth):
    """Core Phase-5 invariant: UI restart = WS disconnect; PTY must persist."""
    if not WIN:
        pytest.skip("PTY spawn tests only run on Windows")

    r = client_no_auth.post("/api/pty", json={"cmd": ["cmd.exe"]})
    pty_id = r.json()["id"]

    # First reattach + close.
    with client_no_auth.websocket_connect("/api/pty/ws") as ws:
        ws.send_json({"type": "spawn", "ptyId": pty_id})
        # drain until ready
        while True:
            m = ws.receive_json()
            if m.get("type") == "ready":
                break

    # PTY must still be live in the manager after WS closed.
    assert _pty_manager.get(pty_id) is not None, "PTY vanished after WS disconnect (Phase-5 regression)"

    # Second reattach — should succeed.
    with client_no_auth.websocket_connect("/api/pty/ws") as ws:
        ws.send_json({"type": "spawn", "ptyId": pty_id})
        saw_ready = False
        for _ in range(3):
            m = ws.receive_json()
            if m.get("type") == "ready" and m.get("reattached") is True:
                saw_ready = True
                break
        assert saw_ready


def test_fresh_spawn_still_works_without_ptyId(client_no_auth):
    """Regression guard: the reattach path must not break the spawn-new path."""
    if not WIN:
        pytest.skip("PTY spawn tests only run on Windows")

    with client_no_auth.websocket_connect("/api/pty/ws") as ws:
        ws.send_json({"type": "spawn", "cmd": ["cmd.exe"]})
        m = ws.receive_json()
        assert m["type"] == "ready"
        assert m.get("reattached") is not True  # new spawn, not reattach
