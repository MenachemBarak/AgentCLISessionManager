"""PID-reuse defense for active-session markers.

Windows recycles PIDs quickly. When a PowerShell hosting `claude` is
closed, its PID frees and the OS may reassign it to an unrelated
process within seconds. Before this fix, `psutil.pid_exists(pid)`
returned True for the new owner and the marker stayed flagged as an
"active" claude session forever — including across explicit rescans.

These tests pin the fix in `backend.app._is_live_marker` which
cross-checks the process's actual `create_time()` against the marker's
recorded `startedAt`. They use the current process as a stand-in for a
claude PID (we can trust we can read our own start time).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import psutil
import pytest

from backend import app as app_mod


def _write_marker(active_dir: Path, *, pid: int, started_at_ms: int, sid: str = "00000000-0000-4000-8000-000000000001") -> Path:
    """Drop a Claude-Code-style active marker into `active_dir`."""
    active_dir.mkdir(parents=True, exist_ok=True)
    p = active_dir / f"{pid}.json"
    p.write_text(json.dumps({
        "pid": pid,
        "sessionId": sid,
        "startedAt": started_at_ms,
        "version": "test",
    }), encoding="utf-8")
    return p


@pytest.fixture
def tmp_active_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    d = tmp_path / "sessions"
    monkeypatch.setattr(app_mod, "ACTIVE_DIR", d)
    return d


def test_live_pid_with_matching_started_at_is_active(tmp_active_dir: Path) -> None:
    # Our own PID is guaranteed alive; use its real create_time() so the
    # startedAt in the marker matches what psutil reports.
    pid = os.getpid()
    start_ms = int(psutil.Process(pid).create_time() * 1000)
    _write_marker(tmp_active_dir, pid=pid, started_at_ms=start_ms, sid="alive-sid")

    active = app_mod._get_active_session_ids()
    assert active == {"alive-sid"}


def test_dead_pid_not_active(tmp_active_dir: Path) -> None:
    # PID 0 (or any huge, unlikely-to-exist PID) → pid_exists is False.
    # Cross-platform-safe: use a PID that's definitely not alive.
    dead_pid = 2**30  # far above practical Linux/Windows PID ranges
    assert not psutil.pid_exists(dead_pid)
    _write_marker(tmp_active_dir, pid=dead_pid, started_at_ms=1_000_000_000_000, sid="dead-sid")

    assert app_mod._get_active_session_ids() == set()


def test_recycled_pid_rejected_by_started_at_mismatch(tmp_active_dir: Path) -> None:
    # Simulate PID reuse: the marker's PID IS alive (ours), but the
    # marker claims it started at a wildly different time. The defense
    # must reject the marker as stale even though pid_exists=True.
    pid = os.getpid()
    # 1 hour ago in ms — well outside the tolerance window.
    wrong_start_ms = int((psutil.Process(pid).create_time() - 3600) * 1000)
    _write_marker(tmp_active_dir, pid=pid, started_at_ms=wrong_start_ms, sid="recycled-sid")

    assert app_mod._get_active_session_ids() == set()


def test_cleanup_removes_recycled_marker(tmp_active_dir: Path) -> None:
    pid = os.getpid()
    wrong_start_ms = int((psutil.Process(pid).create_time() - 3600) * 1000)
    path = _write_marker(tmp_active_dir, pid=pid, started_at_ms=wrong_start_ms, sid="recycled-sid")
    assert path.exists()

    removed = app_mod._cleanup_stale_active_markers()
    assert removed == 1
    assert not path.exists()


def test_cleanup_keeps_live_marker(tmp_active_dir: Path) -> None:
    pid = os.getpid()
    start_ms = int(psutil.Process(pid).create_time() * 1000)
    path = _write_marker(tmp_active_dir, pid=pid, started_at_ms=start_ms, sid="alive-sid")

    removed = app_mod._cleanup_stale_active_markers()
    assert removed == 0
    assert path.exists()


def test_legacy_marker_without_started_at_falls_back_to_pid_check(tmp_active_dir: Path) -> None:
    # Markers written by pre-Claude-Code-2.x didn't include startedAt.
    # To avoid false-dropping those, we fall back to the old
    # pid_exists-only behavior for them (accepting the old PID-reuse
    # vulnerability until the session writes a fresh marker).
    pid = os.getpid()
    tmp_active_dir.mkdir(parents=True, exist_ok=True)
    (tmp_active_dir / f"{pid}.json").write_text(
        json.dumps({"pid": pid, "sessionId": "legacy-sid"}),
        encoding="utf-8",
    )

    assert app_mod._get_active_session_ids() == {"legacy-sid"}
