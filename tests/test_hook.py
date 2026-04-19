"""Tests for hooks/session_start.py — the Claude Code hook that stamps
terminal tab titles. Runs in CI without any real Claude Code install.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / "hooks" / "session_start.py"


def _run_hook(payload: dict, claude_home: Path) -> tuple[str, int]:
    env = os.environ.copy()
    # The hook reads labels from HOME/.claude; override HOME to the fixture.
    env["HOME"] = str(claude_home.parent)
    env["USERPROFILE"] = str(claude_home.parent)
    p = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
        timeout=5,
    )
    return p.stdout, p.returncode


def test_session_start_emits_osc0(claude_home):
    out, rc = _run_hook(
        {"session_id": "abcdef01-2345-6789-abcd-ef0123456789", "hook_event_name": "SessionStart"},
        claude_home,
    )
    assert rc == 0
    assert "\x1b]0;cc-abcdef01\x07" in out


def test_user_prompt_submit_returns_session_title_json(claude_home):
    out, rc = _run_hook(
        {"session_id": "abcdef01-2345-6789-abcd-ef0123456789", "hook_event_name": "UserPromptSubmit"},
        claude_home,
    )
    assert rc == 0
    body = json.loads(out)
    assert body["hookSpecificOutput"]["sessionTitle"] == "cc-abcdef01"


def test_hook_respects_user_label(claude_home, tmp_path):
    labels_dir = claude_home.parent / ".claude"
    labels_dir.mkdir(parents=True, exist_ok=True)
    (labels_dir / "viewer-labels.json").write_text(
        json.dumps({"abcdef01-2345-6789-abcd-ef0123456789": {"userLabel": "MyLabel"}})
    )
    out, rc = _run_hook(
        {"session_id": "abcdef01-2345-6789-abcd-ef0123456789", "hook_event_name": "SessionStart"},
        claude_home,
    )
    assert rc == 0
    assert "MyLabel" in out
    assert "abcdef01" in out
