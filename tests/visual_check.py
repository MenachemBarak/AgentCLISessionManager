"""Quick visual test: load the app, screenshot, dump titles for active sessions."""
import io, sys, json, time
from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SHOT = "M:/UserGlobalMemory/global-memory-plane/projects/claude-sessions-viewer/shots/pw/visual.png"
URL = "http://127.0.0.1:8765/"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
    page.on("pageerror", lambda e: print(f"PAGEERROR {e}"))
    page.goto(URL)
    page.wait_for_selector("aside", timeout=15000)
    time.sleep(3)
    # Dump the titles of every session row in the active section
    data = page.evaluate(
        """() => {
            const aside = document.querySelector('aside');
            const rows = [...aside.querySelectorAll('[data-testid^=\"session-row-\"]')];
            return rows.slice(0, 15).map(r => ({
                id: r.getAttribute('data-testid'),
                text: r.innerText.split('\\n').slice(0,1).join(''),
            }));
        }"""
    )
    print(json.dumps(data, ensure_ascii=False, indent=2))
    page.screenshot(path=SHOT, full_page=False)
    print(f"shot: {SHOT}")
    browser.close()
