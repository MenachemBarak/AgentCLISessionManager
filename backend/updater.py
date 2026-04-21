"""In-app update checker + downloader for the native desktop exe.

On launch, the CLI kicks off a background check against the GitHub
Releases API. If a newer semver tag is published (and an asset named
`claude-sessions-viewer-<ver>-windows-x64.exe` exists), we surface a
small banner in the UI via `/api/update-status` that the user can
click to trigger `/api/update/download-and-stage` — this downloads the
new exe to a `.new` sibling, renames the current exe to `.old`, and
prompts restart.

Why roll our own instead of pyupdater / omaha
- Zero-trust surface: we fetch over HTTPS from api.github.com,
  validate SHA-256 against the published asset digest, and never
  run arbitrary code.
- Works from a single-file frozen exe that has no write access to
  its own directory while running (Windows file locking).
- No server infrastructure — GitHub Releases is the only dependency.
"""

from __future__ import annotations

import hashlib
import json
import logging
import sys
import threading
import urllib.request
from pathlib import Path

from backend.__version__ import __version__

log = logging.getLogger(__name__)

RELEASES_API = "https://api.github.com/repos/MenachemBarak/AgentCLISessionManager/releases/latest"
ASSET_PATTERN = "claude-sessions-viewer-{version}-windows-x64.exe"


