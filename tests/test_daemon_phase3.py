"""Phase 3 unit tests — daemon bootstrap + bearer-token auth middleware.

Covers the parts of ADR-18 / Task #42 Phase 3 that can be exercised
without a real daemon process:
- token generation + persistence
- pid file singleton check
- auth middleware gates everything except /api/health
- health endpoint is reachable without a token
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from daemon import app
from daemon.bootstrap import (
    DaemonAlreadyRunning,
    acquire_singleton_pid,
    pid_file,
    read_or_create_token,
    state_dir,
    token_file,
)


@pytest.fixture
def isolated_state(tmp_path, monkeypatch):
    """Point state_dir at a fresh tmp path so tests can't scribble into
    the user's real %LOCALAPPDATA%\\AgentManager."""
    monkeypatch.setenv("AGENTMANAGER_STATE_DIR", str(tmp_path))
    yield tmp_path


@pytest.fixture(autouse=True)
def reset_auth():
    """Make sure one test turning on auth doesn't leak into the next."""
    yield
    if hasattr(app.state, "require_bearer_token"):
        app.state.require_bearer_token = None


def test_state_dir_respects_env(isolated_state):
    assert state_dir() == isolated_state


def test_token_is_created_and_reused(isolated_state):
    t1 = read_or_create_token()
    assert len(t1) >= 32
    assert all(c in "0123456789abcdef" for c in t1.lower())
    t2 = read_or_create_token()
    assert t1 == t2, "second call must return the same persisted token"
    assert token_file().read_text(encoding="utf-8").strip() == t1


def test_pid_lock_acquires_and_releases(isolated_state):
    with acquire_singleton_pid("1.2.0") as path:
        assert path == pid_file()
        import json

        entry = json.loads(path.read_text(encoding="utf-8"))
        assert entry["pid"] == os.getpid()
        assert entry["daemonVersion"] == "1.2.0"
        assert isinstance(entry["startTimeEpoch"], int)
    # File removed on context exit (best-effort — but we own the pid).
    assert not pid_file().exists()


def test_pid_lock_refuses_when_live_daemon_present(isolated_state, monkeypatch):
    """Seed a pid file claiming our own pid — liveness check says alive — refuse."""
    import json

    entry = {"pid": os.getpid(), "startTimeEpoch": 1, "daemonVersion": "0.0.1"}
    pid_file().write_text(json.dumps(entry), encoding="utf-8")
    # Our real pid IS alive (we're running), so acquire must refuse even
    # though in normal operation our own pid wouldn't be seen as "other".
    # Simulate "other daemon" by forging a different pid.
    entry["pid"] = os.getpid() + 1 if os.getpid() > 2 else 99999
    pid_file().write_text(json.dumps(entry), encoding="utf-8")

    def _pretend_alive(_pid):
        return True

    monkeypatch.setattr("daemon.bootstrap._pid_alive", _pretend_alive)

    with pytest.raises(DaemonAlreadyRunning):
        with acquire_singleton_pid("1.2.0"):
            pass


def test_pid_lock_overwrites_stale_entry(isolated_state):
    """Dead pid in the file — acquire should succeed and overwrite."""
    import json

    # Write a bogus pid that's definitely not alive (negative won't work on
    # Windows; use a huge unlikely value and check it's not alive).
    entry = {"pid": 4_000_000_000, "startTimeEpoch": 1, "daemonVersion": "0.0.1"}
    pid_file().write_text(json.dumps(entry), encoding="utf-8")
    with acquire_singleton_pid("1.2.0") as path:
        new_entry = json.loads(path.read_text(encoding="utf-8"))
        assert new_entry["pid"] == os.getpid()


# ─────────────────────── bearer-token middleware ───────────────────────


def test_auth_off_by_default():
    """In non-daemon mode (no require_bearer_token set), all routes work."""
    app.state.require_bearer_token = None
    client = TestClient(app)
    r = client.get("/api/health")
    assert r.status_code == 200
    r = client.get("/api/status")
    assert r.status_code == 200


def test_auth_rejects_missing_token():
    app.state.require_bearer_token = "deadbeef" * 8
    client = TestClient(app)
    r = client.get("/api/status")
    assert r.status_code == 401
    assert "missing" in r.json()["error"]


def test_auth_rejects_wrong_token():
    app.state.require_bearer_token = "deadbeef" * 8
    client = TestClient(app)
    r = client.get("/api/status", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401
    assert "invalid" in r.json()["error"]


def test_auth_accepts_correct_token():
    tok = "deadbeef" * 8
    app.state.require_bearer_token = tok
    client = TestClient(app)
    r = client.get("/api/status", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200


def test_health_endpoint_is_always_reachable():
    """UI shim probes /api/health before it has the token — must 200 without one."""
    app.state.require_bearer_token = "some-token-we-dont-provide"
    client = TestClient(app)
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "daemonVersion" in body
