"""Tests for the self-update flow.

These don't touch the network or real exes — we drive the in-memory
STATE directly and verify the HTTP surface + apply_update's guards.
"""

from __future__ import annotations

import sys


def test_update_status_when_unchecked_has_safe_defaults(client):
    r = client.get("/api/update-status")
    assert r.status_code == 200
    body = r.json()
    # Shape contract — the banner reads these exact keys.
    for key in (
        "currentVersion",
        "latestVersion",
        "updateAvailable",
        "checked",
        "downloadProgress",
        "staged",
    ):
        assert key in body
    assert isinstance(body["updateAvailable"], bool)
    assert isinstance(body["staged"], bool)


def test_update_status_reflects_seeded_state(client, app_module):
    updater = app_module.updater
    prev = updater.STATE.snapshot()
    with updater.STATE.lock:
        updater.STATE.checked = True
        updater.STATE.latest_version = "99.99.99"
    try:
        body = client.get("/api/update-status").json()
        assert body["checked"] is True
        assert body["latestVersion"] == "99.99.99"
        assert body["updateAvailable"] is True
    finally:
        with updater.STATE.lock:
            updater.STATE.checked = prev["checked"]
            updater.STATE.latest_version = prev["latestVersion"]


def test_post_update_check_returns_fresh_snapshot(client, app_module, monkeypatch):
    """`POST /api/update/check` must call check_for_updates synchronously
    and return the resulting snapshot — not the cached one. We mock the
    network call so the test is hermetic."""
    updater = app_module.updater
    called = {"count": 0}

    def fake_check() -> None:
        called["count"] += 1
        with updater.STATE.lock:
            updater.STATE.checked = True
            updater.STATE.latest_version = "9.9.9"

    monkeypatch.setattr(updater, "check_for_updates", fake_check)

    r = client.post("/api/update/check")
    assert r.status_code == 200
    body = r.json()
    assert called["count"] == 1, "check_for_updates was not invoked"
    assert body["latestVersion"] == "9.9.9"
    assert body["updateAvailable"] is True


def test_start_periodic_recheck_is_idempotent(app_module):
    """Calling start_periodic_recheck twice must not spawn two threads —
    a daemon double-spawn would burn 2× the GitHub rate limit forever."""
    updater = app_module.updater
    # Reset module flag so the test is self-contained.
    with updater._recheck_lock:
        updater._recheck_started = False
    import threading as _t

    before = sum(1 for t in _t.enumerate() if t.name == "cs-updater-recheck")
    updater.start_periodic_recheck(interval_seconds=3600)
    updater.start_periodic_recheck(interval_seconds=3600)
    after = sum(1 for t in _t.enumerate() if t.name == "cs-updater-recheck")
    assert after - before == 1, f"expected 1 recheck thread spawned, got {after - before}"


def test_apply_refuses_in_dev_mode(client, app_module):
    # sys.frozen is False under pytest — apply must refuse rather than
    # spawn a swap helper that would target the python interpreter.
    assert not getattr(sys, "frozen", False)
    r = client.post("/api/update/apply")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    msg = body.get("message", "")
    # Either the windows-only or dev-mode guard is acceptable; both
    # protect the dev from self-destruction.
    assert "windows" in msg.lower() or "packaged" in msg.lower()


def test_apply_update_without_staged_refuses(app_module, monkeypatch):
    updater = app_module.updater
    # Force the two early guards to pass so we reach the staged-check.
    import platform as _platform

    monkeypatch.setattr(_platform, "system", lambda: "Windows")
    monkeypatch.setattr(updater.sys, "frozen", True, raising=False)
    with updater.STATE.lock:
        prev_staged = updater.STATE.staged_path
        updater.STATE.staged_path = None
    try:
        result = updater.apply_update()
    finally:
        with updater.STATE.lock:
            updater.STATE.staged_path = prev_staged
    assert result["ok"] is False
    assert "staged" in result["message"].lower()


def test_swap_script_structure(app_module, tmp_path):
    updater = app_module.updater
    exe = tmp_path / "cs-viewer.exe"
    staged = tmp_path / "cs-viewer.exe.new"
    log = tmp_path / "swap.log"
    script = updater._windows_swap_script(exe, staged, 12345, log)
    # Essential invariants for the rename-attempt swap:
    # 1. pid is in the log line as a breadcrumb only
    assert "pid 12345" in script
    # 2. live→.old rename is used as the readiness signal (retries until
    #    the exe lock clears), NOT `tasklist | find` which is unreliable.
    assert "tasklist" not in script, "tasklist-based PID polling is known-broken on some cmd versions"
    assert f'ren "{exe}" "{exe.name}.old" >nul 2>&1' in script
    # 3. new promotion renames staged → live
    assert f'ren "{staged}" "{exe.name}"' in script
    # 4. bounded retry so a stuck shutdown can't hang the user forever
    assert "ATTEMPT" in script
    assert "GEQ 60" in script, "must cap the retry loop"
    # 5. relaunch + self-delete
    assert f'start "" "{exe}"' in script
    assert 'del "%~f0"' in script
    # 6. rollback branch — if the staged rename fails we restore the
    #    original so the user is never left with no app.
    assert f'ren "{exe}.old" "{exe.name}"' in script
