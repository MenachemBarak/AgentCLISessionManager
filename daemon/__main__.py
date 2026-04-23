"""`python -m daemon` — AgentManager daemon entry point (ADR-18 / Task #42).

Bootstrap order:
1. `daemon.bootstrap()` — ensure state dir, generate-or-read token,
   acquire singleton pid lock. Exits fast (code 2) if another daemon is
   already alive so the UI shim treats it as "connect to existing".
2. Seed `app.state.require_bearer_token` so the HTTP auth middleware
   enforces the token on every request except `/api/health`.
3. `uvicorn.run(app, host='127.0.0.1', port=8765)` — loopback only (no
   firewall prompt per ADR-18 §Law 1 research).

Env overrides (for tests + Phase 3):
    AGENTMANAGER_DAEMON_HOST       default 127.0.0.1
    AGENTMANAGER_DAEMON_PORT       default 8765
    AGENTMANAGER_DAEMON_LOG_LEVEL  default info
    AGENTMANAGER_STATE_DIR         default %LOCALAPPDATA%\\AgentManager
    CLAUDE_HOME                    inherited from backend.app
"""

from __future__ import annotations

import logging
import os
import sys

import uvicorn

from daemon import __version__, app
from daemon.bootstrap import DaemonAlreadyRunning, bootstrap


def main() -> int:
    host = os.environ.get("AGENTMANAGER_DAEMON_HOST", "127.0.0.1")
    port = int(os.environ.get("AGENTMANAGER_DAEMON_PORT", "8765"))
    log_level = os.environ.get("AGENTMANAGER_DAEMON_LOG_LEVEL", "info")
    logging.basicConfig(level=getattr(logging, log_level.upper(), logging.INFO))

    try:
        token, lock_cm = bootstrap(__version__)
    except DaemonAlreadyRunning as exc:
        print(f"daemon: {exc}", file=sys.stderr)
        return 2

    app.state.require_bearer_token = token
    app.state.daemon_version = __version__

    with lock_cm:
        uvicorn.run(app, host=host, port=port, log_level=log_level)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
