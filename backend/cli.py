"""Command-line + desktop entry point for the Claude Sessions Viewer.

Default mode: spawns uvicorn on a background thread and opens the UI inside
a native OS webview window (Edge WebView2 on Windows, WebKit on macOS,
WebKitGTK on Linux) — behaves like a standalone desktop app.

Use `--server-only` to fall back to the classic "run server, open a browser
tab" behavior.

Installed via `pipx install claude-sessions-viewer` as `claude-sessions-viewer`.
"""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

from backend.__version__ import __version__


def _frontend_dir() -> Path:
    """Locate the frontend/ directory shipped inside the backend package.

    Works for three install shapes:
    - editable / source checkout: backend/frontend next to this file
    - installed wheel: backend/frontend inside the site-packages install
    - PyInstaller one-file exe: bundled at <_MEIPASS>/backend/frontend
    """
    candidates = [Path(__file__).resolve().parent / "frontend"]
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(Path(meipass) / "backend" / "frontend")
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    raise RuntimeError(f"frontend/ not found — tried {candidates}")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _wait_ready(url: str, timeout: float = 15.0) -> bool:
    """Poll /api/status until the index is ready or timeout."""
    deadline = time.time() + timeout
    # Hard-coded http://127.0.0.1 URL — no scheme confusion / SSRF risk.
    while time.time() < deadline:
        try:
            # URL is a locally-constructed http://127.0.0.1 loopback — safe.
            with urllib.request.urlopen(f"{url}api/status", timeout=1) as r:  # nosec B310
                body = r.read().decode()
                if '"ready":true' in body or '"ready": true' in body:
                    return True
                # backend is up but index still building — still OK to open UI
                return True
        except Exception:
            time.sleep(0.2)
    return False


def _run_server(host: str, port: int, log_level: str) -> None:
    import uvicorn

    from backend.app import app

    uvicorn.run(app, host=host, port=port, log_level=log_level)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="claude-sessions-viewer",
        description="Desktop app for Claude Code sessions (native webview).",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument("--host", default="127.0.0.1", help="bind host (default: 127.0.0.1)")
    parser.add_argument(
        "--port",
        type=int,
        default=0,
        help="bind port (default: 0 = pick a free one in desktop mode, 8765 in server-only mode)",
    )
    parser.add_argument(
        "--server-only",
        action="store_true",
        help="run the backend only; open your browser manually (no native window)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="(server-only mode) don't auto-open a browser tab",
    )
    parser.add_argument(
        "--log-level", default="warning", choices=["critical", "error", "warning", "info", "debug"]
    )
    args = parser.parse_args(argv)

    _frontend_dir()  # fail fast if packaging is broken

    # Frozen-exe troubleshooting: also log to a file next to the exe so
    # users can diagnose PTY / spawn failures without attaching a debugger.
    try:
        import logging

        log_path = Path.home() / ".claude" / "claude-sessions-viewer.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_path, encoding="utf-8")
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        root_logger = logging.getLogger()
        root_logger.setLevel(logging.DEBUG)
        root_logger.addHandler(fh)
    except Exception:
        pass

    # ── server-only mode (legacy / headless) ──────────────────────────────
    if args.server_only:
        port = args.port or 8765
        url = f"http://{args.host}:{port}/"
        if not args.no_browser:
            try:
                webbrowser.open(url)
            except Exception:
                pass
        _run_server(args.host, port, args.log_level)
        return 0

    # ── desktop mode (default): native webview window ─────────────────────
    try:
        import webview  # pywebview
    except ImportError:
        print(
            "pywebview is not installed. Install it with:\n"
            "    pip install 'claude-sessions-viewer[desktop]'\n"
            "Or run without a window: claude-sessions-viewer --server-only",
            file=sys.stderr,
        )
        return 2

    port = args.port or _free_port()
    url = f"http://{args.host}:{port}/"

    server_thread = threading.Thread(
        target=_run_server,
        args=(args.host, port, args.log_level),
        daemon=True,
        name="claude-sessions-viewer-uvicorn",
    )
    server_thread.start()

    if not _wait_ready(url, timeout=15.0):
        print(f"Server did not start on {url} within 15s", file=sys.stderr)
        return 1

    webview.create_window(
        title=f"Claude Sessions Viewer {__version__}",
        url=url,
        width=1400,
        height=900,
        resizable=True,
        confirm_close=False,
    )
    webview.start()  # blocks until the window closes

    # Window closed → process exits; daemon thread dies with it.
    return 0


if __name__ == "__main__":
    sys.exit(main())
