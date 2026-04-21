"""Provider protocol and shared types.

A provider is the thin adapter between an agent CLI's on-disk storage and
our uniform viewer API. The goal is to abstract away *how* each agent
persists sessions (JSONL files, SQLite DBs, state folders, etc.) so the
FastAPI routes can stay identical regardless of which CLI the user runs.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol, TypedDict, runtime_checkable


class ProviderUnavailable(Exception):
    """Raised during Provider.__init__ when the agent's home dir doesn't
    exist on this machine. Caught by the registry — the provider is simply
    dropped from the active list rather than crashing the server."""


class SessionMeta(TypedDict, total=False):
    """The row shape returned by `/api/sessions`. Every field is optional so
    providers that don't know a particular value can leave it out."""

    id: str
    provider: str  # "claude-code" | "codex" | ...
    title: str
    claudeTitle: str | None
    userLabel: str | None
    cwd: str
    branch: str
    model: str
    createdAt: int  # ms since epoch
    lastActive: int
    messageCount: int
    tokens: int
    active: bool
    activityLabel: str | None
    firstUserMessages: list[str]
    path: str  # provider-internal locator (filepath, DB row id, etc.)


class Message(TypedDict):
    role: str  # "user" | "assistant" | "system" | ...
    content: str
    ts: int


class Preview(TypedDict):
    id: str
    provider: str
    firstUserMessages: list[str]
    claudeTitle: str | None


WatcherCallback = Callable[[dict[str, Any]], None]


@runtime_checkable
class SessionProvider(Protocol):
    """Duck-typed interface every agent-CLI adapter implements.

    Intentionally Protocol (not ABC) so adapters don't have to inherit from
    anything — register the class in `PROVIDERS` and you're done.
    """

    #: Stable identifier — shows up as the `"provider"` field on every row.
    name: str

    #: Human-readable name for the UI (e.g. "Claude Code", "Codex CLI").
    display_name: str

    #: Path to the agent's config/state dir (~/.claude, ~/.codex, ...).
    home_dir: Path

    def discover(self) -> list[SessionMeta]:
        """Return every session this agent has on disk, cheapest scan.

        Must be safe to call repeatedly; the registry / FastAPI routes use
        it both at startup and for cache rebuilds.
        """
        ...

    def preview(self, session_id: str) -> Preview | None:
        """Return the first N user messages + any agent-set title."""
        ...

    def transcript(self, session_id: str, limit: int = 400) -> list[Message]:
        """Return the message timeline, user+assistant, capped at `limit`."""
        ...

    def active_ids(self) -> set[str]:
        """Return session ids currently running (live/foreground)."""
        ...

    def resume_command(self, session_id: str) -> list[str]:
        """argv to relaunch the session in a terminal. Used by `/api/open`
        (spawns it in a Windows Terminal tab today) and PR #6 (spawns it
        in an internal xterm.js pane)."""
        ...

    def start_watcher(self, on_change: WatcherCallback) -> None:
        """Start watching on-disk state. `on_change` is called with SSE
        event dicts like {type: session_created|session_updated|session_deleted, ...}.
        Idempotent — second call is a no-op."""
        ...

    def stop_watcher(self) -> None:
        """Stop the watcher started by `start_watcher`. Idempotent."""
        ...
