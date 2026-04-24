"""Phase 3c unit tests — _launch_daemon_mode probe/spawn/webview branches.

Uses a fake webview module so the tests don't actually open a window.
"""

from __future__ import annotations

import pytest


class FakeWebview:
    def __init__(self) -> None:
        self.create_calls: list[dict] = []
        self.start_called = False

    def create_window(self, **kwargs):
        self.create_calls.append(kwargs)

    def start(self):
        self.start_called = True


@pytest.fixture
def fake_webview():
    return FakeWebview()


def test_daemon_mode_other_returns_3(monkeypatch, fake_webview, capsys):
    monkeypatch.setattr("daemon.launcher.probe", lambda port=8765: {"state": "other", "httpStatus": 500})
    from backend.cli import _launch_daemon_mode

    rc = _launch_daemon_mode(fake_webview)
    assert rc == 3
    assert "unrelated process" in capsys.readouterr().err
    assert fake_webview.create_calls == []


def test_daemon_mode_absent_spawns_then_waits(monkeypatch, fake_webview):
    """When probe returns absent, launcher spawns the daemon + waits for health + opens webview."""
    spawned: list[list[str]] = []

    def fake_probe(port=8765):
        return {"state": "absent", "error": "connect_ex=111"}

    def fake_spawn(argv, env=None):
        spawned.append(list(argv))
        return 12345

    def fake_wait(port=8765, timeout=15.0):
        return True

    def fake_token():
        return "deadbeef" * 8

    monkeypatch.setattr("daemon.launcher.probe", fake_probe)
    monkeypatch.setattr("daemon.launcher.spawn_detached", fake_spawn)
    monkeypatch.setattr("daemon.launcher.wait_for_health", fake_wait)
    monkeypatch.setattr("daemon.bootstrap.read_or_create_token", fake_token)

    from backend.cli import _launch_daemon_mode

    rc = _launch_daemon_mode(fake_webview)
    assert rc == 0
    # Spawned our own daemon module.
    assert any("daemon" in a for argv in spawned for a in argv)
    # Webview opened with a fragment carrying the token.
    assert len(fake_webview.create_calls) == 1
    url = fake_webview.create_calls[0]["url"]
    assert url.startswith("http://127.0.0.1:8765/")
    assert "#token=" in url
    assert "deadbeef" in url
    assert fake_webview.start_called is True


def test_daemon_mode_ours_skips_spawn(monkeypatch, fake_webview):
    """When probe returns 'ours', launcher connects without spawning."""
    spawned: list[list[str]] = []

    monkeypatch.setattr("daemon.launcher.probe", lambda port=8765: {"state": "ours", "daemonVersion": "1.2.0"})
    monkeypatch.setattr("daemon.launcher.spawn_detached", lambda argv, env=None: spawned.append(argv) or 0)
    monkeypatch.setattr("daemon.launcher.wait_for_health", lambda port=8765, timeout=15.0: True)
    monkeypatch.setattr("daemon.bootstrap.read_or_create_token", lambda: "feedface" * 8)

    from backend.cli import _launch_daemon_mode

    rc = _launch_daemon_mode(fake_webview)
    assert rc == 0
    assert spawned == [], "must not spawn a daemon when one is already ours"
    assert fake_webview.start_called is True


def test_daemon_mode_wait_for_health_timeout_returns_1(monkeypatch, fake_webview, capsys):
    monkeypatch.setattr("daemon.launcher.probe", lambda port=8765: {"state": "absent"})
    monkeypatch.setattr("daemon.launcher.spawn_detached", lambda argv, env=None: 123)
    monkeypatch.setattr("daemon.launcher.wait_for_health", lambda port=8765, timeout=15.0: False)

    from backend.cli import _launch_daemon_mode

    rc = _launch_daemon_mode(fake_webview)
    assert rc == 1
    assert "failed to come up" in capsys.readouterr().err
