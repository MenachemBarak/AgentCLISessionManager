"""AgentManager daemon package (ADR-18 / Task #42).

Phase 2 skeleton. The daemon is the long-lived process that owns PTYs,
WebSocket connections, the JSONL index, and the update poller — so the
short-lived UI exe can be swapped on self-update without killing claude
sessions.

Currently this is a thin re-export of `backend.app:app` (+ a stdlib-only
entry point in `__main__`). Phases 3-7 move layout state, ring buffer,
and updater responsibility into this package. Phases 8-10 land the
separate PyInstaller target and the UI shim that autostarts the daemon
detached.

Nothing in Phase 2 changes runtime behaviour — the same FastAPI app
still serves the UI. This package exists so Phase 3+ can extend it
without reshuffling the backend/ layout in a single disruptive commit.
"""

from __future__ import annotations

from backend.__version__ import __version__
from backend.app import app

__all__ = ["app", "__version__"]
