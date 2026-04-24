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
import os
import socket
import sys
from typing import Any
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
        prog="AgentManager",
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
    parser.add_argument(
        "--probe-daemon",
        action="store_true",
        help=(
            "(ADR-18 / Task #42 Phase 3b) Probe 127.0.0.1:<port> for an "
            "AgentManager daemon and exit: 0 if ours, 1 if absent, "
            "3 if port held by an unrelated process. Used by the UI shim to "
            "decide whether to autostart a daemon."
        ),
    )
    args = parser.parse_args(argv)

    # ── daemon probe (no server start) ─────────────────────────────
    # Runs BEFORE frontend/logging init so the probe has minimal side effects.
    if args.probe_daemon:
        from daemon.launcher import probe

        port = args.port or 8765
        result = probe(port)
        state = result.get("state")
        if state == "ours":
            print(f"daemon: ours (version {result.get('daemonVersion')}) on {args.host}:{port}")
            return 0
        if state == "absent":
            print(f"daemon: absent on {args.host}:{port}", file=sys.stderr)
            return 1
        # "other" — port busy with something that isn't our daemon.
        detail = result.get("error") or f"http status {result.get('httpStatus')}"
        print(
            f"daemon: port {port} held by unrelated process ({detail}) — refusing to start",
            file=sys.stderr,
        )
        return 3

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

    # ── daemon split mode (ADR-18 / Task #42 Phase 3c, opt-in) ─────────────
    # When AGENTMANAGER_DAEMON=1, the UI probes 127.0.0.1:8765 for an already-
    # running daemon and either connects to it or spawns one detached. The
    # webview navigates to the daemon's URL with the bearer token in a URL
    # fragment (the fragment is NOT sent to the server — only frontend JS
    # reads it and attaches it as Authorization on subsequent requests).
    # Legacy (non-daemon) mode is preserved by default so existing users are
    # unaffected until we flip the default in v1.3.0.
    if os.environ.get("AGENTMANAGER_DAEMON") == "1":
        rc = _launch_daemon_mode(webview)
        if rc is not None:
            return rc

    port = args.port or _free_port()
    url = f"http://{args.host}:{port}/"

    server_thread = threading.Thread(
        target=_run_server,
        args=(args.host, port, args.log_level),
        daemon=True,
        name="AgentManager-uvicorn",
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


def _launch_daemon_mode(webview_mod: Any) -> int | None:
    """Opt-in daemon-split launch path (ADR-18 / Task #42).

    Returns:
      - None  — daemon probe/spawn failed in a non-fatal way; caller should
                fall back to legacy in-process mode (rare).
      - int   — exit code; caller should return it (either success after
                the webview closes, or a failure during probe/spawn).
    """
    from daemon.bootstrap import read_or_create_token
    from daemon.launcher import probe, spawn_detached, wait_for_health

    port = 8765
    state = probe(port).get("state")
    if state == "other":
        print(
            f"daemon: port {port} held by unrelated process — refusing to start. "
            "Close the other listener or unset AGENTMANAGER_DAEMON=1 to "
            "fall back to legacy in-process mode.",
            file=sys.stderr,
        )
        return 3
    if state == "absent":
        daemon_argv = [sys.executable, "-m", "daemon"]
        spawn_detached(daemon_argv)
        if not wait_for_health(port, timeout=15.0):
            print(
                f"daemon: failed to come up on port {port} within 15s",
                file=sys.stderr,
            )
            return 1

    try:
        token = read_or_create_token()
    except OSError as exc:
        print(f"daemon: token unreadable ({exc})", file=sys.stderr)
        return 1

    # Fragment is parsed by frontend JS (daemon-auth-init.js) and wired
    # into window.fetch + WebSocket. The fragment is NEVER sent to the
    # server (by RFC 3986 + browser behaviour), so it can't leak via
    # server logs.
    url = f"http://127.0.0.1:{port}/#token={token}"
    webview_mod.create_window(
        title=f"AgentManager {__version__}",
        url=url,
        width=1400,
        height=900,
        resizable=True,
        confirm_close=False,
    )
    webview_mod.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())
