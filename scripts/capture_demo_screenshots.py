"""Capture README demo screenshots against the mocked CLAUDE_HOME fixture.

Runs a uvicorn server on an ephemeral port pointed at tests/fixtures/claude-home,
then uses Playwright to open the UI and save two PNGs into docs/screenshots/.

All content in the screenshots is synthetic — no real session data, no PII.

Usage:
    .venv/Scripts/python scripts/capture_demo_screenshots.py
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIXTURE_HOME = ROOT / "tests" / "fixtures" / "claude-home"
OUT_DIR = ROOT / "docs" / "screenshots"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def main() -> int:
    port = _free_port()
    env = os.environ.copy()
    env["CLAUDE_HOME"] = str(FIXTURE_HOME)
    env["PYTHONIOENCODING"] = "utf-8"

    server = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app:app",
            "--app-dir",
            str(ROOT / "backend"),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],
        env=env,
    )
    try:
        url = f"http://127.0.0.1:{port}/"
        # wait for readiness
        import urllib.request

        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                urllib.request.urlopen(f"{url}api/status").read()
                break
            except Exception:
                time.sleep(0.3)

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
            page = ctx.new_page()
            page.goto(url)
            page.wait_for_selector("aside", timeout=10000)
            time.sleep(1.5)  # let initial render settle

            # 1. Main view
            page.screenshot(path=str(OUT_DIR / "main.png"), full_page=False)
            print("[ok] main.png")

            # 2. Hover preview — hover the first session row
            row = page.query_selector('[data-testid^="session-row-"]')
            if row:
                row.hover()
                time.sleep(0.6)
                page.screenshot(path=str(OUT_DIR / "hover-preview.png"), full_page=False)
                print("[ok] hover-preview.png")

            # 3. Click row to show transcript
            if row:
                row.click()
                time.sleep(0.8)
                page.screenshot(path=str(OUT_DIR / "transcript.png"), full_page=False)
                print("[ok] transcript.png")

            browser.close()
        return 0
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    sys.exit(main())