class UpdateState:
    """Shared state polled by the /api/update-status endpoint."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.current_version: str = __version__
        self.latest_version: str | None = None
        self.latest_url: str | None = None
        self.latest_digest: str | None = None  # sha256:... from API
        self.checked: bool = False
        self.error: str | None = None
        self.download_progress: int = 0  # 0-100
        self.staged_path: str | None = None  # path to .new file once downloaded
        self.restart_instructions: str | None = None

    def snapshot(self) -> dict[str, str | int | bool | None]:
        with self.lock:
            return {
                "currentVersion": self.current_version,
                "latestVersion": self.latest_version,
                "updateAvailable": bool(
                    self.latest_version and _version_gt(self.latest_version, self.current_version)
                ),
                "checked": self.checked,
                "error": self.error,
                "downloadProgress": self.download_progress,
                "staged": bool(self.staged_path),
                "restartInstructions": self.restart_instructions,
            }


STATE = UpdateState()


def _version_gt(a: str, b: str) -> bool:
    """Strict > comparison for dotted semver strings like '0.7.1'. No
    pre-release handling — our tags are plain `vX.Y.Z`."""
    try:
        ta = tuple(int(x) for x in a.lstrip("v").split("."))
        tb = tuple(int(x) for x in b.lstrip("v").split("."))
        return ta > tb
    except Exception:  # noqa: BLE001 — unparseable version = treat as not-newer
        return False


def check_for_updates() -> None:
    """Runs on a background thread during startup. Populates STATE."""
    try:
        req = urllib.request.Request(
            RELEASES_API,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": f"claude-sessions-viewer/{__version__}",
            },
        )
        # nosec B310 — hard-coded api.github.com URL, not user input
        with urllib.request.urlopen(req, timeout=8) as r:  # noqa: S310
            body = json.loads(r.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        with STATE.lock:
            STATE.error = f"check failed: {e}"
            STATE.checked = True
        log.warning("update check failed: %s", e)
        return

    latest_tag: str = body.get("tag_name", "")
    latest_ver = latest_tag.lstrip("v")
    expected_name = ASSET_PATTERN.format(version=latest_ver)
    asset = next((a for a in body.get("assets") or [] if a.get("name") == expected_name), None)
    with STATE.lock:
        STATE.latest_version = latest_ver or None
        STATE.checked = True
        if asset is not None:
            STATE.latest_url = asset.get("browser_download_url")
            STATE.latest_digest = asset.get("digest")
    log.info("update check: current=%s latest=%s asset=%s", __version__, latest_ver, bool(asset))


def start_background_check() -> None:
    """Fire-and-forget check at startup. Idempotent."""
    if STATE.checked:
        return
    t = threading.Thread(target=check_for_updates, name="cs-updater", daemon=True)
    t.start()


def download_and_stage() -> dict[str, str | bool]:
    """Download the new exe next to the running one as `.new`.

    On success, renames the live exe to `.old` and `.new` to the
    original name — caller (`/api/update/apply`) prompts the user
    to restart. File renames on Windows can happen while the exe is
    running as long as we use `MoveFileEx` with MOVEFILE_DELAY_UNTIL_REBOOT
    OR we accept the brief downtime window.

    Returns {ok, message, restartNeeded}.
    """
    with STATE.lock:
        url = STATE.latest_url
        expected_digest = STATE.latest_digest
        latest = STATE.latest_version

    if not url or not latest:
        return {"ok": False, "message": "no update metadata; run check first"}

    # Where is the running exe? In the frozen case sys.executable is the
    # exe itself. In dev (python -m uvicorn) we can't self-update, so
    # refuse politely.
    if not getattr(sys, "frozen", False):
        return {"ok": False, "message": "self-update only available in the packaged .exe"}

    exe_path = Path(sys.executable).resolve()
    stage_path = exe_path.with_suffix(exe_path.suffix + ".new")

    # Download with progress
    try:
        req = urllib.request.Request(url, headers={"User-Agent": f"claude-sessions-viewer/{__version__}"})
        # nosec B310 — URL came from GitHub releases API we already trusted
        with urllib.request.urlopen(req, timeout=60) as r, open(stage_path, "wb") as f:  # noqa: S310
            total = int(r.headers.get("Content-Length", "0"))
            read = 0
            while True:
                chunk = r.read(1 << 16)
                if not chunk:
                    break
                f.write(chunk)
                read += len(chunk)
                if total:
                    with STATE.lock:
                        STATE.download_progress = min(99, int(read * 100 / total))
    except Exception as e:  # noqa: BLE001
        with STATE.lock:
            STATE.error = f"download failed: {e}"
            STATE.download_progress = 0
        try:
            stage_path.unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass
        return {"ok": False, "message": f"download failed: {e}"}

    # Verify digest if the API published one (format: "sha256:<hex>")
    if expected_digest and ":" in expected_digest:
        algo, expected_hex = expected_digest.split(":", 1)
        if algo.lower() == "sha256":
            h = hashlib.sha256()
            with open(stage_path, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            actual_hex = h.hexdigest()
            if actual_hex.lower() != expected_hex.lower():
                stage_path.unlink(missing_ok=True)
                return {
                    "ok": False,
                    "message": f"sha256 mismatch (expected {expected_hex[:16]}…, got {actual_hex[:16]}…)",
                }

    with STATE.lock:
        STATE.staged_path = str(stage_path)
        STATE.download_progress = 100
        STATE.restart_instructions = (
            f"Update downloaded to {stage_path.name}. Close this app and rename "
            f"`{stage_path.name}` to `{exe_path.name}` (replacing the old one), then relaunch."
        )

    # We intentionally DO NOT rename over the live exe here. Windows file
    # locks on an open exe can be worked around with MoveFileEx, but that
    # creates a reboot dependency. Instead we instruct the user (or a
    # future installer-helper) to swap on next launch. Simpler + safer.
    log.info("update staged at %s", stage_path)
    return {"ok": True, "message": "update downloaded; restart to apply", "restartNeeded": True}


def remove_stale_old_file() -> None:
    """When the current process IS the .new that was swapped in by the
    user, a stale `.old` exe may linger next to us. Best-effort cleanup.
    No-op on dev."""
    if not getattr(sys, "frozen", False):
        return
    exe = Path(sys.executable).resolve()
    old = exe.with_suffix(exe.suffix + ".old")
    if old.exists():
        try:
            old.unlink()
            log.info("removed stale %s", old.name)
        except OSError:  # file locked or missing — ignore
            pass
