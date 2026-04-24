"""Phase 3b unit tests — daemon probe + detached spawn + --probe-daemon CLI.

Covers ADR-18 / Task #42 Phase 3b surface area that can be exercised
without a real daemon process: classification logic, socket squatting,
CLI exit-code contract.
"""

from __future__ import annotations

import socket
import sys
import threading
import time

from backend import cli
from daemon.launcher import probe, spawn_detached, wait_for_health


def _free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _start_fake_server(
    port: int, health_body: bytes | None = b'{"ok":true,"daemonVersion":"1.2.3"}'
) -> threading.Thread:
    """Tiny in-process HTTP server on the given port. If health_body is
    None, the server answers 404 instead of returning the health JSON —
    simulates "port held but not our daemon"."""
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path == "/api/health" and health_body is not None:
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(health_body)))
                self.end_headers()
                self.wfile.write(health_body)
            else:
                self.send_response(404)
                self.send_header("content-length", "0")
                self.end_headers()

        def log_message(self, *_a, **_k):  # silence noise
            pass

    srv = HTTPServer(("127.0.0.1", port), Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    t.server = srv  # type: ignore[attr-defined]
    # tiny wait for the listener to be bound
    time.sleep(0.05)
    return t


def test_probe_absent_returns_state_absent():
    """No listener on a random free port → state == 'absent'."""
    port = _free_loopback_port()
    r = probe(port, timeout=0.5)
    assert r["state"] == "absent"


def test_probe_ours_when_health_returns_correct_shape():
    port = _free_loopback_port()
    t = _start_fake_server(port, b'{"ok":true,"daemonVersion":"9.9.9"}')
    try:
        r = probe(port, timeout=1.0)
        assert r["state"] == "ours"
        assert r.get("daemonVersion") == "9.9.9"
    finally:
        t.server.shutdown()  # type: ignore[attr-defined]


def test_probe_other_when_port_answers_404():
    """Port held by something that isn't our daemon → state == 'other'."""
    port = _free_loopback_port()
    t = _start_fake_server(port, None)
    try:
        r = probe(port, timeout=1.0)
        assert r["state"] == "other"
    finally:
        t.server.shutdown()  # type: ignore[attr-defined]


def test_probe_other_when_health_body_is_wrong_shape():
    port = _free_loopback_port()
    t = _start_fake_server(port, b'{"unexpected":"shape"}')
    try:
        r = probe(port, timeout=1.0)
        assert r["state"] == "other"
    finally:
        t.server.shutdown()  # type: ignore[attr-defined]


def test_wait_for_health_times_out_cleanly():
    port = _free_loopback_port()
    t0 = time.monotonic()
    ok = wait_for_health(port, timeout=0.8)
    elapsed = time.monotonic() - t0
    assert ok is False
    assert elapsed < 2.0  # bounded


def test_spawn_detached_runs_a_command(tmp_path):
    """Smoke test — spawn a short-lived child and confirm PID was returned."""
    marker = tmp_path / "spawned.txt"
    # Use python itself so this works on every CI runner.
    argv = [sys.executable, "-c", f"open(r'{marker}', 'w').write('ok')"]
    pid = spawn_detached(argv)
    assert isinstance(pid, int) and pid > 0
    # Wait for marker; give it generous time on slow CI.
    for _ in range(60):
        if marker.exists():
            break
        time.sleep(0.1)
    assert marker.exists(), "spawned child never wrote its marker"


# ─────────────────────── CLI contract ───────────────────────


def test_cli_probe_daemon_absent_returns_1(capsys):
    port = _free_loopback_port()
    rc = cli.main(["--probe-daemon", "--port", str(port)])
    assert rc == 1
    err = capsys.readouterr().err
    assert "absent" in err


def test_cli_probe_daemon_ours_returns_0(capsys):
    port = _free_loopback_port()
    t = _start_fake_server(port, b'{"ok":true,"daemonVersion":"4.5.6"}')
    try:
        rc = cli.main(["--probe-daemon", "--port", str(port)])
        assert rc == 0
        out = capsys.readouterr().out
        assert "4.5.6" in out
    finally:
        t.server.shutdown()  # type: ignore[attr-defined]


def test_cli_probe_daemon_other_returns_3(capsys):
    port = _free_loopback_port()
    t = _start_fake_server(port, None)  # 404 on /api/health
    try:
        rc = cli.main(["--probe-daemon", "--port", str(port)])
        assert rc == 3
        err = capsys.readouterr().err
        assert "unrelated" in err or f"port {port}" in err
    finally:
        t.server.shutdown()  # type: ignore[attr-defined]
