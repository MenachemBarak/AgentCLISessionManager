"""`python -m daemon` — Phase 2 entry point for the AgentManager daemon.

Starts the FastAPI app on `127.0.0.1:8765` (the canonical daemon port per
ADR-18 §Architecture). Phase 3 adds pid-file locking, token generation,
and `DETACHED_PROCESS` spawn semantics on Windows. For now this is just
a uvicorn runner that the Phase 2 tests point at.

Run with:
    python -m daemon

Env vars honoured (inherited from backend.app):
    CLAUDE_HOME       — override ~/.claude (for tests)
    CSV_TEST_MODE     — expose test-only seed endpoints
"""

from __future__ import annotations

import logging
import os

import uvicorn

from daemon import app  # re-exported from backend.app


def main() -> None:
    host = os.environ.get("AGENTMANAGER_DAEMON_HOST", "127.0.0.1")
    port = int(os.environ.get("AGENTMANAGER_DAEMON_PORT", "8765"))
    log_level = os.environ.get("AGENTMANAGER_DAEMON_LOG_LEVEL", "info")
    logging.basicConfig(level=getattr(logging, log_level.upper(), logging.INFO))
    uvicorn.run(app, host=host, port=port, log_level=log_level)


if __name__ == "__main__":
    main()
