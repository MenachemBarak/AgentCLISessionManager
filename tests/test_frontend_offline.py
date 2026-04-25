"""Regression: the SPA must boot offline.

Bug history: v1.2.17 shipped with React, ReactDOM, Babel, xterm.js, and
xterm addons loaded from `unpkg.com`, plus Inter from
`fonts.googleapis.com`. When the user launched without internet (PC
restart, DNS down, captive portal), every <script> tag failed silently
and the WebView2 surface stayed black — backend was healthy on
loopback, but no React → no app.

Two regression checks:
  1. index.html contains no remote `https://` script/link refs (the
     forward fix: vendor everything under backend/frontend/vendor/).
  2. The vendored files are actually present + served by FastAPI.
"""

from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

FRONTEND = Path(__file__).resolve().parent.parent / "backend" / "frontend"
INDEX = FRONTEND / "index.html"
VENDOR = FRONTEND / "vendor"

REQUIRED_VENDORED = [
    "react.development.js",
    "react-dom.development.js",
    "babel.min.js",
    "xterm.js",
    "xterm.css",
    "addon-fit.js",
    "addon-web-links.js",
]


def test_index_html_has_no_remote_script_or_link_refs() -> None:
    html = INDEX.read_text(encoding="utf-8")
    # Find every script src= and link href= attribute and assert it does
    # NOT start with https://, http://, or //.
    pattern = re.compile(
        r"""<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']""",
        re.IGNORECASE,
    )
    refs = pattern.findall(html)
    remote = [r for r in refs if r.startswith(("http://", "https://", "//"))]
    assert remote == [], (
        f"index.html must not load any remote assets — boots black when offline. " f"Found: {remote}"
    )


def test_index_html_contains_no_unpkg_or_googleapis_strings() -> None:
    html = INDEX.read_text(encoding="utf-8")
    # Even inside comments / inline JS this is a code-smell — the previous
    # bug had the URLs literally pasted into <script src>.
    for needle in ("unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"):
        assert needle not in html, (
            f"{needle!r} reference reintroduced — vendor it under backend/frontend/vendor/ "
            f"or the offline launch flow breaks again."
        )


def test_all_required_vendored_files_present() -> None:
    assert VENDOR.is_dir(), "backend/frontend/vendor/ missing"
    missing = [name for name in REQUIRED_VENDORED if not (VENDOR / name).is_file()]
    assert missing == [], f"missing vendored deps: {missing}"


def test_vendored_files_are_non_trivial_size() -> None:
    """Catches a half-finished vendoring (empty file masquerading as success)."""
    for name in REQUIRED_VENDORED:
        size = (VENDOR / name).stat().st_size
        assert size > 1000, f"{name} is suspiciously small ({size} bytes)"


def test_vendored_files_are_served_through_static_mount(app_module) -> None:
    """The FastAPI StaticFiles mount must serve every file under vendor/.
    Otherwise the wheel ships them but the browser still 404s."""
    client = TestClient(app_module.app)
    for name in REQUIRED_VENDORED:
        r = client.get(f"/vendor/{name}")
        assert r.status_code == 200, f"/vendor/{name} → {r.status_code}"
        assert len(r.content) > 1000, f"/vendor/{name} body too small"
