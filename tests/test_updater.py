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
    # Essential invariants: waits for PID, swaps in the right order,
    # relaunches, self-deletes. A reordering would break the atomic swap.
    assert "PID eq 12345" in script
    assert f'ren "{exe}" "{exe.name}.old"' in script
    assert f'ren "{staged}" "{exe.name}"' in script
    assert f'start "" "{exe}"' in script
    assert 'del "%~f0"' in script
    # Rollback branch present — if the second rename fails we restore
    # the original exe so the user isn't left with no app at all.
    assert f'ren "{exe}.old" "{exe.name}"' in script
