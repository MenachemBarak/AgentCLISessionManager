"""Tests for backend.app._activity_for() and the auto-cleanup throttle in
_get_active_session_ids().

These pin two v1.3.3 changes:
1. _activity_for() now returns "idle" for age 15-300 s and None for age >= 300 s
   (previously returned "active" for everything >= 15 s).
2. _get_active_session_ids() auto-evicts stale PID markers every 30 s so the
   STREAMING badge clears without a manual rescan.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import psutil
import pytest

from backend import app as app_mod


# ──────────────────────────────────────────────────────────────────────────────
# _activity_for label ladder
# ──────────────────────────────────────────────────────────────────────────────


def _touch(p: Path, age_seconds: float) -> None:
    """Set p's mtime to `age_seconds` ago."""
    t = time.time() - age_seconds
    os.utime(p, (t, t))


def test_activity_for_streaming(tmp_path: Path) -> None:
    f = tmp_path / "session.jsonl"
    f.write_text("{}", encoding="utf-8")
    _touch(f, 1)
    assert app_mod._activity_for(f) == "streaming"


def test_activity_for_thinking(tmp_path: Path) -> None:
    f = tmp_path / "session.jsonl"
    f.write_text("{}", encoding="utf-8")
    _touch(f, 10)
    assert app_mod._activity_for(f) == "thinking"


def test_activity_for_idle(tmp_path: Path) -> None:
    f = tmp_path / "session.jsonl"
    f.write_text("{}", encoding="utf-8")
    _touch(f, 60)  # 1 minute ago
    assert app_mod._activity_for(f) == "idle"


def test_activity_for_none_when_silent_over_5_min(tmp_path: Path) -> None:
    """Sessions silent for > 5 min return None — no text badge, just the dot."""
    f = tmp_path / "session.jsonl"
    f.write_text("{}", encoding="utf-8")
    _touch(f, 400)  # > 300 s
    assert app_mod._activity_for(f) is None


def test_activity_for_boundary_exactly_3s_is_thinking(tmp_path: Path) -> None:
    f = tmp_path / "session.jsonl"
    f.write_text("{}", encoding="utf-8")
    _touch(f, 3)
    assert app_mod._activity_for(f) == "thinking"


def test_activity_for_boundary_exactly_15s_is_idle(tmp_path: Path) -> None:
    f = tmp_path / "session.jsonl"
    f.write_text("{}", encoding="utf-8")
    _touch(f, 15)
    assert app_mod._activity_for(f) == "idle"


def test_activity_for_boundary_exactly_300s_is_none(tmp_path: Path) -> None:
    f = tmp_path / "session.jsonl"
    f.write_text("{}", encoding="utf-8")
    _touch(f, 300)
    assert app_mod._activity_for(f) is None


# ──────────────────────────────────────────────────────────────────────────────
# Auto-cleanup throttle in _get_active_session_ids()
# ──────────────────────────────────────────────────────────────────────────────


def _write_stale_marker(active_dir: Path) -> Path:
    """Write a marker whose PID is ours but startedAt is 1 hour ago (stale)."""
    active_dir.mkdir(parents=True, exist_ok=True)
    pid = os.getpid()
    wrong_start_ms = int((psutil.Process(pid).create_time() - 3600) * 1000)
    f = active_dir / f"{pid}.json"
    f.write_text(
        json.dumps({"pid": pid, "sessionId": "stale-sid", "startedAt": wrong_start_ms}),
        encoding="utf-8",
    )
    return f


def test_auto_cleanup_runs_when_throttle_expired(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """_get_active_session_ids() sweeps stale markers when > 30 s since last clean."""
    active_dir = tmp_path / "sessions"
    stale = _write_stale_marker(active_dir)
    assert stale.exists()

    monkeypatch.setattr(app_mod, "ACTIVE_DIR", active_dir)
    # Force throttle to look expired (last cleanup was long ago).
    monkeypatch.setattr(app_mod, "_last_active_cleanup", 0.0)

    ids = app_mod._get_active_session_ids()

    assert "stale-sid" not in ids
    assert not stale.exists(), "stale marker must be deleted by auto-cleanup"


def test_auto_cleanup_skipped_when_throttle_fresh(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """_get_active_session_ids() skips cleanup if < 30 s since last clean."""
    active_dir = tmp_path / "sessions"
    stale = _write_stale_marker(active_dir)
    assert stale.exists()

    monkeypatch.setattr(app_mod, "ACTIVE_DIR", active_dir)
    # Pretend cleanup ran 1 second ago — throttle not yet expired.
    monkeypatch.setattr(app_mod, "_last_active_cleanup", time.time() - 1)

    app_mod._get_active_session_ids()

    # Marker still there — _get_active_session_ids skipped cleanup but
    # _is_live_marker must also reject the stale PID so it's not in active set.
    # The file surviving proves cleanup was NOT called.
    assert stale.exists(), "cleanup must be throttled when called recently"
