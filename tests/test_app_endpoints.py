"""Endpoint smoke tests for backend.app.

Covers health/status/providers/update-status/layout-state — small,
hermetic endpoints that previously contributed almost no coverage but
exercise core glue code (FastAPI middleware, lifespan, response
shaping). Lifts backend/app.py coverage modestly.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_status_returns_version_and_index_progress(app_module) -> None:
    client = TestClient(app_module.app)
    r = client.get("/api/status")
    assert r.status_code == 200
    body = r.json()
    assert "version" in body
    assert "ready" in body
    assert "phase" in body


def test_health_returns_ok(app_module) -> None:
    client = TestClient(app_module.app)
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True


def test_providers_lists_at_least_claude_code(app_module) -> None:
    client = TestClient(app_module.app)
    r = client.get("/api/providers")
    assert r.status_code == 200
    body = r.json()
    assert "registered" in body
    ids = {p["id"] for p in body["registered"]}
    assert "claude-code" in ids


def test_update_status_returns_canonical_shape(app_module) -> None:
    client = TestClient(app_module.app)
    r = client.get("/api/update-status")
    assert r.status_code == 200
    body = r.json()
    for key in [
        "currentVersion",
        "latestVersion",
        "updateAvailable",
        "checked",
        "error",
        "downloadProgress",
        "staged",
    ]:
        assert key in body, f"{key} missing from /api/update-status"


def test_layout_state_get_then_put_roundtrip(app_module) -> None:
    client = TestClient(app_module.app)
    # Empty roundtrip: PUT empty, GET back empty.
    r = client.put(
        "/api/layout-state",
        json={
            "terminals": [],
            "activeId": "transcript",
            "focusedPaneId": None,
        },
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True

    r2 = client.get("/api/layout-state")
    assert r2.status_code == 200
    body = r2.json()
    assert body.get("terminals") == []
    assert body.get("activeId") in (None, "transcript")


def test_layout_state_put_with_a_terminal_persists(app_module) -> None:
    client = TestClient(app_module.app)
    payload = {
        "terminals": [
            {
                "id": "term-1",
                "label": "smoke",
                "tree": {"kind": "pane", "id": "p1", "spawn": {"cmd": ["cmd.exe"]}},
            }
        ],
        "activeId": "term-1",
        "focusedPaneId": "p1",
    }
    r = client.put("/api/layout-state", json=payload)
    assert r.status_code == 200

    r2 = client.get("/api/layout-state")
    body = r2.json()
    assert len(body.get("terminals") or []) == 1
    assert body["activeId"] == "term-1"


def test_rescan_ok(app_module) -> None:
    client = TestClient(app_module.app)
    r = client.post("/api/rescan")
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert "staleActiveMarkersRemoved" in body


def test_status_phase_after_rescan(app_module) -> None:
    client = TestClient(app_module.app)
    client.post("/api/rescan")
    r = client.get("/api/status")
    assert r.status_code == 200
    assert r.json().get("phase") in ("ready", "indexing")
