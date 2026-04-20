"""Deep tests for the `_Watcher` file-system event handler.

Three layers, cheapest → most realistic:

1. `_is_indexable_session_path`: pure predicate covering every filter edge.
2. `_Watcher._upsert` / `_evict`: direct method calls with synthetic paths;
   asserts `_INDEX` mutations and SSE events in-process without spinning up
   an actual watchdog observer.
3. End-to-end with a real `watchdog.observers.Observer`: create a tmpdir
   that mirrors `~/.claude/projects`, point the backend at it via
   `CLAUDE_HOME`, touch + delete files, assert `_INDEX` converges.
"""

from __future__ import annotations

import os
import shutil
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(autouse=True)
def _restore_index(app_module):
    """Snapshot + restore `_INDEX` around every test so tests that mutate it
    (bulk evicts, moves) don't leak state into the next one. Uses the same
    session-scoped `app_module` so we preserve the expensive import cost but
    keep data isolation."""
    snapshot = dict(app_module._INDEX)
    try:
        yield
    finally:
        app_module._INDEX.clear()
        app_module._INDEX.update(snapshot)


# ─────────────────────── Layer 1: predicate ──────────────────────────
def test_predicate_accepts_valid_session(app_module):
    p = app_module.PROJECTS_DIR / "-tmp-demo" / "11111111-1111-4111-8111-111111111111.jsonl"
    assert app_module._is_indexable_session_path(p) is True


def test_predicate_rejects_subagent(app_module):
    p = (
        app_module.PROJECTS_DIR
        / "-tmp-demo"
        / "33333333-3333-4333-8333-333333333333"
        / "subagents"
        / "agent-abcd.jsonl"
    )
    assert app_module._is_indexable_session_path(p) is False


def test_predicate_rejects_non_uuid_name(app_module):
    p = app_module.PROJECTS_DIR / "-tmp-demo" / "not-a-uuid.jsonl"
    assert app_module._is_indexable_session_path(p) is False


def test_predicate_rejects_wrong_extension(app_module):
    p = app_module.PROJECTS_DIR / "-tmp-demo" / "11111111-1111-4111-8111-111111111111.txt"
    assert app_module._is_indexable_session_path(p) is False


def test_predicate_rejects_wrong_depth(app_module):
    # Direct child of PROJECTS_DIR (no project folder) — not indexable.
    p = app_module.PROJECTS_DIR / "11111111-1111-4111-8111-111111111111.jsonl"
    assert app_module._is_indexable_session_path(p) is False


def test_predicate_rejects_path_outside_projects_dir(app_module, tmp_path):
    p = tmp_path / "somewhere-else" / "11111111-1111-4111-8111-111111111111.jsonl"
    assert app_module._is_indexable_session_path(p) is False


# ─────────────────────── Layer 2: direct method calls ────────────────
def test_evict_removes_from_index_and_emits_sse(app_module, monkeypatch):
    sid = "11111111-1111-4111-8111-111111111111"
    # sanity — fixture session is indexed
    assert sid in app_module._INDEX

    captured: list[dict] = []
    monkeypatch.setattr(app_module, "_emit_sse", lambda ev: captured.append(ev))

    watcher = app_module._Watcher()
    path = str(app_module.PROJECTS_DIR / "-tmp-demo" / f"{sid}.jsonl")
    watcher._evict(path)

    assert sid not in app_module._INDEX
    assert captured == [{"type": "session_deleted", "id": sid}]


def test_evict_is_idempotent(app_module, monkeypatch):
    """A second evict on the same path should be a no-op (no SSE, no crash)."""
    captured: list[dict] = []
    monkeypatch.setattr(app_module, "_emit_sse", lambda ev: captured.append(ev))

    watcher = app_module._Watcher()
    missing = str(app_module.PROJECTS_DIR / "-tmp-demo" / "deadbeef-dead-4bee-8bee-deadbeefdead.jsonl")
    watcher._evict(missing)
    watcher._evict(missing)
    assert captured == []


def test_evict_ignores_non_indexable_paths(app_module, monkeypatch):
    captured: list[dict] = []
    monkeypatch.setattr(app_module, "_emit_sse", lambda ev: captured.append(ev))

    watcher = app_module._Watcher()
    subagent = str(
        app_module.PROJECTS_DIR
        / "-tmp-demo"
        / "33333333-3333-4333-8333-333333333333"
        / "subagents"
        / "agent-abcd.jsonl"
    )
    watcher._evict(subagent)
    assert captured == []


