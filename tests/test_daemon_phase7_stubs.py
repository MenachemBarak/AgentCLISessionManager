"""Phase 7/9 contract tests for the dual-asset update API.

Phase 7: endpoints existed as 501 stubs.
Phase 9: apply-ui-only is real; in non-frozen/non-daemon test env it
returns 200 {"ok": false} with a reason message instead of 501.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app import app


@pytest.fixture
def client():
    app.state.require_bearer_token = None
    return TestClient(app)


def test_apply_ui_only_endpoint_exists_and_responds(client):
    # Phase 9: endpoint is implemented. In the test env (not frozen, not
    # daemon mode) it returns 200 with ok=False and a message.
    r = client.post("/api/update/apply-ui-only")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert "message" in body


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
