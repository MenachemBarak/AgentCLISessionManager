"""Pytest fixtures: point the backend at a mock CLAUDE_HOME with sample JSONL
sessions. This makes the full app testable in CI without any real Claude Code
install, tokens, or user data.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FIXTURE_HOME = ROOT / "tests" / "fixtures" / "claude-home"


@pytest.fixture(scope="session")
def claude_home(tmp_path_factory) -> Path:
    """Copy the fixture tree to a tmp dir so tests can mutate (labels, etc)."""
    import shutil

    dst = tmp_path_factory.mktemp("claude-home")
    shutil.copytree(FIXTURE_HOME, dst, dirs_exist_ok=True)
    return dst


@pytest.fixture(scope="session")
def app_module(claude_home):
    os.environ["CLAUDE_HOME"] = str(claude_home)
    # Make `backend` importable regardless of how pytest was invoked.
    sys.path.insert(0, str(ROOT))
    # Force re-import so module-level CLAUDE_HOME picks up the env. Only
    # purge `backend.app` itself — not `backend.providers.*` — because wiping
    # providers would give `ProviderUnavailable` a fresh class identity,
    # breaking the `except ProviderUnavailable` in the registry for any
    # test that relies on it.
    for name in list(sys.modules):
        if name == "backend.app" or name.startswith("backend.app."):
            del sys.modules[name]
    import backend.app as app

    importlib.reload(app)
    app.build_index()
    return app


@pytest.fixture()
def client(app_module):
    from fastapi.testclient import TestClient

    return TestClient(app_module.app)
