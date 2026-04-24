"""Pin-session-to-top tests."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from backend.app import LABELS_FILE, app


@pytest.fixture
def client():
    app.state.require_bearer_token = None
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean_labels():
    """Wipe any pin state the test writes so it doesn't leak to the
    next test (or to the real user install when running from a dev
    checkout against ~/.claude)."""
    yield
    try:
        if LABELS_FILE.exists():
            data = json.loads(LABELS_FILE.read_text(encoding="utf-8"))
            for sid, entry in list(data.items()):
                if isinstance(entry, dict) and entry.get("pinned"):
                    entry.pop("pinned", None)
                    entry.pop("pinnedAt", None)
                    if not entry:
                        data.pop(sid, None)
            LABELS_FILE.write_text(json.dumps(data), encoding="utf-8")
    except Exception:
        pass


def _first_sid(client):
    r = client.get("/api/sessions")
    items = r.json()["items"]
    assert items, "fixture must have at least one session"
    return items[0]["id"]


def test_pin_sets_pinned_flag(client):
    sid = _first_sid(client)
    r = client.post(f"/api/sessions/{sid}/pin", json={"pinned": True})
    assert r.status_code == 200
    assert r.json() == {"id": sid, "pinned": True}


def test_unpin_clears_pinned_flag(client):
    sid = _first_sid(client)
    client.post(f"/api/sessions/{sid}/pin", json={"pinned": True})
    r = client.post(f"/api/sessions/{sid}/pin", json={"pinned": False})
    assert r.status_code == 200
    assert r.json() == {"id": sid, "pinned": False}


def test_pinned_session_sorts_first_in_list(client):
    # Pin the LAST (oldest) session. It should jump to the top.
    r = client.get("/api/sessions")
    items = r.json()["items"]
    if len(items) < 2:
        pytest.skip("fixture has fewer than 2 sessions — can't verify sort")
    last = items[-1]
    client.post(f"/api/sessions/{last['id']}/pin", json={"pinned": True})

    r2 = client.get("/api/sessions")
    items2 = r2.json()["items"]
    assert items2[0]["id"] == last["id"]
    assert items2[0]["pinned"] is True
    # Everything else keeps recency order among unpinned.
    for item in items2[1:]:
        assert not item.get("pinned")


def test_pinned_is_returned_in_search_results(client):
    sid = _first_sid(client)
    client.post(f"/api/sessions/{sid}/pin", json={"pinned": True})

    # Search for any broad token the fixture has.
    r = client.get("/api/search", params={"q": "session"})
    if r.json()["total"] == 0:
        pytest.skip("fixture doesn't match the generic search term")
    items = r.json()["items"]
    # Find our pinned session's row.
    match = next((x for x in items if x["id"] == sid), None)
    if match:
        assert match.get("pinned") is True


def test_pin_is_auth_gated_in_daemon_mode(client):
    sid = _first_sid(client)
    app.state.require_bearer_token = "deadbeef" * 8
    try:
        r = client.post(f"/api/sessions/{sid}/pin", json={"pinned": True})
        assert r.status_code == 401
    finally:
        app.state.require_bearer_token = None


def test_pin_coexists_with_userlabel(client):
    sid = _first_sid(client)
    # Set both a label and pinned — neither should clobber the other.
    client.put(f"/api/sessions/{sid}/label", json={"userLabel": "my label"})
    client.post(f"/api/sessions/{sid}/pin", json={"pinned": True})

    r = client.get("/api/sessions")
    row = next(x for x in r.json()["items"] if x["id"] == sid)
    assert row["userLabel"] == "my label"
    assert row["pinned"] is True

    # Clearing the label should NOT unpin.
    client.put(f"/api/sessions/{sid}/label", json={"userLabel": None})
    r2 = client.get("/api/sessions")
    row2 = next(x for x in r2.json()["items"] if x["id"] == sid)
    assert row2["userLabel"] is None
    assert row2["pinned"] is True
