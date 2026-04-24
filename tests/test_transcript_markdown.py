"""Tests for the transcript markdown export endpoint."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app import app


@pytest.fixture
def client():
    app.state.require_bearer_token = None
    return TestClient(app)


def test_transcript_markdown_404_for_unknown_session(client):
    r = client.get("/api/sessions/does-not-exist/transcript.md")
    assert r.status_code == 404


def test_transcript_markdown_returns_markdown_content_type(client):
    # Use any session id from the fixture — let the endpoint pick up the
    # first indexed one. We don't care about which one; we only care
    # about the output contract.
    r = client.get("/api/sessions")
    assert r.status_code == 200
    items = r.json()["items"]
    if not items:
        pytest.skip("fixture has no sessions to export")
    sid = items[0]["id"]

    r = client.get(f"/api/sessions/{sid}/transcript.md")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    # Save-as dispo so the browser doesn't render inline.
    assert "attachment" in r.headers["content-disposition"]
    assert f"session-{sid[:8]}.md" in r.headers["content-disposition"]


def test_transcript_markdown_body_has_title_and_metadata(client):
    r = client.get("/api/sessions")
    items = r.json()["items"]
    if not items:
        pytest.skip("fixture has no sessions")
    sid = items[0]["id"]

    r = client.get(f"/api/sessions/{sid}/transcript.md")
    assert r.status_code == 200
    body = r.text
    # Top-level H1 title
    assert body.startswith("# ")
    # Metadata mentions the session id
    assert sid in body
    # Header/body separator
    assert "---" in body


def test_transcript_markdown_renders_message_headings(client):
    r = client.get("/api/sessions")
    items = r.json()["items"]
    if not items:
        pytest.skip("fixture has no sessions")
    sid = items[0]["id"]

    r = client.get(f"/api/sessions/{sid}/transcript.md")
    body = r.text
    # If there's any user/assistant content, it gets an H3 heading.
    # Don't demand both roles — just assert at least one role heading
    # exists for sessions with any non-meta content.
    assert "### user" in body or "### assistant" in body


def test_transcript_markdown_limit_parameter_caps_messages(client):
    r = client.get("/api/sessions")
    items = r.json()["items"]
    if not items:
        pytest.skip("fixture has no sessions")
    sid = items[0]["id"]

    r = client.get(f"/api/sessions/{sid}/transcript.md", params={"limit": 1})
    body = r.text
    # Count H3 role headings; cannot exceed `limit`.
    role_headings = sum(1 for line in body.splitlines() if line.startswith("### "))
    assert role_headings <= 1


def test_transcript_markdown_is_auth_gated_in_daemon_mode(client):
    r = client.get("/api/sessions")
    items = r.json()["items"]
    sid = items[0]["id"] if items else "any"
    app.state.require_bearer_token = "deadbeef" * 8
    try:
        r = client.get(f"/api/sessions/{sid}/transcript.md")
        assert r.status_code == 401
    finally:
        app.state.require_bearer_token = None
