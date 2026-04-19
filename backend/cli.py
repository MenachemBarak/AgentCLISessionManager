"""Command-line entry point for the Claude Sessions Viewer.

Installed via `pipx install claude-sessions-viewer` (or
`pipx install git+https://github.com/MenachemBarak/AgentCLISessionManager.git`)
as the `claude-sessions-viewer` command.
"""

from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

from backend.__version__ import __version__


def _frontend_dir() -> Path:
    """Locate the frontend/ directory shipped alongside the backend package.

    Works both when the package is installed (wheel puts frontend/ next to
    backend/) and when running from a git checkout (repo root has both).
    """
    here = Path(__file__).resolve().parent
    candidate = here / "frontend"
    if candidate.is_dir():
        return candidate
    raise RuntimeError(f"frontend/ not found inside backend package at {here}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="claude-sessions-viewer",
        description="Desktop web UI for Claude Code sessions.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument("--host", default="127.0.0.1", help="bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="bind port (default: 8765)")
    parser.add_argument("--no-browser", action="store_true", help="don't auto-open the browser")
    parser.add_argument(
        "--log-level", default="info", choices=["critical", "error", "warning", "info", "debug"]
    )
    args = parser.parse_args(argv)

    # Sanity-check packaging before boot.
    _frontend_dir()

    import uvicorn

    from backend.app import app

    if not args.no_browser:
        url = f"http://{args.host}:{args.port}/"
        try:
            webbrowser.open(url)
        except Exception:
            pass

    uvicorn.run(app, host=args.host, port=args.port, log_level=args.log_level)
    return 0


if __name__ == "__main__":
    sys.exit(main())
