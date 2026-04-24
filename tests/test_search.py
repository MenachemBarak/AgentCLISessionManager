"""Unit tests for the smart session search (task #40).

Covers the ranking layer + the /api/search endpoint.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.search import _tokenize, rank_sessions

# ─────────────────────── tokenizer ───────────────────────


def test_tokenize_drops_stopwords_and_stems():
    # Simple stemmer: strips a trailing suffix once; no double-consonant
    # handling. So "debugging" → "debugg" (strips "ing"), not "debug".
    # "session" has no matching suffix, "paste" ends in "e" (no match),
    # "bug" is under the 5-char threshold.
    assert _tokenize("the debugging session is a paste bug") == ["debugg", "session", "paste", "bug"]


def test_tokenize_preserves_short_words():
    assert _tokenize("fix ws bug") == ["fix", "ws", "bug"]


def test_tokenize_handles_punctuation_and_case():
    assert _tokenize("Hello, World! FooBar.") == ["hello", "world", "foobar"]


def test_tokenize_hebrew_is_preserved():
    """Regression: earlier tokenizer used [A-Za-z0-9_]+ and silently
    dropped Hebrew/Chinese/accented Latin. Users with non-English
    sessions got empty results. `\\w+` (unicode-aware in Py3) fixes it."""
    # Hebrew doesn't hit the stemmer (non-ASCII → no suffix strip).
    assert _tokenize("פיתוח פלטפורמה") == ["פיתוח", "פלטפורמה"]


def test_tokenize_chinese_is_preserved():
    assert _tokenize("修复 bug") == ["修复", "bug"]


def test_tokenize_accented_latin_is_preserved():
    # café stays intact — stemmer won't touch 4-char tokens.
    # résumé is 6 chars but ends in "é" not a stem suffix, so unchanged.
    assert _tokenize("café résumé") == ["café", "résumé"]


def test_tokenize_mixed_script_tokenizes_each_run():
    assert _tokenize("fix the רכב bug") == ["fix", "רכב", "bug"]


def test_rank_finds_hebrew_sessions():
    """End-to-end: searching in Hebrew should return Hebrew-titled sessions."""
    sessions = [
        _session("a", title="פיתוח פלטפורמה לניהול סושיאל"),
        _session("b", title="unrelated English session"),
    ]
    result = rank_sessions("פיתוח", sessions)
    assert len(result) == 1
    assert result[0]["id"] == "a"


def test_tokenize_empty_returns_empty():
    assert _tokenize("") == []
    assert _tokenize("   ") == []
    # All-stopword input collapses to nothing.
    assert _tokenize("the a on in") == []


# ─────────────────────── ranking ───────────────────────


def _session(
    sid: str,
    title: str = "",
    user_label: str | None = None,
    claude_title: str | None = None,
    first_user_messages: list[str] | None = None,
    cwd: str = "",
    last_active: int = 0,
) -> dict:
    return {
        "id": sid,
        "title": title,
        "userLabel": user_label,
        "claudeTitle": claude_title,
        "firstUserMessages": first_user_messages or [],
        "cwd": cwd,
        "lastActive": last_active,
    }


def test_rank_empty_query_returns_empty():
    sessions = [_session("a", title="hello")]
    assert rank_sessions("", sessions) == []
    assert rank_sessions("  ", sessions) == []


def test_rank_no_matches_returns_empty():
    sessions = [_session("a", title="building login page")]
    assert rank_sessions("fix websocket bug", sessions) == []


def test_rank_title_match_wins_over_cwd_match():
    matching_title = _session("a", title="fix websocket bug")
    matching_cwd = _session("b", title="unrelated", cwd="C:/projects/websocket")
    result = rank_sessions("websocket bug", [matching_title, matching_cwd])
    assert len(result) == 2
    assert result[0]["id"] == "a"


def test_rank_user_label_outweighs_claude_title():
    # User label gets weight 5.0; claude title gets 2.5. Label wins.
    label_match = _session("a", title="x", user_label="the websocket bug", claude_title="unrelated")
    ctitle_match = _session("b", title="y", user_label=None, claude_title="the websocket bug")
    result = rank_sessions("websocket bug", [label_match, ctitle_match])
    assert result[0]["id"] == "a"


def test_rank_phrase_boost_for_exact_match():
    phrase_session = _session("a", title="fix websocket paste bug v1.0.0")
    overlap_session = _session("b", title="bug paste websocket fix", first_user_messages=["separate words"])
    result = rank_sessions("websocket paste bug", [phrase_session, overlap_session])
    # Exact phrase in title of 'a' should outscore scattered tokens in 'b'.
    assert result[0]["id"] == "a"


def test_rank_stable_for_ties_prefers_first_input():
    # Two sessions with identical content — caller-order tie-break.
    s1 = _session("first", title="fix bug")
    s2 = _session("second", title="fix bug")
    result = rank_sessions("fix bug", [s1, s2])
    assert [r["id"] for r in result] == ["first", "second"]


def test_rank_attaches_score_field():
    sessions = [_session("a", title="fix websocket bug")]
    result = rank_sessions("websocket", sessions)
    assert result[0]["_score"] > 0


def test_rank_limit_caps_results():
    sessions = [_session(f"s{i}", title=f"fix bug {i}") for i in range(30)]
    assert len(rank_sessions("fix bug", sessions, limit=5)) == 5


# ─────────────────────── /api/search endpoint ───────────────────────


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Use the existing fixture tree by default — it has a couple of sessions.
    app.state.require_bearer_token = None
    return TestClient(app)


def test_search_empty_query_returns_no_items(client):
    r = client.get("/api/search", params={"q": ""})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 0
    assert body["items"] == []


def test_search_query_no_match_returns_empty(client):
    # Use tokens that definitely don't appear anywhere in the fixture
    # sessions (not even in cwd paths). Random short hex works.
    r = client.get("/api/search", params={"q": "qqqxzzz wwwyyyqq"})
    assert r.status_code == 200
    assert r.json()["total"] == 0


def test_search_returns_items_with_score(client):
    # The fixture claude-home has 2 sessions — use a broad match term.
    r = client.get("/api/search", params={"q": "session"})
    assert r.status_code == 200
    body = r.json()
    assert "items" in body
    # If any match, they all carry _score.
    for item in body["items"]:
        assert "_score" in item
        assert item["_score"] > 0


def test_search_respects_limit(client):
    r = client.get("/api/search", params={"q": "session", "limit": 1})
    assert r.status_code == 200
    assert len(r.json()["items"]) <= 1


def test_search_is_auth_gated_in_daemon_mode(client):
    app.state.require_bearer_token = "deadbeef" * 8
    try:
        r = client.get("/api/search", params={"q": "anything"})
        assert r.status_code == 401
    finally:
        app.state.require_bearer_token = None
