"""Unit tests for backend.cli — covers helpers + argv-driven main paths.

Goals:
- Hit `_frontend_dir`, `_free_port`, `_wait_ready` deterministically.
- Drive `main()` through --version / --probe-daemon / --uninstall / --server-only
  branches without actually starting uvicorn or a webview.
- Lift backend.cli line coverage from ~50% toward 80% (T-62).
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

from backend import cli


# ─────────────────────── _frontend_dir ─────────────────────────────
def test_frontend_dir_finds_sibling_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_cli = tmp_path / "cli.py"
    fake_cli.write_text("# stub")
    (tmp_path / "frontend").mkdir()
    monkeypatch.setattr(cli, "__file__", str(fake_cli))
    assert cli._frontend_dir() == (tmp_path / "frontend")


def test_frontend_dir_falls_back_to_meipass(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Sibling missing → look inside _MEIPASS bundle dir.
    fake_cli = tmp_path / "no-sibling" / "cli.py"
    fake_cli.parent.mkdir()
    fake_cli.write_text("# stub")
    meipass = tmp_path / "bundle"
    (meipass / "backend" / "frontend").mkdir(parents=True)
    monkeypatch.setattr(cli, "__file__", str(fake_cli))
    # Set _MEIPASS manually + clean up by hand — monkeypatch.setattr(raising=False)
    # can't undo a deletion if the attr never existed before.
    had_attr = hasattr(sys, "_MEIPASS")
    prev = getattr(sys, "_MEIPASS", None)
    sys._MEIPASS = str(meipass)  # type: ignore[attr-defined]
    try:
        assert cli._frontend_dir() == meipass / "backend" / "frontend"
    finally:
        if had_attr:
            sys._MEIPASS = prev  # type: ignore[attr-defined]
        else:
            delattr(sys, "_MEIPASS")


def test_frontend_dir_raises_when_neither_exists(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_cli = tmp_path / "cli.py"
    fake_cli.write_text("# stub")
    monkeypatch.setattr(cli, "__file__", str(fake_cli))
    if hasattr(sys, "_MEIPASS"):
        monkeypatch.delattr(sys, "_MEIPASS")
    with pytest.raises(RuntimeError, match="frontend/ not found"):
        cli._frontend_dir()


# ─────────────────────── _free_port ────────────────────────────────
def test_free_port_returns_bindable_int() -> None:
    port = cli._free_port()
    assert isinstance(port, int)
    assert 1024 <= port <= 65535


# ─────────────────────── _wait_ready ───────────────────────────────
class _FakeResp:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> _FakeResp:
        return self

    def __exit__(self, *a: object) -> None:
        return None


def test_wait_ready_returns_true_when_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        cli.urllib.request,
        "urlopen",
        lambda *a, **kw: _FakeResp(b'{"ready":true}'),
    )
    assert cli._wait_ready("http://127.0.0.1:9999/", timeout=1.0) is True


def test_wait_ready_returns_true_even_when_indexing(monkeypatch: pytest.MonkeyPatch) -> None:
    # Backend up but mid-index — _wait_ready returns True regardless.
    monkeypatch.setattr(
        cli.urllib.request,
        "urlopen",
        lambda *a, **kw: _FakeResp(b'{"ready":false,"phase":"scanning"}'),
    )
    assert cli._wait_ready("http://127.0.0.1:9999/", timeout=1.0) is True


def test_wait_ready_times_out_when_server_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*a: object, **kw: object) -> None:
        raise OSError("connection refused")

    monkeypatch.setattr(cli.urllib.request, "urlopen", boom)
    monkeypatch.setattr(cli.time, "sleep", lambda _s: None)
    assert cli._wait_ready("http://127.0.0.1:9999/", timeout=0.05) is False


# ─────────────────────── main() — short-circuit branches ───────────
def test_main_version_flag_exits_zero(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        cli.main(["--version"])
    # argparse uses SystemExit(0) for --version
    assert exc.value.code == 0
    out = capsys.readouterr().out + capsys.readouterr().err
    assert "AgentManager" in out or cli.__version__ in out


def test_main_probe_daemon_ours(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    fake_launcher = types.SimpleNamespace(
        probe=lambda port: {"state": "ours", "daemonVersion": "9.9.9"},
    )
    monkeypatch.setitem(sys.modules, "daemon.launcher", fake_launcher)
    rc = cli.main(["--probe-daemon", "--port", "8765"])
    assert rc == 0
    assert "ours" in capsys.readouterr().out


def test_main_probe_daemon_absent(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    fake_launcher = types.SimpleNamespace(probe=lambda port: {"state": "absent"})
    monkeypatch.setitem(sys.modules, "daemon.launcher", fake_launcher)
    rc = cli.main(["--probe-daemon"])
    assert rc == 1
    assert "absent" in capsys.readouterr().err


def test_main_probe_daemon_other_returns_3(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    fake_launcher = types.SimpleNamespace(
        probe=lambda port: {"state": "other", "httpStatus": 502},
    )
    monkeypatch.setitem(sys.modules, "daemon.launcher", fake_launcher)
    rc = cli.main(["--probe-daemon"])
    assert rc == 3
    assert "unrelated process" in capsys.readouterr().err


def test_main_uninstall_dry_run_skips_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    called = {}

    def fake_run(dry_run: bool) -> int:
        called["dry_run"] = dry_run
        return 0

    fake_mod = types.SimpleNamespace(run_uninstall=fake_run)
    monkeypatch.setitem(sys.modules, "daemon.uninstall", fake_mod)
    rc = cli.main(["--uninstall", "--dry-run"])
    assert rc == 0
    assert called == {"dry_run": True}


def test_main_uninstall_aborts_when_user_does_not_type_yes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_mod = types.SimpleNamespace(run_uninstall=lambda dry_run: 0)
    monkeypatch.setitem(sys.modules, "daemon.uninstall", fake_mod)
    monkeypatch.setattr("builtins.input", lambda _prompt="": "no")
    rc = cli.main(["--uninstall"])
    assert rc == 1


def test_main_uninstall_eof_treated_as_no(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_mod = types.SimpleNamespace(run_uninstall=lambda dry_run: 0)
    monkeypatch.setitem(sys.modules, "daemon.uninstall", fake_mod)

    def raise_eof(_prompt: str = "") -> str:
        raise EOFError

    monkeypatch.setattr("builtins.input", raise_eof)
    rc = cli.main(["--uninstall"])
    assert rc == 1


def test_main_uninstall_yes_flag_skips_prompt_and_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    called = {}
    fake_mod = types.SimpleNamespace(
        run_uninstall=lambda dry_run: called.setdefault("dry_run", dry_run) or 0,
    )
    monkeypatch.setitem(sys.modules, "daemon.uninstall", fake_mod)
    rc = cli.main(["--uninstall", "--yes"])
    assert rc == 0
    assert called == {"dry_run": False}


def test_main_server_only_no_browser(monkeypatch: pytest.MonkeyPatch) -> None:
    """--server-only --no-browser path: skip webbrowser.open, hit _run_server."""
    ran: dict = {}

    def fake_run(host: str, port: int, log_level: str) -> None:
        ran["args"] = (host, port, log_level)

    monkeypatch.setattr(cli, "_run_server", fake_run)
    # _frontend_dir is called before this branch — stub to a valid Path.
    monkeypatch.setattr(cli, "_frontend_dir", lambda: Path(__file__).parent)
    rc = cli.main(["--server-only", "--no-browser", "--port", "8765"])
    assert rc == 0
    assert ran["args"] == ("127.0.0.1", 8765, "warning")


def test_main_desktop_mode_pywebview_missing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """If `import webview` fails, main() must return 2 with an install hint."""
    monkeypatch.setattr(cli, "_frontend_dir", lambda: Path(__file__).parent)
    # Force ImportError when cli does `import webview`.
    real_import = __builtins__["__import__"] if isinstance(__builtins__, dict) else __builtins__.__import__

    def fake_import(name: str, *a: object, **kw: object) -> object:
        if name == "webview":
            raise ImportError("no pywebview in test env")
        return real_import(name, *a, **kw)

    monkeypatch.setattr("builtins.__import__", fake_import)
    rc = cli.main([])
    assert rc == 2
    assert "pywebview" in capsys.readouterr().err
