"""End-to-end Playwright test for the user-label inline edit flow.

Simulates: open app -> find a session row -> click title -> type
a custom label -> press Enter -> verify UI updates WITHOUT reload ->
verify backend persists -> reload -> verify it survives -> cleanup.
"""
from __future__ import annotations

import io
import json
import sys
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

# Ensure unicode output works regardless of console codepage.
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "buffer"):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import os as _os
URL = _os.environ.get("VIEWER_URL", "http://127.0.0.1:8765/")
LABEL = f"playwright-test-{int(time.time())}"


def api_get_label(session_id: str) -> dict:
    with urllib.request.urlopen(f"{URL.rstrip('/')}/api/sessions/{session_id}/label") as r:
        return json.loads(r.read())


def api_clear_label(session_id: str) -> None:
    body = json.dumps({"userLabel": None}).encode()
    req = urllib.request.Request(
        f"{URL.rstrip('/')}/api/sessions/{session_id}/label",
        data=body, method="PUT",
        headers={"Content-Type": "application/json"},
    )
    urllib.request.urlopen(req).read()


def pick_target_session(page) -> tuple[str, str]:
    """Pick a stable idle session via API and find its row in the DOM.
    Returns (session_id, title_text_snippet_for_locator)."""
    # 1) via API: pick the 30th idle session — well inside the rendered list.
    with urllib.request.urlopen(f"{URL.rstrip('/')}/api/sessions?limit=5000") as r:
        payload = json.loads(r.read())
    # Pick idle sessions from top of the list (which are recent → likely in
    # visible folders) and exclude the huge agent-scraper folder which is
    # auto-unchecked by the folder filter (>1000 sessions).
    idle = [
        s for s in payload["items"]
        if not s.get("active") and "agent-scraper" not in (s.get("cwd") or "")
    ]
    target = idle[0]
    log(f"picked from {len(idle)} visible idle sessions")
    sid = target["id"]
    # snippet of the first-user-message title (truncate to avoid quote issues)
    snippet = (target["title"] or "").splitlines()[0][:40]
    print(f"[pick] sid={sid} snippet={snippet!r}")
    # 2) wait for that snippet to appear somewhere in the aside
    page.wait_for_selector("aside", timeout=15000)
    page.wait_for_function(
        f"document.querySelector('aside')?.innerText?.includes({json.dumps(snippet)})",
        timeout=15000,
    )
    return sid, snippet


from pathlib import Path as _Path
SHOT_DIR = str(_Path(__file__).resolve().parent.parent / "shots" / "pw")

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

def snap(page, name):
    import os
    os.makedirs(SHOT_DIR, exist_ok=True)
    path = f"{SHOT_DIR}/{name}.png"
    page.screenshot(path=path, full_page=False)
    log(f"screenshot: {path}")


def run() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1400, "height": 900})
        page = context.new_page()
        page.on("console", lambda m: log(f"CONSOLE [{m.type}] {m.text}"))
        page.on("pageerror", lambda e: log(f"PAGEERROR {e}"))
        page.goto(URL)
        log("navigated")

        sid, snippet = pick_target_session(page)
        sid8 = sid[:8]
        # Ensure clean state
        api_clear_label(sid)
        page.reload()

        # Wait for the row's testid to appear.
        row_sel = f'[data-testid="session-row-{sid8}"]'
        page.wait_for_function(
            f"document.querySelectorAll('[data-testid=\"session-row-{sid8}\"]').length > 0",
            timeout=15000,
        )
        log(f"row testid present")
        snap(page, "01-after-reload")
        count = page.evaluate(
            f"document.querySelectorAll('[data-testid=\"session-row-{sid8}\"]').length"
        )
        print(f"[dbg] rows matching testid: {count}")
        dbg = page.evaluate(
            f"""() => {{
                const row = document.querySelector('[data-testid="session-row-{sid8}"]');
                if (!row) return 'no row';
                return {{
                    html: row.outerHTML.slice(0, 800),
                    testids: [...row.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')),
                }};
            }}"""
        )
        print(f"[dbg] row inner testids: {dbg}")
        # Scroll into view via JS directly.
        page.evaluate(
            f"""() => {{
                const el = document.querySelector('[data-testid="session-row-{sid8}"]');
                if (el) el.scrollIntoView({{block:'center'}});
            }}"""
        )
        # Click the title span
        title_sel = f'[data-testid="title-{sid8}"]'
        # Longer wait in case of concurrent React re-renders from SSE.
        try:
            page.wait_for_selector(title_sel, state="attached", timeout=15000)
        except Exception:
            # Dump DOM slice for diagnosis
            dom = page.evaluate(
                f"""() => {{
                    const row = document.querySelector('[data-testid="session-row-{sid8}"]');
                    return {{
                        rowExists: !!row,
                        rowHTML: row ? row.outerHTML.slice(0, 2000) : null,
                        testids: [...document.querySelectorAll('[data-testid]')].slice(0,20).map(e=>e.getAttribute('data-testid')),
                    }};
                }}"""
            )
            log(f"DOM dump: {dom}")
            snap(page, "02-title-not-found")
            raise
        page.locator(title_sel).scroll_into_view_if_needed()
        page.click(title_sel)

        # Input appears.
        input_sel = f'[data-testid="title-input-{sid8}"]'
        page.wait_for_selector(input_sel, state="attached", timeout=5000)

        # Type and press Enter.
        page.fill(input_sel, LABEL)
        page.press(input_sel, "Enter")

        # UI must reflect the new label WITHOUT a page reload.
        page.wait_for_function(
            f"document.querySelector('[data-testid=\"session-row-{sid8}\"]')?.innerText?.includes({json.dumps(LABEL)})",
            timeout=5000,
        )
        print(f"[ok] UI updated in-place without reload: label={LABEL!r}")

        # Step 5: backend persists
        server_state = api_get_label(sid)
        assert server_state.get("userLabel") == LABEL, f"server not updated: {server_state}"
        print(f"[ok] server persists: {server_state}")

        # Step 6: reload survives
        page.reload()
        page.wait_for_selector(row_sel, state="attached", timeout=15000)
        page.wait_for_function(
            f"document.querySelector('[data-testid=\"session-row-{sid8}\"]')?.innerText?.includes({json.dumps(LABEL)})",
            timeout=10000,
        )
        snap(page, "04-after-reload")
        log(f"[ok] label survives reload")

        # Cleanup
        api_clear_label(sid)
        final = api_get_label(sid)
        assert final.get("userLabel") is None, f"cleanup failed: {final}"
        print(f"[ok] cleanup: {final}")

        browser.close()
        print("\nALL TESTS PASSED ✓")


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        print(f"\nFAIL: {e}", file=sys.stderr)
        import traceback; traceback.print_exc()
        sys.exit(1)
