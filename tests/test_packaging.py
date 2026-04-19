"""Packaging smoke tests — catch regressions in the distributable wheel
before the release workflow fires.

These tests build a sdist+wheel in a temp dir and assert the shape of
what's inside:
- frontend SPA is bundled (so `pipx install` gives a working product)
- hooks/session_start.py is bundled
- console_script entry point is registered
- version in metadata matches backend.__version__
"""

from __future__ import annotations

import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def built_wheel(tmp_path_factory) -> Path:
    """Build the wheel once per test session into a tmp outdir."""
    outdir = tmp_path_factory.mktemp("dist")
    # --no-isolation would be faster but `build` is the public contract.
    subprocess.run(
        [sys.executable, "-m", "build", "--wheel", "--outdir", str(outdir), str(ROOT)],
        check=True,
        capture_output=True,
        text=True,
    )
    wheels = list(outdir.glob("claude_sessions_viewer-*.whl"))
    assert len(wheels) == 1, f"expected exactly 1 wheel, got {wheels}"
    return wheels[0]


def test_wheel_filename_matches_version(built_wheel: Path) -> None:
    from backend.__version__ import __version__

    assert built_wheel.name == f"claude_sessions_viewer-{__version__}-py3-none-any.whl"


def test_wheel_includes_frontend_spa(built_wheel: Path) -> None:
    with zipfile.ZipFile(built_wheel) as zf:
        names = set(zf.namelist())
    # index.html is the SPA entry — without it the UI can't load.
    assert "backend/frontend/index.html" in names
    # Core React modules must be present too.
    for js in ("app.jsx", "data.jsx", "compact-list.jsx"):
        assert f"backend/frontend/{js}" in names, js


def test_wheel_includes_hook(built_wheel: Path) -> None:
    with zipfile.ZipFile(built_wheel) as zf:
        assert "hooks/session_start.py" in zf.namelist()


def test_wheel_registers_cli_entry_point(built_wheel: Path) -> None:
    with zipfile.ZipFile(built_wheel) as zf:
        entry_points = zf.read(next(n for n in zf.namelist() if n.endswith("entry_points.txt"))).decode()
    assert "[console_scripts]" in entry_points
    assert "claude-sessions-viewer" in entry_points
    assert "backend.cli:main" in entry_points


def test_wheel_metadata_version_matches(built_wheel: Path) -> None:
    from backend.__version__ import __version__

    with zipfile.ZipFile(built_wheel) as zf:
        metadata = zf.read(next(n for n in zf.namelist() if n.endswith("METADATA"))).decode()
    assert f"Version: {__version__}" in metadata
    assert "Name: claude-sessions-viewer" in metadata
