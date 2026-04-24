"""Phase 4 unit tests — RingBuffer + PTY REST endpoints (create/write/replay).

Covers ADR-18 / Task #42 Phase 4 surface area without depending on a
real PTY subprocess. PTY itself is tested only lightly (spawn smoke
test) — the load-bearing invariants are the ring buffer bounds +
endpoint wiring.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.terminal import DEFAULT_RING_BUFFER_BYTES, RingBuffer

# ─────────────────────── RingBuffer ───────────────────────


def test_ring_buffer_accumulates_small_writes():
    rb = RingBuffer(max_bytes=1024)
    rb.append(b"hello ")
    rb.append(b"world")
    assert rb.read_all() == b"hello world"
    assert rb.size() == len(b"hello world")


def test_ring_buffer_evicts_oldest_chunks_past_cap():
    """Feed more than the cap and assert the oldest bytes are dropped."""
    rb = RingBuffer(max_bytes=100)
    for i in range(20):
        rb.append(f"chunk{i:02d}-{'x' * 10}".encode())
    total = rb.size()
    # Must be bounded near cap (deque evicts whole chunks, so may dip
    # below 100 when the last chunk over evicts a chunk bigger than the
    # overflow; never exceed cap after a fresh eviction cycle).
    assert total <= 100
    # Must contain the most-recent chunks, not the earliest.
    tail = rb.read_all().decode()
    assert "chunk19" in tail
    assert "chunk00" not in tail


def test_ring_buffer_handles_1mb_feed_without_growing():
    rb = RingBuffer(max_bytes=DEFAULT_RING_BUFFER_BYTES)  # 256 KB
    for _ in range(200):
        rb.append(b"A" * 5000)  # total = 1 MB
    assert rb.size() <= DEFAULT_RING_BUFFER_BYTES + 5000  # cap + one chunk's slack


def test_ring_buffer_empty_read_is_empty_bytes():
    rb = RingBuffer()
    assert rb.read_all() == b""
    assert rb.size() == 0


def test_ring_buffer_append_empty_is_noop():
    rb = RingBuffer(max_bytes=100)
    rb.append(b"seed")
    rb.append(b"")
    assert rb.read_all() == b"seed"


# ─────────────────────── PTY REST endpoints ───────────────────────


@pytest.fixture
def client_no_auth():
    """Client with auth middleware disabled (default — non-daemon mode)."""
    app.state.require_bearer_token = None
    return TestClient(app)


def test_pty_create_rejects_non_whitelisted_argv(client_no_auth):
    r = client_no_auth.post("/api/pty", json={"cmd": ["rm", "-rf", "/"]})
    assert r.status_code == 400
    assert "cmd[0] must be one of" in r.json()["detail"]


def test_pty_create_rejects_empty_cmd(client_no_auth):
    r = client_no_auth.post("/api/pty", json={"cmd": []})
    assert r.status_code == 400


def test_pty_write_and_replay_roundtrip(client_no_auth):
    """Spawn cmd.exe, echo a marker, confirm it shows up in /replay.

    Windows only — skip on other platforms. We don't have a POSIX
    equivalent in the whitelist yet.
    """
    import platform

    if platform.system() != "Windows":
        pytest.skip("PTY spawn tests only run on Windows (our target platform)")

    r = client_no_auth.post("/api/pty", json={"cmd": ["cmd.exe"]})
    assert r.status_code == 200, r.text
    pty_id = r.json()["id"]

    marker = f"PHASE4-MARKER-{int(time.time())}"
    w = client_no_auth.post(f"/api/pty/{pty_id}/write", json={"data": f"echo {marker}\r\n"})
    assert w.status_code == 200

    # Give the shell time to run + flush output back through the read loop.
    deadline = time.time() + 6
    while time.time() < deadline:
        r = client_no_auth.get(f"/api/pty/{pty_id}/replay")
        assert r.status_code == 200
        if marker in r.text:
            break
        time.sleep(0.1)
    else:
        pytest.fail(f"marker never appeared in replay. Got: {r.text[-500:]!r}")


def test_pty_write_unknown_id_returns_404(client_no_auth):
    r = client_no_auth.post("/api/pty/does-not-exist/write", json={"data": "hi"})
    assert r.status_code == 404


def test_pty_replay_unknown_id_returns_404(client_no_auth):
    r = client_no_auth.get("/api/pty/does-not-exist/replay")
    assert r.status_code == 404


def test_pty_endpoints_are_auth_gated_in_daemon_mode():
    """When auth is on (daemon mode), /api/pty requires a bearer token."""
    tok = "abcd" * 16
    app.state.require_bearer_token = tok
    try:
        client = TestClient(app)
        r = client.post("/api/pty", json={"cmd": ["cmd.exe"]})
        assert r.status_code == 401
    finally:
        app.state.require_bearer_token = None
