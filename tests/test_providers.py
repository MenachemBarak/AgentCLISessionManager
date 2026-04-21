"""Tests for the provider abstraction (backend/providers/).

These are about the registry contract — "is the abstraction the right shape
to add Codex / Copilot / Gemini later without touching app.py?" — not about
re-testing Claude Code's existing behaviour (that's already covered by
test_backend_api.py + test_watcher.py).
"""

from __future__ import annotations

from pathlib import Path

from backend.providers import (
    PROVIDERS,
    Preview,
    SessionProvider,
    available,
)
from backend.providers.base import SessionMeta
from backend.providers.claude_code import ClaudeCodeProvider


# ─────────────────────── registry shape ──────────────────────────────
def test_registry_has_claude_code() -> None:
    assert "claude-code" in PROVIDERS
    assert PROVIDERS["claude-code"] is ClaudeCodeProvider


def test_claude_code_satisfies_protocol() -> None:
    """Structural check — adding a new provider that violates the protocol
    should fail this same check."""
    provider = ClaudeCodeProvider()
    assert isinstance(provider, SessionProvider)


def test_claude_code_has_stable_name_and_display_name() -> None:
    assert ClaudeCodeProvider.name == "claude-code"
    assert ClaudeCodeProvider.display_name == "Claude Code"


def test_available_skips_providers_that_cannot_initialize(monkeypatch) -> None:
    """A provider whose __init__ raises ProviderUnavailable should be
    silently omitted from `available()` — so shipping a new adapter before
    its CLI is installed on the machine doesn't crash the server."""
    from backend.providers.base import ProviderUnavailable

    class FakeProvider:
        name = "fake"
        display_name = "Fake"

        def __init__(self) -> None:
            raise ProviderUnavailable("no home dir")

    monkeypatch.setitem(PROVIDERS, "fake", FakeProvider)
    active = {p.name for p in available()}
    assert "fake" not in active
    assert "claude-code" in active  # the real one still works


# ─────────────────────── Claude Code provider against the fixture ───
def test_discover_returns_fixture_sessions(app_module) -> None:
    """The fixture CLAUDE_HOME (2 top-level JSONLs + 1 sub-agent to filter)
    should yield exactly the two resumable sessions."""
    p = ClaudeCodeProvider(home_dir=Path(app_module.CLAUDE_HOME))
    p.build_index()
    ids = {row["id"] for row in p.discover()}
    assert "11111111-1111-4111-8111-111111111111" in ids
    assert "22222222-2222-4222-8222-222222222222" in ids
    # sub-agent session must be excluded
    assert "33333333-3333-4333-8333-333333333333" not in ids


def test_every_row_has_provider_field(app_module) -> None:
    """Adding Codex later must not break the contract — every session row
    self-identifies by its provider so the frontend can route."""
    p = ClaudeCodeProvider(home_dir=Path(app_module.CLAUDE_HOME))
    p.build_index()
    for row in p.discover():
        assert row["provider"] == "claude-code"


def test_preview_and_transcript(app_module) -> None:
    p = ClaudeCodeProvider(home_dir=Path(app_module.CLAUDE_HOME))
    p.build_index()
    sid = "11111111-1111-4111-8111-111111111111"
    preview = p.preview(sid)
    assert preview is not None
    assert preview["provider"] == "claude-code"
    assert preview["claudeTitle"] == "Mock Renamed One"
    assert len(preview["firstUserMessages"]) >= 2

    msgs = p.transcript(sid)
    roles = {m["role"] for m in msgs}
    assert roles <= {"user", "assistant"}
    assert any(m["role"] == "assistant" for m in msgs)


def test_resume_command_is_stable() -> None:
    """PR #6 wires this directly into an internal PTY spawn — the shape
    must stay `argv` (list[str]), never a shell string."""
    cmd = ClaudeCodeProvider().resume_command("11111111-1111-4111-8111-111111111111")
    assert cmd[0] == "claude"
    assert "--resume" in cmd
    assert cmd[-1] == "11111111-1111-4111-8111-111111111111"


# ─────────────────────── endpoint integration ────────────────────────
def test_api_providers_endpoint_lists_claude_code(client) -> None:
    r = client.get("/api/providers")
    assert r.status_code == 200
    body = r.json()
    ids = {p["id"] for p in body["registered"]}
    assert "claude-code" in ids
    assert "claude-code" in body["active"]


def test_api_sessions_tags_rows_with_provider(client) -> None:
    body = client.get("/api/sessions").json()
    for row in body["items"]:
        assert row["provider"] == "claude-code"


def test_api_session_preview_tags_provider(client) -> None:
    body = client.get("/api/sessions/11111111-1111-4111-8111-111111111111/preview").json()
    assert body["provider"] == "claude-code"


# ─────────────────────── session_meta typeddict sanity ────────────────
def test_session_meta_and_preview_shapes_exist() -> None:
    """Importable shapes — future providers must match them."""
    assert SessionMeta is not None
    assert Preview is not None
