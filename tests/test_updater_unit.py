"""Unit tests for backend.updater — pure-function coverage that doesn't
need network or the FastAPI TestClient. Lifts the coverage of
backend/updater.py from ~37% baseline.

We avoid hitting the GitHub API by patching urllib at the module level
where check_for_updates uses it.
"""

from __future__ import annotations

import json
from unittest import mock

import pytest

from backend import updater

# ────────────────────────────── _version_gt ──────────────────────────────


@pytest.mark.parametrize(
    "a,b,expected",
    [
        ("1.0.0", "0.9.9", True),
        ("0.9.9", "1.0.0", False),
        ("1.2.16", "1.2.15", True),
        ("1.2.15", "1.2.16", False),
        ("1.2.15", "1.2.15", False),  # equal — strict >
        ("v1.2.15", "1.2.14", True),  # `v` prefix tolerated
        ("1.2.15", "v1.2.14", True),
        ("99.0.0", "1.2.15", True),
        ("1.2.15", "99.0.0", False),
        ("1.10.0", "1.2.0", True),  # numeric not lexicographic
        ("malformed", "1.0.0", False),  # parse failure → False
        ("1.0.0", "malformed", False),
    ],
)
def test_version_gt(a: str, b: str, expected: bool) -> None:
    assert updater._version_gt(a, b) is expected


# ────────────────────────────── UpdateState ──────────────────────────────


def test_state_snapshot_default_shape() -> None:
    s = updater.UpdateState()
    snap = s.snapshot()
    # Every field the UI consumes must be present.
    for key in [
        "currentVersion",
        "latestVersion",
        "updateAvailable",
        "checked",
        "error",
        "downloadProgress",
        "staged",
        "restartInstructions",
    ]:
        assert key in snap, f"missing key {key} in snapshot"
    # No data means: not staged, no update, not checked.
    assert snap["updateAvailable"] is False
    assert snap["checked"] is False
    assert snap["staged"] is False
    assert snap["downloadProgress"] == 0


def test_state_snapshot_update_available() -> None:
    s = updater.UpdateState()
    s.current_version = "1.0.0"
    s.latest_version = "2.0.0"
    s.checked = True
    snap = s.snapshot()
    assert snap["updateAvailable"] is True
    assert snap["currentVersion"] == "1.0.0"
    assert snap["latestVersion"] == "2.0.0"
    assert snap["checked"] is True


def test_state_snapshot_staged_flag_reflects_path() -> None:
    s = updater.UpdateState()
    assert s.snapshot()["staged"] is False
    s.staged_path = "/tmp/staged.exe"
    assert s.snapshot()["staged"] is True


# ─────────────────────────── check_for_updates ───────────────────────────


class _FakeResponse:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> _FakeResponse:
        return self

    def __exit__(self, *args: object) -> None:
        pass


def _mock_release_body(version: str, with_asset: bool = True) -> bytes:
    payload = {
        "tag_name": f"v{version}",
        "assets": (
            [
                {
                    "name": updater.ASSET_PATTERN.format(version=version),
                    "browser_download_url": f"https://example.test/dl/{version}.exe",
                    "digest": f"sha256:{'a' * 64}",
                }
            ]
            if with_asset
            else []
        ),
    }
    return json.dumps(payload).encode("utf-8")


def test_check_for_updates_populates_state_on_success() -> None:
    state = updater.UpdateState()
    with (
        mock.patch.object(updater, "STATE", state),
        mock.patch.object(
            updater.urllib.request, "urlopen", return_value=_FakeResponse(_mock_release_body("99.0.0"))
        ),
    ):
        updater.check_for_updates()
    assert state.checked is True
    assert state.latest_version == "99.0.0"
    assert state.latest_url is not None
    assert state.latest_url.endswith("99.0.0.exe")
    assert state.error is None


def test_check_for_updates_handles_network_error() -> None:
    state = updater.UpdateState()
    with (
        mock.patch.object(updater, "STATE", state),
        mock.patch.object(updater.urllib.request, "urlopen", side_effect=OSError("fake network error")),
    ):
        updater.check_for_updates()
    assert state.checked is True
    assert state.error is not None
    assert "fake network error" in state.error


def test_check_for_updates_no_matching_asset_leaves_url_unset() -> None:
    state = updater.UpdateState()
    with (
        mock.patch.object(updater, "STATE", state),
        mock.patch.object(
            updater.urllib.request,
            "urlopen",
            return_value=_FakeResponse(_mock_release_body("99.0.0", with_asset=False)),
        ),
    ):
        updater.check_for_updates()
    assert state.checked is True
    assert state.latest_version == "99.0.0"
    assert state.latest_url is None


# ─────────────────────────── start_background_check ──────────────────────


def test_start_background_check_skips_when_already_checked() -> None:
    state = updater.UpdateState()
    state.checked = True
    with mock.patch.object(updater, "STATE", state), mock.patch.object(updater.threading, "Thread") as t:
        updater.start_background_check()
    t.assert_not_called()


def test_start_background_check_spawns_when_unchecked() -> None:
    state = updater.UpdateState()
    state.checked = False
    with mock.patch.object(updater, "STATE", state), mock.patch.object(updater.threading, "Thread") as Thread:
        updater.start_background_check()
    Thread.assert_called_once()
    Thread.return_value.start.assert_called_once()
