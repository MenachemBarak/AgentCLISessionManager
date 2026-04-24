"""Phase 7 stub tests — contract guard for the dual-asset update API.

Asserts the two new endpoints exist and return a machine-parseable 501
with `code=DAEMON_NOT_SPLIT` until Phase 9 ships the two-binary build.
Locks the API shape so frontend code + e2e fixtures can target a
stable contract today.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app import app


@pytest.fixture
def client():
    app.state.require_bearer_token = None
    return TestClient(app)


def test_apply_ui_only_returns_501_with_reason_code(client):
    r = client.post("/api/update/apply-ui-only")
    assert r.status_code == 501
    body = r.json()
    # FastAPI wraps HTTPException(detail=dict) as {"detail": {...}}.
    detail = body["detail"]
    assert detail["code"] == "DAEMON_NOT_SPLIT"
    assert "Phase 9" in detail["message"]


def test_apply_daemon_returns_501_with_reason_code(client):
    r = client.post("/api/update/apply-daemon")
    assert r.status_code == 501
    body = r.json()
    detail = body["detail"]
    assert detail["code"] == "DAEMON_NOT_SPLIT"


def test_legacy_apply_endpoint_still_responds(client):
    # Not a full apply test (no staged update) — just prove the route
    # is still reachable and we haven't broken the non-daemon path.
    r = client.post("/api/update/apply")
    # 200 with ok:false is acceptable (no staged update). 503 is also
    # acceptable depending on state. What we're asserting: the route
    # wasn't accidentally removed when we added the split stubs.
    assert r.status_code in (200, 400, 503)
