"""Backend API tests against a mocked CLAUDE_HOME fixture.

These tests require no Claude Code install, no tokens, and no real sessions —
they exercise the full FastAPI surface against two sample JSONL files plus a
sub-agent file that must be filtered out.
"""

from __future__ import annotations

SID_ONE = "11111111-1111-4111-8111-111111111111"
SID_TWO = "22222222-2222-4222-8222-222222222222"
SUBAGENT_PARENT = "33333333-3333-4333-8333-333333333333"


def test_status_ready(client):
    r = client.get("/api/status")
    assert r.status_code == 200
    body = r.json()
    assert body["ready"] is True
    assert body["phase"] == "ready"


def test_status_exposes_version(client, app_module):
    body = client.get("/api/status").json()
    assert body["version"] == app_module.__version__
    # Must look like semver.
    parts = body["version"].split(".")
    assert len(parts) == 3
    assert all(p.isdigit() for p in parts)


def test_list_sessions_excludes_subagents(client):
    r = client.get("/api/sessions")
    assert r.status_code == 200
    body = r.json()
    ids = {s["id"] for s in body["items"]}
    assert SID_ONE in ids
    assert SID_TWO in ids
    # Sub-agent files must never leak into resumable session list.
    assert SUBAGENT_PARENT not in ids
    assert not any("agent-" in s["id"] for s in body["items"])


def test_session_fields(client):
    body = client.get("/api/sessions").json()
    s = next(x for x in body["items"] if x["id"] == SID_ONE)
    assert s["cwd"] == "/tmp/demo"
    assert s["branch"] == "main"
    assert s["model"].startswith("claude")
    assert s["title"].startswith("Hello from mock")
    # custom-title tail scan
    assert s["claudeTitle"] == "Mock Renamed One"
    assert s["active"] is False


def test_preview_returns_first_user_messages(client):
    r = client.get(f"/api/sessions/{SID_ONE}/preview")
    assert r.status_code == 200
    body = r.json()
    assert len(body["firstUserMessages"]) >= 2
    assert body["firstUserMessages"][0].startswith("Hello from mock")


def test_transcript_filters_meta_and_returns_roles(client):
    r = client.get(f"/api/sessions/{SID_ONE}/transcript")
    assert r.status_code == 200
    msgs = r.json()["messages"]
    assert {m["role"] for m in msgs} <= {"user", "assistant"}
    assert any(m["role"] == "assistant" for m in msgs)


def test_user_label_roundtrip(client):
    # clean
    client.put(f"/api/sessions/{SID_ONE}/label", json={"userLabel": None})
    assert client.get(f"/api/sessions/{SID_ONE}/label").json()["userLabel"] is None

    # set
    r = client.put(f"/api/sessions/{SID_ONE}/label", json={"userLabel": "my-label"})
    assert r.status_code == 200
    assert r.json()["userLabel"] == "my-label"

    # survives: list endpoint carries it
    items = client.get("/api/sessions").json()["items"]
    s = next(x for x in items if x["id"] == SID_ONE)
    assert s["userLabel"] == "my-label"

    # clear
    client.put(f"/api/sessions/{SID_ONE}/label", json={"userLabel": None})


def test_unknown_session_404(client):
    assert client.get("/api/sessions/deadbeef-dead-4bee-8bee-deadbeefdead/preview").status_code == 404
    assert client.get("/api/sessions/deadbeef-dead-4bee-8bee-deadbeefdead/transcript").status_code == 404


def test_open_session_not_windows_returns_501(client, app_module, monkeypatch):
    """On non-Windows CI, /api/open must degrade gracefully, not crash."""
    monkeypatch.setattr(app_module, "IS_WINDOWS", False)
    r = client.post("/api/open", json={"sessionId": SID_ONE, "mode": "tab"})
    assert r.status_code in (501, 404)  # 404 if index hasn't seen it yet


def test_open_session_rejects_non_uuid_id(client, app_module, monkeypatch):
    """Defense-in-depth: even on Windows, a non-UUID sessionId must be rejected
    before reaching subprocess. Guards against CodeQL 'uncontrolled command line'."""
    monkeypatch.setattr(app_module, "IS_WINDOWS", True)
    # Inject a bogus session into the index so the 404 guard passes and we
    # exercise the UUID validator.
    app_module._INDEX["not-a-uuid; rm -rf /"] = {  # noqa: S101
        "id": "not-a-uuid; rm -rf /",
        "cwd": "/tmp/demo",
        "path": str(app_module.PROJECTS_DIR / "-tmp-demo" / f"{SID_ONE}.jsonl"),
    }
    try:
        r = client.post("/api/open", json={"sessionId": "not-a-uuid; rm -rf /", "mode": "tab"})
        assert r.status_code == 400
        assert "UUID" in r.json()["detail"]
    finally:
        app_module._INDEX.pop("not-a-uuid; rm -rf /", None)


def test_open_session_rejects_bad_mode(client, app_module, monkeypatch):
    monkeypatch.setattr(app_module, "IS_WINDOWS", True)
    r = client.post("/api/open", json={"sessionId": SID_ONE, "mode": "evil; cmd"})
    assert r.status_code == 400


def test_hook_status_reports_paths(client):
    r = client.get("/api/hook/status")
    assert r.status_code == 200
    body = r.json()
    assert "installed" in body
    assert body["settingsFile"].endswith("settings.json")
