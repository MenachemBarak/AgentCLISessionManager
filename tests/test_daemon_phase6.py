"""Phase 6 unit tests — daemon/uninstall.py + --uninstall CLI.

Covers ADR-18 Law 3 (UNINSTALLABLE): single entry point removes the
state dir, shortcuts, pid file, and kills the running daemon + PTY
grandchildren.

Tests run against a tmp AGENTMANAGER_STATE_DIR override so they can't
touch the real user install.
"""

from __future__ import annotations

import json

import pytest

from backend import cli
from daemon import uninstall


@pytest.fixture
def isolated_install(tmp_path, monkeypatch):
    """Point every install-location helper at a tmp tree."""
    state = tmp_path / "state"
    desktop = tmp_path / "Desktop"
    start_menu = tmp_path / "StartMenu"
    state.mkdir()
    desktop.mkdir()
    start_menu.mkdir(parents=True)

    monkeypatch.setenv("AGENTMANAGER_STATE_DIR", str(state))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    monkeypatch.setenv("APPDATA", str(tmp_path))
    # Rewrite the resolver functions to pick up the env vars fresh.
    monkeypatch.setattr("daemon.uninstall.desktop_shortcut", lambda: desktop / "AgentManager.lnk")
    monkeypatch.setattr(
        "daemon.uninstall.start_menu_shortcut",
        lambda: start_menu / "AgentManager.lnk",
    )
    monkeypatch.setattr(
        "daemon.uninstall.start_menu_uninstall_shortcut",
        lambda: start_menu / "Uninstall AgentManager.lnk",
    )
    return {
        "state": state,
        "desktop": desktop / "AgentManager.lnk",
        "start_menu": start_menu / "AgentManager.lnk",
        "start_menu_uninstall": start_menu / "Uninstall AgentManager.lnk",
    }


def _seed_pid(state: object, pid: int = 99999) -> None:
    state_dir = state  # type: ignore[assignment]
    entry = {"pid": pid, "startTimeEpoch": 1, "daemonVersion": "test"}
    (state_dir / "daemon.pid").write_text(json.dumps(entry), encoding="utf-8")


def test_uninstall_dry_run_touches_nothing(isolated_install, capsys):
    _seed_pid(isolated_install["state"])
    isolated_install["desktop"].write_text("shortcut")
    isolated_install["start_menu"].write_text("shortcut")

    rc = uninstall.run_uninstall(dry_run=True)
    assert rc == 0
    # Nothing removed.
    assert (isolated_install["state"] / "daemon.pid").exists()
    assert isolated_install["desktop"].exists()
    assert isolated_install["start_menu"].exists()
    assert "dry-run" in capsys.readouterr().out


def test_uninstall_removes_state_dir_and_shortcuts(isolated_install):
    _seed_pid(isolated_install["state"])
    (isolated_install["state"] / "token").write_text("deadbeef" * 8)
    (isolated_install["state"] / "layout-state.json").write_text("{}")
    isolated_install["desktop"].write_text("shortcut")
    isolated_install["start_menu"].write_text("shortcut")
    isolated_install["start_menu_uninstall"].write_text("shortcut")

    rc = uninstall.run_uninstall(dry_run=False)
    assert rc == 0
    assert not isolated_install["state"].exists()
    assert not isolated_install["desktop"].exists()
    assert not isolated_install["start_menu"].exists()
    assert not isolated_install["start_menu_uninstall"].exists()


def test_uninstall_is_idempotent_against_clean_install(isolated_install):
    """Run against a system where everything is already gone — must still exit 0."""
    rc = uninstall.run_uninstall(dry_run=False)
    assert rc == 0


def test_uninstall_skips_dead_pid_without_killing(isolated_install, monkeypatch):
    """Stale pid in the file but process is dead — uninstall should not attempt to kill."""
    _seed_pid(isolated_install["state"], pid=99999)
    kill_calls: list[int] = []
    monkeypatch.setattr("daemon.uninstall._pid_is_alive", lambda pid: False)
    monkeypatch.setattr(
        "daemon.uninstall._force_kill_with_pty_tree",
        lambda pid: kill_calls.append(pid),
    )
    monkeypatch.setattr("daemon.uninstall._try_graceful_shutdown", lambda pid, timeout=5.0: True)

    rc = uninstall.run_uninstall(dry_run=False)
    assert rc == 0
    assert kill_calls == [], "must not call TerminateProcess on a dead pid"


def test_uninstall_attempts_graceful_then_force_kill(isolated_install, monkeypatch):
    _seed_pid(isolated_install["state"], pid=12345)
    graceful_calls: list[int] = []
    force_calls: list[int] = []
    alive = [True, True, False]  # graceful failed → kill → dead

    def _alive(_pid: int) -> bool:
        return alive.pop(0) if alive else False

    def _graceful(pid: int, timeout: float = 5.0) -> bool:
        graceful_calls.append(pid)
        return False  # failed → caller must fall through to force-kill

    def _force(pid: int) -> None:
        force_calls.append(pid)

    monkeypatch.setattr("daemon.uninstall._pid_is_alive", _alive)
    monkeypatch.setattr("daemon.uninstall._try_graceful_shutdown", _graceful)
    monkeypatch.setattr("daemon.uninstall._force_kill_with_pty_tree", _force)

    rc = uninstall.run_uninstall(dry_run=False)
    assert rc == 0
    assert graceful_calls == [12345]
    assert force_calls == [12345]


# ─────────────────────── CLI contract ───────────────────────


def test_cli_uninstall_dry_run_with_yes(isolated_install, capsys):
    rc = cli.main(["--uninstall", "--yes", "--dry-run"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "dry-run" in out


def test_cli_uninstall_without_yes_aborts_on_non_yes_input(isolated_install, monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", lambda _prompt="": "no")
    rc = cli.main(["--uninstall"])
    assert rc == 1
    assert "aborted" in capsys.readouterr().err


def test_cli_uninstall_with_yes_flag_skips_prompt(isolated_install, capsys):
    _seed_pid(isolated_install["state"], pid=99999)
    rc = cli.main(["--uninstall", "--yes"])
    assert rc == 0
    # Shouldn't have asked for input; state dir gone.
    assert not isolated_install["state"].exists()
