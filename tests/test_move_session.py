"""Tests for session-move (relocate a session JSONL between project dirs).

Uses a tmp_path-only filesystem — no fixtures, no Claude Code dependency.
Each test builds the minimal `projects_dir` shape it needs.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from backend import move_session

SID = "11111111-1111-4111-8111-111111111111"


def _seed(projects_dir: Path, encoded_dir: str, session_id: str, body: str) -> Path:
    d = projects_dir / encoded_dir
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{session_id}.jsonl"
    # write_bytes to avoid Windows's newline translation (text mode maps
    # `\n` → `\r\n` on Windows, which breaks the SHA assertion that
    # pre-hashes the Python str.)
    p.write_bytes(body.encode("utf-8"))
    return p


def test_encode_cwd_windows_drive() -> None:
    assert move_session.encode_cwd("C:\\Users\\User") == "C--Users-User"
    assert move_session.encode_cwd("C:/Users/User") == "C--Users-User"


def test_encode_cwd_posix_root_strips_leading_dash() -> None:
    # `/home/me` → `-home-me` then strip leading dash → `home-me`.
    assert move_session.encode_cwd("/home/me") == "home-me"


def test_plan_move_missing_session(tmp_path: Path) -> None:
    proj = tmp_path / "projects"
    proj.mkdir()
    plan = move_session.plan_move(proj, SID, "C:\\new\\place")
    assert plan["safe_to_move"] is False
    assert any("not found" in str(e) for e in plan["errors"])  # type: ignore[union-attr]


def test_plan_move_dest_already_exists(tmp_path: Path) -> None:
    proj = tmp_path / "projects"
    src = _seed(proj, "C--old", SID, '{"line": 1}\n')
    # Pre-create a colliding dest file.
    _seed(proj, "C--new", SID, '{"different": "session"}\n')

    plan = move_session.plan_move(proj, SID, "C:\\new")
    assert plan["safe_to_move"] is False
    assert any("already exists" in str(e) for e in plan["errors"])  # type: ignore[union-attr]
    # Source untouched.
    assert src.exists()


def test_plan_move_no_op_same_dir(tmp_path: Path) -> None:
    proj = tmp_path / "projects"
    _seed(proj, "C--old", SID, "x\n")
    # target_cwd encodes to the same `C--old`.
    plan = move_session.plan_move(proj, SID, "C:/old")
    assert plan["safe_to_move"] is False
    assert any("no-op" in str(e) for e in plan["errors"])  # type: ignore[union-attr]


def test_plan_move_safe_path(tmp_path: Path) -> None:
    proj = tmp_path / "projects"
    body = '{"hello": "world"}\n'
    src = _seed(proj, "C--old", SID, body)
    plan = move_session.plan_move(proj, SID, "C:\\new\\place", must_exist_on_disk=False)
    assert plan["safe_to_move"] is True
    assert plan["target_encoded_dir"] == "C--new-place"
    assert plan["dest_path"].endswith(f"C--new-place\\{SID}.jsonl") or plan["dest_path"].endswith(  # type: ignore[union-attr]
        f"C--new-place/{SID}.jsonl"
    )
    expected_sha = hashlib.sha256(body.encode()).hexdigest()
    assert plan["src_sha256"] == expected_sha
    # Source still untouched (plan is read-only).
    assert src.exists()


def test_execute_move_copies_then_unlinks(tmp_path: Path) -> None:
    proj = tmp_path / "projects"
    body = '{"line": 1}\n{"line": 2}\n'
    src = _seed(proj, "C--old", SID, body)
    src_mtime = src.stat().st_mtime

    result = move_session.execute_move(proj, SID, "C:\\new\\place")
    assert result["ok"] is True

    # Source gone, dest present + identical bytes.
    assert not src.exists()
    dest = proj / "C--new-place" / f"{SID}.jsonl"
    assert dest.exists()
    assert dest.read_text(encoding="utf-8") == body
    # mtime preserved — important for activity-sort stability.
    assert abs(dest.stat().st_mtime - src_mtime) < 1.0


def test_execute_move_refuses_without_safe_plan(tmp_path: Path) -> None:
    proj = tmp_path / "projects"
    # No source seeded → plan_move says not safe → execute_move bails
    # without touching anything.
    result = move_session.execute_move(proj, SID, "C:\\anywhere")
    assert result["ok"] is False
    assert "plan_move refused" in str(result["message"])


def test_move_then_provider_rediscovers_session_at_new_path(tmp_path: Path) -> None:
    """End-to-end proof that a moved session is still discoverable.

    Simulates the user's target workflow: seed a session in dir A,
    move it to dir B, then rebuild the provider's index and assert:
      1. the session id is still in the index
      2. the index entry's `path` now points at dir B
      3. `resume_command(sid)` still works — it's derived from the sid
         alone, so `claude --resume <sid>` keeps working after a move

    We can't invoke the real `claude` binary in a hermetic test (needs
    a real API token), but this is the load-bearing equivalent: if the
    viewer's own provider can find it, then Claude Code's own
    `~/.claude/projects` walker can find it too (same mechanism, same
    filesystem layout).
    """
    from backend.providers.claude_code import ClaudeCodeProvider

    claude_home = tmp_path / ".claude"
    projects = claude_home / "projects"

    # Realistic JSONL line — provider's scan expects at least one
    # `type: user` entry to compute a title.
    body = (
        '{"cwd": "C:/tmp/A", "gitBranch": "HEAD", "timestamp": "2026-04-23T10:00:00Z", '
        '"type": "user", "message": {"role": "user", "content": "hello from A"}}\n'
    )
    _seed(projects, "C--tmp-A", SID, body)

    provider = ClaudeCodeProvider(home_dir=claude_home)
    provider.build_index()
    assert SID in provider._index, "pre-move: provider should find the session"
    assert "C--tmp-A" in provider._index[SID]["path"]

    # Move it.
    result = move_session.execute_move(projects, SID, "C:\\tmp\\B")
    assert result["ok"] is True, f"execute_move failed: {result}"

    # Rebuild the index — this is what the viewer does on `POST /api/rescan`.
    provider._index.clear()
    provider._index_built = False
    provider.build_index()
    assert SID in provider._index, "post-move: provider should still find the session"
    assert (
        "C--tmp-B" in provider._index[SID]["path"]
    ), f"expected new path under C--tmp-B, got {provider._index[SID]['path']}"

    # `claude --resume <sid>` still works after the move — the argv
    # depends on the sid only.
    cmd = provider.resume_command(SID)
    assert cmd[-2:] == ["--resume", SID]
    assert "--dangerously-skip-permissions" in cmd
