"""Agent-CLI session provider registry.

A `SessionProvider` knows how to list, preview, and read sessions for one
specific agent CLI (Claude Code, Codex, Copilot CLI, Gemini CLI, ...). Only
`claude-code` is implemented today; others are stubs that raise
`NotImplementedError` so the wiring is tested even when the real adapter
doesn't exist yet.

All API routes iterate this registry rather than calling Claude-Code-specific
helpers directly — adding a new agent means dropping a new file in
`backend/providers/` and registering it in `PROVIDERS`.
"""

from __future__ import annotations

from backend.providers.base import (
    Message,
    Preview,
    ProviderUnavailable,
    SessionMeta,
    SessionProvider,
)
from backend.providers.claude_code import ClaudeCodeProvider

# Registry. Key = stable provider id exposed via the API as `"provider"` on
# every session. Add new agents here.
PROVIDERS: dict[str, type[SessionProvider]] = {
    "claude-code": ClaudeCodeProvider,
    # "codex":   CodexProvider,     # stub lives in codex.py, raises ProviderUnavailable
    # "copilot": CopilotProvider,
    # "gemini":  GeminiProvider,
}


def available() -> list[SessionProvider]:
    """Instantiate every provider whose home dir exists on this machine.

    Providers that raise `ProviderUnavailable` during __init__ (e.g. no
    config on disk) are silently skipped — they appear in `/api/providers`
    with `available: false` but don't crash discovery.
    """
    out: list[SessionProvider] = []
    for cls in PROVIDERS.values():
        try:
            out.append(cls())
        except ProviderUnavailable:
            continue
    return out


__all__ = [
    "Message",
    "Preview",
    "PROVIDERS",
    "ProviderUnavailable",
    "SessionMeta",
    "SessionProvider",
    "available",
]
