"""Unit tests for backend.providers.claude_code.

Hermetic — all tests use tmp_path fixtures, no shared CLAUDE_HOME state.
Targets the 58% baseline: helper functions + provider methods that
don't require a watchdog Observer running. Should lift coverage to
~85%+ on this file alone.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from backend.providers import claude_code as cc

SID = "11111111-1111-4111-8111-111111111111"
JSONL_LINE = (
    '{"type":"user","timestamp":"2026-02-01T09:00:00Z","cwd":"C:/work","gitBranch":"dev",'
    '"message":{"content":"hello world","model":"claude-opus-4-7"}}\n'
)


# ─────────────────────── helpers ─────────────────────────────────────
def test_extract_text_string_passthrough() -> None:
    assert cc._extract_text("hello") == "hello"


def test_extract_text_list_of_text_blocks() -> None:
    blocks = [
        {"type": "text", "text": "hi"},
        {"type": "text", "text": "there"},
        {"type": "tool_use", "text": "ignored"},
    ]
    assert cc._extract_text(blocks) == "hi\nthere"


def test_extract_text_other_returns_empty() -> None:
    assert cc._extract_text(None) == ""
    assert cc._extract_text(42) == ""


def test_is_meta_explicit_flag() -> None:
    assert cc._is_meta({"isMeta": True}) is True


def test_is_meta_empty_text_treated_as_meta() -> None:
    assert cc._is_meta({"message": {"content": ""}}) is True


def test_is_meta_local_command_treated_as_meta() -> None:
    obj = {"message": {"content": "<local-command-stdout>foo"}}
    assert cc._is_meta(obj) is True


def test_is_meta_caveat_treated_as_meta() -> None:
    obj = {"message": {"content": "Caveat: the assistant said..."}}
    assert cc._is_meta(obj) is True


def test_is_meta_real_user_message_is_not_meta() -> None:
    obj = {"message": {"content": "what's up"}}
    assert cc._is_meta(obj) is False


def test_iter_lines_skips_blank_and_malformed(tmp_path: Path) -> None:
    p = tmp_path / "s.jsonl"
    p.write_text('\n{"a":1}\nnot-json\n{"b":2}\n', encoding="utf-8")
    objs = list(cc._iter_lines(p))
    assert objs == [{"a": 1}, {"b": 2}]


def test_iter_lines_returns_empty_on_missing_file(tmp_path: Path) -> None:
    assert list(cc._iter_lines(tmp_path / "does-not-exist.jsonl")) == []


def test_scan_tail_claude_title_finds_latest(tmp_path: Path) -> None:
    p = tmp_path / "s.jsonl"
    p.write_text(
        '{"type":"user","message":{"content":"x"}}\n'
        '{"type":"custom-title","customTitle":"first"}\n'
        '{"type":"custom-title","customTitle":"latest"}\n',
        encoding="utf-8",
    )
    assert cc._scan_tail_claude_title(p) == "latest"


def test_scan_tail_claude_title_returns_none_when_absent(tmp_path: Path) -> None:
    p = tmp_path / "s.jsonl"
    p.write_text('{"type":"user","message":{"content":"x"}}\n', encoding="utf-8")
    assert cc._scan_tail_claude_title(p) is None


def test_scan_tail_claude_title_returns_none_for_missing_file(tmp_path: Path) -> None:
    assert cc._scan_tail_claude_title(tmp_path / "missing.jsonl") is None


def test_scan_tail_claude_title_handles_malformed_line(tmp_path: Path) -> None:
    p = tmp_path / "s.jsonl"
    p.write_text(
        'not-json with "custom-title" string\n' '{"type":"custom-title","customTitle":"good"}\n',
        encoding="utf-8",
    )
    assert cc._scan_tail_claude_title(p) == "good"


# ─────────────────────── ClaudeCodeProvider ──────────────────────────
def _make_provider(tmp_path: Path) -> cc.ClaudeCodeProvider:
    home = tmp_path / "claude"
    (home / "projects" / "C--work").mkdir(parents=True)
    return cc.ClaudeCodeProvider(home_dir=home)


def _seed_session(provider: cc.ClaudeCodeProvider, sid: str = SID) -> Path:
    f = provider.projects_dir / "C--work" / f"{sid}.jsonl"
    f.write_text(JSONL_LINE, encoding="utf-8")
    return f


def test_init_with_explicit_home_dir(tmp_path: Path) -> None:
    p = cc.ClaudeCodeProvider(home_dir=tmp_path)
    assert p.home_dir == tmp_path
    assert p.projects_dir == tmp_path / "projects"
    assert p.active_dir == tmp_path / "sessions"


def test_init_with_claude_home_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLAUDE_HOME", str(tmp_path))
    p = cc.ClaudeCodeProvider()
    assert p.home_dir == tmp_path.resolve()


def test_init_default_home_when_no_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CLAUDE_HOME", raising=False)
    p = cc.ClaudeCodeProvider()
    assert p.home_dir == Path(os.path.expanduser("~")) / ".claude"


def test_load_labels_returns_empty_on_missing_file(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    assert p._load_labels() == {}


def test_load_labels_returns_empty_on_corrupt_file(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    p.labels_file.parent.mkdir(parents=True, exist_ok=True)
    p.labels_file.write_text("not json", encoding="utf-8")
    assert p._load_labels() == {}


def test_load_labels_returns_empty_on_non_dict_payload(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    p.labels_file.parent.mkdir(parents=True, exist_ok=True)
    p.labels_file.write_text("[]", encoding="utf-8")
    assert p._load_labels() == {}


def test_set_user_label_writes_and_reads_back(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    p.set_user_label(SID, "  my label  ")
    assert p.get_user_label(SID) == "my label"
    saved = json.loads(p.labels_file.read_text(encoding="utf-8"))
    assert saved[SID]["userLabel"] == "my label"
    assert "userAt" in saved[SID]


def test_set_user_label_truncates_to_80_chars(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    p.set_user_label(SID, "x" * 200)
    assert len(p.get_user_label(SID) or "") == 80


def test_set_user_label_none_clears_label(tmp_path: Path) -> None:
    """Setting label=None pops userLabel; userAt timestamp may remain
    (the entry only fully drops when nothing else is in it)."""
    p = _make_provider(tmp_path)
    p.set_user_label(SID, "label")
    p.set_user_label(SID, None)
    assert p.get_user_label(SID) is None


def test_set_user_label_drops_entry_when_only_label(tmp_path: Path) -> None:
    """If userLabel is the only key, the whole sid entry is removed."""
    p = _make_provider(tmp_path)
    # Seed a label-only entry directly so userAt isn't auto-set.
    p.labels_file.parent.mkdir(parents=True, exist_ok=True)
    p.labels_file.write_text(json.dumps({SID: {"userLabel": "x"}}), encoding="utf-8")
    p.set_user_label(SID, None)
    assert SID not in p._load_labels()


def test_set_user_label_empty_string_clears(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    p.set_user_label(SID, "label")
    p.set_user_label(SID, "   ")
    assert p.get_user_label(SID) is None


def test_set_user_label_preserves_other_keys(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    p.labels_file.parent.mkdir(parents=True, exist_ok=True)
    p.labels_file.write_text(json.dumps({SID: {"pinned": True}}), encoding="utf-8")
    p.set_user_label(SID, None)
    assert p._load_labels()[SID] == {"pinned": True}


def test_get_user_label_returns_none_for_unknown(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    assert p.get_user_label("missing") is None


def test_get_user_label_handles_non_dict_entry(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    p.labels_file.parent.mkdir(parents=True, exist_ok=True)
    p.labels_file.write_text(json.dumps({SID: "legacy-string"}), encoding="utf-8")
    assert p.get_user_label(SID) is None


def test_is_indexable_rejects_wrong_extension(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    assert p.is_indexable_session_path(p.projects_dir / "C--work" / f"{SID}.txt") is False


def test_is_indexable_rejects_subagents_dir(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    assert p.is_indexable_session_path(p.projects_dir / "C--work" / "subagents" / f"{SID}.jsonl") is False


def test_is_indexable_rejects_non_uuid(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    assert p.is_indexable_session_path(p.projects_dir / "C--work" / "not-a-uuid.jsonl") is False


def test_is_indexable_rejects_outside_projects(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    assert p.is_indexable_session_path(tmp_path / "elsewhere" / f"{SID}.jsonl") is False


def test_is_indexable_rejects_wrong_depth(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    # Direct child of projects_dir is wrong depth (depth==1, expects 2).
    assert p.is_indexable_session_path(p.projects_dir / f"{SID}.jsonl") is False


def test_is_indexable_accepts_valid_session(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    assert p.is_indexable_session_path(p.projects_dir / "C--work" / f"{SID}.jsonl") is True


def test_all_jsonl_returns_empty_when_no_projects_dir(tmp_path: Path) -> None:
    home = tmp_path / "no-claude"
    home.mkdir()
    p = cc.ClaudeCodeProvider(home_dir=home)
    assert p._all_jsonl() == []


def test_all_jsonl_filters_subagents_and_non_uuids(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    valid = _seed_session(p)
    (p.projects_dir / "C--work" / "subagents").mkdir()
    (p.projects_dir / "C--work" / "subagents" / f"{SID}.jsonl").write_text("{}", encoding="utf-8")
    (p.projects_dir / "C--work" / "garbage.jsonl").write_text("{}", encoding="utf-8")
    assert p._all_jsonl() == [valid]


def test_scan_session_meta_missing_file_returns_none(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    assert p._scan_session_meta(tmp_path / "missing.jsonl") is None


def test_scan_session_meta_falls_back_to_dir_when_no_cwd(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = p.projects_dir / "C--Users-foo" / f"{SID}.jsonl"
    f.parent.mkdir(parents=True)
    f.write_text('{"type":"user","message":{"content":"hi"}}\n', encoding="utf-8")
    meta = p._scan_session_meta(f)
    assert meta is not None
    assert meta["cwd"] == "C:/Users/foo"


def test_scan_session_meta_no_user_message_uses_placeholder_title(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    f.write_text('{"type":"system","message":{"content":""}}\n', encoding="utf-8")
    meta = p._scan_session_meta(f)
    assert meta is not None
    assert meta["title"].startswith("(no user message)")


def test_scan_session_meta_records_branch_model_first_messages(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    meta = p._scan_session_meta(f, deep=True)
    assert meta is not None
    assert meta["branch"] == "dev"
    assert meta["model"] == "claude-opus-4-7"
    assert meta["firstUserMessages"] == ["hello world"]
    assert meta["title"] == "hello world"


def test_activity_for_streaming_thinking_active(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    now = f.stat().st_mtime
    # streaming: age < 3
    os.utime(f, (now, now))
    assert p._activity_for(f) == "streaming"
    # thinking: age in [3, 15)
    os.utime(f, (now - 5, now - 5))
    assert p._activity_for(f) == "thinking"
    # active: age >= 15
    os.utime(f, (now - 30, now - 30))
    assert p._activity_for(f) == "active"


def test_active_ids_empty_when_no_dir(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    assert p.active_ids() == set()


def test_active_ids_skips_dead_pids(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    p = _make_provider(tmp_path)
    p.active_dir.mkdir(parents=True)
    (p.active_dir / "1234.json").write_text(json.dumps({"pid": 1234, "sessionId": SID}))
    monkeypatch.setattr(cc.psutil, "pid_exists", lambda pid: False)
    assert p.active_ids() == set()


def test_active_ids_picks_up_live_pids(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    p = _make_provider(tmp_path)
    p.active_dir.mkdir(parents=True)
    (p.active_dir / "1234.json").write_text(json.dumps({"pid": 1234, "sessionId": SID}))
    monkeypatch.setattr(cc.psutil, "pid_exists", lambda pid: True)
    assert p.active_ids() == {SID}


def test_active_ids_skips_corrupt_marker(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    p.active_dir.mkdir(parents=True)
    (p.active_dir / "bad.json").write_text("not json")
    assert p.active_ids() == set()


def test_build_index_and_discover(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    _seed_session(p)
    p.build_index()
    assert SID in p._index
    progress = p.index_progress()
    assert progress["ready"] is True
    rows = p.discover()
    assert any(r["id"] == SID for r in rows)


def test_build_index_uses_mtime_cache(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    p.build_index()
    p._index[SID]["title"] = "MARKER"  # mutate cached entry
    p.build_index()  # mtime hasn't changed → should hit cache, leave marker
    assert p._index[SID]["title"] == "MARKER"
    # Touch the file to bust the cache.
    new_mtime = f.stat().st_mtime + 100
    os.utime(f, (new_mtime, new_mtime))
    p.build_index()
    assert p._index[SID]["title"] != "MARKER"


def test_discover_attaches_user_label(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    _seed_session(p)
    p.set_user_label(SID, "tagged")
    rows = p.discover()
    row = next(r for r in rows if r["id"] == SID)
    assert row["userLabel"] == "tagged"


def test_discover_marks_active(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    p = _make_provider(tmp_path)
    _seed_session(p)
    p.active_dir.mkdir(parents=True)
    (p.active_dir / "1234.json").write_text(json.dumps({"pid": 1234, "sessionId": SID}))
    monkeypatch.setattr(cc.psutil, "pid_exists", lambda pid: True)
    rows = p.discover()
    row = next(r for r in rows if r["id"] == SID)
    assert row["active"] is True
    assert row["activityLabel"] in ("streaming", "thinking", "active")


def test_preview_returns_none_for_unknown(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    p.build_index()
    assert p.preview("missing") is None
    assert p.preview_raw("missing") is None


def test_preview_returns_first_user_messages(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    _seed_session(p)
    p.build_index()
    pv = p.preview(SID)
    assert pv is not None
    assert pv["firstUserMessages"] == ["hello world"]


def test_preview_raw_returns_full_meta(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    _seed_session(p)
    p.build_index()
    raw = p.preview_raw(SID)
    assert raw is not None
    assert raw["id"] == SID
    assert raw["model"] == "claude-opus-4-7"


def test_transcript_returns_user_messages_in_order(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    f.write_text(
        '{"type":"user","timestamp":"2026-02-01T09:00:00Z","message":{"content":"first"}}\n'
        '{"type":"assistant","timestamp":"2026-02-01T09:00:01Z","message":{"content":"reply"}}\n'
        '{"type":"user","isMeta":true,"message":{"content":"meta"}}\n'
        '{"type":"system","message":{"content":"sys"}}\n',
        encoding="utf-8",
    )
    p.build_index()
    msgs = p.transcript(SID, limit=10)
    roles = [m["role"] for m in msgs]
    assert roles == ["user", "assistant"]
    assert msgs[0]["content"] == "first"


def test_transcript_returns_empty_for_unknown(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    p.build_index()
    assert p.transcript("missing") == []


def test_transcript_respects_limit(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    body = "".join(
        f'{{"type":"user","timestamp":"2026-02-01T09:00:0{i % 10}Z","message":{{"content":"m{i}"}}}}\n'
        for i in range(5)
    )
    f.write_text(body, encoding="utf-8")
    p.build_index()
    assert len(p.transcript(SID, limit=2)) == 2


def test_resume_command_includes_skip_permissions_flag(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    cmd = p.resume_command(SID)
    assert cmd[0] == "claude"
    assert "--dangerously-skip-permissions" in cmd
    assert SID in cmd


def test_upsert_from_path_returns_none_for_non_indexable(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    assert p.upsert_from_path(p.projects_dir / "garbage.txt") is None


def test_upsert_from_path_returns_none_when_file_missing(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = p.projects_dir / "C--work" / f"{SID}.jsonl"
    # Don't create the file.
    assert p.upsert_from_path(f) is None


def test_upsert_from_path_creates_then_updates(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    out, is_new = p.upsert_from_path(f)  # type: ignore[misc]
    assert is_new is True
    assert out["id"] == SID
    out2, is_new2 = p.upsert_from_path(f)  # type: ignore[misc]
    assert is_new2 is False


def test_evict_from_path_returns_sid_when_present(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    p.upsert_from_path(f)
    assert p.evict_from_path(f) == SID
    assert SID not in p._index


def test_evict_from_path_returns_none_for_unknown(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = p.projects_dir / "C--work" / f"{SID}.jsonl"
    assert p.evict_from_path(f) is None


def test_evict_under_dir_evicts_only_matching(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f1 = _seed_session(p, sid=SID)
    sid2 = "22222222-2222-4222-8222-222222222222"
    other_dir = p.projects_dir / "C--other"
    other_dir.mkdir()
    f2 = other_dir / f"{sid2}.jsonl"
    f2.write_text(JSONL_LINE, encoding="utf-8")
    p.upsert_from_path(f1)
    p.upsert_from_path(f2)
    evicted = p.evict_under_dir(p.projects_dir / "C--work")
    assert evicted == [SID]
    assert sid2 in p._index


# ─────────────────────── _Watcher (direct method calls) ──────────────
def test_watcher_upsert_emits_session_created_then_updated(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    events: list[dict[str, Any]] = []
    w = cc._Watcher(p, events.append)
    w._upsert(str(f))
    w._upsert(str(f))
    types = [e["type"] for e in events]
    assert types == ["session_created", "session_updated"]


def test_watcher_upsert_ignores_non_indexable(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    events: list[dict[str, Any]] = []
    w = cc._Watcher(p, events.append)
    w._upsert(str(p.projects_dir / "garbage.txt"))
    assert events == []


def test_watcher_evict_emits_session_deleted(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    p.upsert_from_path(f)
    events: list[dict[str, Any]] = []
    w = cc._Watcher(p, events.append)
    w._evict(str(f))
    assert events == [{"type": "session_deleted", "id": SID}]


def test_watcher_evict_silent_on_unknown(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    events: list[dict[str, Any]] = []
    w = cc._Watcher(p, events.append)
    w._evict(str(f))
    assert events == []


class _FakeEvent:
    def __init__(self, src: str, dest: str = "", is_dir: bool = False) -> None:
        self.src_path = src
        self.dest_path = dest
        self.is_directory = is_dir


def test_watcher_on_created_calls_upsert(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    events: list[dict[str, Any]] = []
    w = cc._Watcher(p, events.append)
    w.on_created(_FakeEvent(str(f)))
    assert events and events[0]["type"] == "session_created"


def test_watcher_on_created_ignores_directory_events(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    events: list[dict[str, Any]] = []
    w = cc._Watcher(p, events.append)
    w.on_created(_FakeEvent(str(p.projects_dir), is_dir=True))
    assert events == []


def test_watcher_on_modified_calls_upsert(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    events: list[dict[str, Any]] = []
    w = cc._Watcher(p, events.append)
    w.on_modified(_FakeEvent(str(f)))
    assert events and events[0]["type"] == "session_created"


def test_watcher_on_deleted_directory_bulk_evicts(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    p.upsert_from_path(f)
    events: list[dict[str, Any]] = []
    w = cc._Watcher(p, events.append)
    w.on_deleted(_FakeEvent(str(p.projects_dir / "C--work"), is_dir=True))
    assert {e["id"] for e in events if e["type"] == "session_deleted"} == {SID}


def test_watcher_on_deleted_file_evicts_one(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    p.upsert_from_path(f)
    events: list[dict[str, Any]] = []
    w = cc._Watcher(p, events.append)
    w.on_deleted(_FakeEvent(str(f)))
    assert events == [{"type": "session_deleted", "id": SID}]


def test_watcher_on_moved_evicts_then_upserts(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    f = _seed_session(p)
    p.upsert_from_path(f)
    new_dir = p.projects_dir / "C--moved"
    new_dir.mkdir()
    new_path = new_dir / f"{SID}.jsonl"
    f.rename(new_path)
    events: list[dict[str, Any]] = []
    w = cc._Watcher(p, events.append)
    w.on_moved(_FakeEvent(str(f), dest=str(new_path)))
    types = [e["type"] for e in events]
    assert "session_deleted" in types
    assert "session_created" in types or "session_updated" in types


def test_watcher_on_moved_ignores_directory_events(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    events: list[dict[str, Any]] = []
    w = cc._Watcher(p, events.append)
    w.on_moved(_FakeEvent(str(p.projects_dir), dest=str(tmp_path), is_dir=True))
    assert events == []


# ─────────────────────── start/stop_watcher ──────────────────────────
def test_start_watcher_no_op_when_projects_dir_missing(tmp_path: Path) -> None:
    home = tmp_path / "no-claude"
    home.mkdir()
    p = cc.ClaudeCodeProvider(home_dir=home)
    p.start_watcher(lambda _ev: None)
    assert p._observer is None


def test_start_then_stop_watcher_lifecycle(tmp_path: Path) -> None:
    p = _make_provider(tmp_path)
    p.start_watcher(lambda _ev: None)
    assert p._observer is not None
    # idempotent: a second start is a no-op (observer already set)
    p.start_watcher(lambda _ev: None)
    p.stop_watcher()
    assert p._observer is None
    # stop is idempotent too
    p.stop_watcher()