def test_on_deleted_directory_bulk_evicts_contained_sessions(app_module, monkeypatch):
    """Deleting a whole project folder evicts every session underneath it."""
    sid1 = "11111111-1111-4111-8111-111111111111"
    sid2 = "22222222-2222-4222-8222-222222222222"
    assert sid1 in app_module._INDEX and sid2 in app_module._INDEX

    captured: list[dict] = []
    monkeypatch.setattr(app_module, "_emit_sse", lambda ev: captured.append(ev))

    class FakeEvent:
        is_directory = True
        src_path = str(app_module.PROJECTS_DIR / "-tmp-demo")

    watcher = app_module._Watcher()
    watcher.on_deleted(FakeEvent())

    assert sid1 not in app_module._INDEX
    assert sid2 not in app_module._INDEX
    evicted_ids = {e["id"] for e in captured if e.get("type") == "session_deleted"}
    assert evicted_ids == {sid1, sid2}


def test_on_moved_evicts_src_and_upserts_dest(app_module, monkeypatch, tmp_path):
    sid = "11111111-1111-4111-8111-111111111111"
    new_id = "99999999-9999-4999-8999-999999999999"

    # Create a file at the new path so _upsert can stat it.
    new_dir = app_module.PROJECTS_DIR / "-tmp-demo"
    new_dir.mkdir(parents=True, exist_ok=True)
    src_path = new_dir / f"{sid}.jsonl"
    dest_path = new_dir / f"{new_id}.jsonl"
    shutil.copy(src_path, dest_path)

    captured: list[dict] = []
    monkeypatch.setattr(app_module, "_emit_sse", lambda ev: captured.append(ev))

    class FakeEvent:
        is_directory = False
        src_path = str(new_dir / f"{sid}.jsonl")
        dest_path = str(new_dir / f"{new_id}.jsonl")

    watcher = app_module._Watcher()
    watcher.on_moved(FakeEvent())
    try:
        assert sid not in app_module._INDEX, "source should be evicted"
        assert new_id in app_module._INDEX, "destination should be upserted"
        types = [e["type"] for e in captured]
        assert "session_deleted" in types
        assert "session_created" in types
    finally:
        dest_path.unlink(missing_ok=True)
        app_module._INDEX.pop(new_id, None)


# ─────────────────────── Layer 3: end-to-end with real watchdog ──────
@pytest.fixture()
def live_home(tmp_path_factory):
    """Spin up a fresh CLAUDE_HOME with no fixture data, start the real
    watchdog observer, yield (app_module, projects_dir). Teardown stops
    the observer and restores CLAUDE_HOME for other tests.
    """
    import importlib

    home = tmp_path_factory.mktemp("live-claude-home")
    (home / "projects").mkdir()
    prev_env = os.environ.get("CLAUDE_HOME")
    os.environ["CLAUDE_HOME"] = str(home)

    # Re-import so module-level CLAUDE_HOME picks up the new env.
    sys.path.insert(0, str(ROOT))
    for name in list(sys.modules):
        if name.startswith("backend"):
            del sys.modules[name]
    import backend.app as live
    importlib.reload(live)

    # Wire up the SSE event loop so _emit_sse has somewhere to send.
    import asyncio

    loop = asyncio.new_event_loop()
    live._event_queue = asyncio.Queue()
    live._event_loop = loop

    live.start_watcher()

    yield live, home / "projects"

    if live._observer:
        live._observer.stop()
        live._observer.join(timeout=2)

    loop.close()
    if prev_env is None:
        os.environ.pop("CLAUDE_HOME", None)
    else:
        os.environ["CLAUDE_HOME"] = prev_env


def _wait_until(predicate, timeout=4.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


def test_live_watchdog_creates_and_deletes_a_session(live_home):
    live, projects = live_home
    proj = projects / "-live-demo"
    proj.mkdir()

    sid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    session_path = proj / f"{sid}.jsonl"
    session_path.write_text(
        '{"type":"user","cwd":"/tmp/live","message":{"content":"hello live"}}\n',
        encoding="utf-8",
    )

    assert _wait_until(lambda: sid in live._INDEX), (
        f"watchdog should have added {sid} to _INDEX; current keys: {list(live._INDEX)}"
    )

    # Now delete and confirm eviction
    session_path.unlink()
    assert _wait_until(lambda: sid not in live._INDEX), (
        f"watchdog should have evicted {sid} from _INDEX; current keys: {list(live._INDEX)}"
    )


def test_live_watchdog_deletes_via_endpoint(live_home):
    """Full loop: create file → appears in /api/sessions → delete file → vanishes."""
    from fastapi.testclient import TestClient

    live, projects = live_home
    proj = projects / "-api-demo"
    proj.mkdir()
    sid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    session_path = proj / f"{sid}.jsonl"
    session_path.write_text(
        '{"type":"user","cwd":"/tmp/api","message":{"content":"hello api"}}\n',
        encoding="utf-8",
    )

    client = TestClient(live.app)
    assert _wait_until(lambda: sid in {s["id"] for s in client.get("/api/sessions").json()["items"]})

    session_path.unlink()
    assert _wait_until(lambda: sid not in {s["id"] for s in client.get("/api/sessions").json()["items"]})
