# ADR-18: Daemon/UI split for zero-downtime upgrades

**Status:** ACCEPTED (2026-04-24) — user-approved with three hard constraints.
**Tracks:** Task #42 (ARCH: decouple session-liveness from platform layer).
**Supersedes:** portions of ADR-16 (shell-wrap) — the shell-wrap design survives; its owner moves daemon-side.

## The three laws (user directive — non-negotiable)

Every design choice below is judged against these first:

1. **INVISIBLE** — no tray icon, no extra Start-menu entry, no console flash, no taskbar button for the daemon, no firewall-prompt dialog. From the user's perspective there is one app (`AgentManager.exe`); the daemon is a kernel-level implementation detail they never see.
2. **FULLY TESTABLE** — every invariant below has at least one e2e test that would fail if the invariant broke. No "manual verification only" holes. Failing-test-first per ADR-17.
3. **UNINSTALLABLE** — a single user action removes everything: both exes, daemon pid file, layout state, ring buffers, registry entries (if any), Desktop + Start-menu shortcuts, `%LOCALAPPDATA%\AgentManager\` tree. No orphaned daemon process, no orphaned PTYs, no "hidden data still on disk" surprises.

These are check-gates. Any sub-decision that conflicts with them is rejected regardless of other merits.

## Problem

Today every PTY child (cmd.exe + claude) is a direct child of the AgentManager `.exe`. When the user clicks **Restart & apply** in the update banner, the swap helper kills the exe, every PTY dies with it, and the new viewer cold-starts with empty shells. Layout persistence restores tabs; scrollback and in-flight work are lost.

Same failure mode applies to crash, force-quit, or OS reboot without shutdown — tolerable as rare. **Self-update is not rare.** We want the user to update frequently, which means the cost of each update has to approach zero.

## Architecture — two-exe split

```
┌────────────────────────────────┐     ┌──────────────────────────────┐
│  AgentManager.exe (UI)         │     │  AgentManager-Daemon.exe     │
│  pywebview + React             │◀───▶│  FastAPI + PTYs + watchdog   │
│  short-lived (user session)    │ WS  │  long-lived (until reboot or │
│  updates often                 │HTTP │   explicit uninstall)        │
└────────────────────────────────┘     └──────────────────────────────┘
```

- **Daemon owns:** PTY processes, WebSocket server, JSONL index + watchdog, SSE stream, update poller, layout-state store, ring buffer per PTY.
- **UI owns:** pywebview window, React bundle, xterm.js client. Connects to daemon's HTTP + WS exactly as a browser tab would.
- **Daemon autostart:** UI probes `127.0.0.1:8765/api/health` on launch. If up → connect. If not → spawn daemon with `DETACHED_PROCESS` (NOT combined with `CREATE_NO_WINDOW` — they are mutually exclusive per MS `CreateProcessW` docs; `DETACHED_PROCESS` gives no console at all, which is what we want). Poll until health is green. If port is taken by an unrelated process, UI fails fast with a user-legible error — no silent clobbering.
- **Daemon singleton:** pid + start-time + version marker at `%LOCALAPPDATA%\AgentManager\daemon.pid`. Lock via `portalocker` (wraps `msvcrt.locking` on Windows) — exclusive-share lock on the pid file; stale detection compares start-time to psutil. Multiple UI launches share one daemon.
- **IPC authentication:** a per-install 32-byte random bearer token lives at `%LOCALAPPDATA%\AgentManager\token` with user-only ACL (`icacls`-equivalent via `pywin32`). UI reads the token at launch, sends it on every HTTP request + as the first WS frame. Daemon rejects unauthenticated requests with 401. Closes the "any local process can connect to loopback" gap without switching IPC to named pipes. (Named pipes were considered — VSCode, Docker, WezTerm all use them — but would require a pipe↔HTTP adapter in the UI shim because WebKit inside pywebview can't speak named pipes from JS.)

## Why two exes (alternatives rejected)

1. **DETACHED_PROCESS / setsid on the current exe.** ConPTY binds each child to the spawning console; detaching after spawn loses the PTY pipe. Structurally impossible.
2. **Share one exe but relaunch with the new binary keeping the old PTYs.** Running .exe holds exclusive image lock on Windows; can't share PTY pipes cross-process without a daemon intermediary. That intermediary IS the daemon — so we'd build the daemon anyway, just disguised.
3. **Windows Service.** Requires elevation to install (UAC). AgentManager installs per-user under `%LOCALAPPDATA%` deliberately and must keep that property. Rejected.
4. **Don't fix it; tell users to finish claude tasks before updating.** Rejected — violates user explicit directive, defeats the purpose of self-update.

Two-exe local daemon is the VSCode / Cursor / Docker Desktop pattern. Proven.

## How each law is enforced

### Law 1: INVISIBLE

- **No tray icon.** Daemon has no system-tray presence at all.
- **No taskbar button.** Spawned with `DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB`. No console, no HWND, no message pump.
- **No console flash.** Built with `console=False` in PyInstaller spec.
- **No firewall prompt.** Daemon binds `127.0.0.1` only, never `0.0.0.0`. Windows Defender Firewall by default only prompts on first external-interface bind, so loopback-only = silent. Verified by a test that greps netstat for the bind address after daemon start.
- **No Start-menu daemon entry.** Installer drops one shortcut: `AgentManager.lnk → AgentManager.exe`. No `AgentManager-Daemon.lnk`.
- **No auto-start at boot.** Daemon is NOT a Startup/Run-key entry. It starts when the user launches the UI, stops when the user uninstalls or reboots.
- **No log window or notifications.** Daemon logs to `%LOCALAPPDATA%\AgentManager\logs\daemon.log` (rotated, capped at 10 MB). No desktop notifications, no toast, no message boxes ever.

### Law 2: FULLY TESTABLE

Every invariant below gets a dedicated Playwright spec. All failing-first per ADR-17:

| Invariant | Test file |
|---|---|
| UI launch with no daemon → daemon spawns within 5s | `e2e/tests/daemon/autostart.spec.ts` |
| Second UI launch reuses existing daemon (no double-spawn) | `e2e/tests/daemon/singleton.spec.ts` |
| Port 8765 held by unrelated process → UI shows clear error | `e2e/tests/daemon/port-conflict.spec.ts` |
| Daemon binds 127.0.0.1 only (not 0.0.0.0) | `e2e/tests/daemon/loopback-only.spec.ts` |
| Daemon spawn is invisible (no HWND, no tray, no firewall prompt) | `e2e/tests/daemon/invisible.spec.ts` |
| UI restart mid-session → PTY survives + scrollback intact | `e2e/tests/daemon/ui-restart-survives.spec.ts` |
| WS reconnect → ring buffer replayed, then live stream | `e2e/tests/daemon/rehydrate.spec.ts` |
| Ring buffer caps at 256 KB (no OOM on 10 MB producer) | `e2e/tests/daemon/ring-buffer-cap.spec.ts` |
| Daemon crash → UI shows clear state, next launch respawns | `e2e/tests/daemon/crash-fallback.spec.ts` |
| Update flow: UI-only update → no PTY death | `e2e/tests/daemon/update-ui-only.spec.ts` |
| Update flow: daemon update → PTYs restart + restart-ping fires | `e2e/tests/daemon/update-daemon.spec.ts` |
| Uninstall removes all artifacts (exes, pid, logs, state, shortcuts) | `e2e/tests/daemon/uninstall.spec.ts` |
| Uninstall kills running daemon + PTYs | `e2e/tests/daemon/uninstall-kills-daemon.spec.ts` |
| Layout state lives daemon-side, survives UI restart | `e2e/tests/daemon/layout-daemon-side.spec.ts` |
| Two UIs against one daemon → both show same layout | `e2e/tests/daemon/multi-ui.spec.ts` |
| Daemon version mismatch with UI → UI surfaces warning | `e2e/tests/daemon/version-mismatch.spec.ts` |

Backend unit tests cover: ring buffer bounds, pid file locking, port probe, health endpoint shape, PTY adoption on reconnect, graceful shutdown ordering.

Source-contract tests guard against regressions in the spawn flags (CREATE_NO_WINDOW present, firewall scope = loopback) the way `keystroke-splitting.spec.ts` guards the v1.0.0 paste-split rule.

### Law 3: UNINSTALLABLE

Single entry point: `AgentManager.exe --uninstall` (and an "Uninstall AgentManager" shortcut in Start-menu that runs it). Sequence:

1. Look up running daemon PID from `%LOCALAPPDATA%\AgentManager\daemon.pid`.
2. Send `POST /api/shutdown` to the daemon with a 5s timeout. Daemon closes all PTYs gracefully (sends `exit\r` to each shell), writes "clean shutdown" marker, exits.
3. If daemon didn't exit in 5s, kill by PID (TerminateProcess). Walk process tree to kill orphaned PTY children.
4. Remove `%LOCALAPPDATA%\AgentManager\` tree (exes, pid file, layout state, logs, ring buffer dumps, update staging).
5. Remove Desktop shortcut `AgentManager.lnk`.
6. Remove Start-menu shortcuts `AgentManager.lnk` and `Uninstall AgentManager.lnk`.
7. Remove `HKCU\Software\AgentManager` if we ever added registry entries (none in v1 plan — but the uninstaller checks and removes if present, to be robust against future additions).
8. Exit 0.

Hard rule: uninstall must work even if the daemon is already dead, even if the pid file is stale, even if the user already manually deleted files. All seven steps use exists-check + best-effort delete; none abort the sequence.

Test: `uninstall.spec.ts` runs a real install in a temp `%LOCALAPPDATA%` override, creates state in each of the seven locations, runs `--uninstall`, asserts all seven are gone AND no process named AgentManager* remains.

## Ring buffer & rehydrate

- Each `PtySession` gains a `collections.deque` with `maxlen` sized to bytes-not-entries (we wrap it in a `RingBuffer` class that evicts until total_bytes ≤ 256 KB).
- On WS connect with an existing `session_id`, daemon: (a) flushes ring buffer as one `{type:'output', data: <accumulated>, replay: true}` frame, (b) flips to live streaming.
- Replay frame carries `replay: true` so the xterm client can optionally suppress animated re-rendering — write it as a single batched chunk.

## Layout state ownership

Moves from UI-side JSON (`localStorage` + PUT /api/layout-state) to daemon-side JSON (file at `%LOCALAPPDATA%\AgentManager\layout-state.json`). Endpoints stay the same; only the storage implementation changes. Migration: daemon reads existing `layout-state.json` on first boot if present (today's format is already daemon-side actually — confirm during Phase 2).

## v1 scope & non-goals

**In scope (v1.2.0):**
- Extract `backend/` → daemon package; second PyInstaller target.
- UI exe shrinks to: pywebview + frontend bundle + tiny launcher shim.
- Ring buffer per PTY (256 KB cap).
- Rehydrate on reconnect.
- Uninstall CLI + shortcut.
- Updater handles UI-only updates zero-downtime.
- Opt-in: feature-gated by `AGENTMANAGER_DAEMON=1` env var for one release. v1.3.0 flips default on.

**Out of scope for v1:**
- Zero-downtime *daemon* upgrade (daemon updates still restart PTYs, covered by existing restart-ping from T-13).
- Multi-user daemon (one daemon per OS user; `%LOCALAPPDATA%` already isolates).
- Linux/macOS (daemon design is portable but AgentManager ships Windows only).
- Tray icon (explicitly rejected per Law 1).
- Auto-start at boot (explicitly rejected per Law 1).

## Execution plan

Strict phase order. Each phase ends with GREEN tests before moving on.

**Phase 1 — Failing tests first (TDD).** Write all 16 daemon spec files as failing stubs with the invariants encoded. Verify they FAIL against the current v1.1.0 code (no daemon exists). Commit on a branch. ← *starting now*

**Phase 2 — Daemon extraction.** New `daemon/` package that imports from `backend/`. Build `AgentManager-Daemon.exe` via new PyInstaller spec. Daemon runs standalone; existing UI unaffected. Phase-2 tests: daemon can be launched manually, /api/health returns.

**Phase 3 — UI shim + autostart.** UI exe shrinks. Launcher probes port 8765, spawns daemon if needed with invisibility flags, navigates webview. Autostart + singleton + port-conflict + invisible + loopback-only tests go GREEN.

**Phase 4 — Ring buffer + rehydrate.** Per-PTY buffer, replay frame on reconnect, cap enforced. Rehydrate + cap tests go GREEN.

**Phase 5 — UI restart survives.** End-to-end: kill UI exe, relaunch, PTY still alive + scrollback returned. ui-restart-survives + multi-ui tests go GREEN.

**Phase 6 — Uninstall CLI.** `--uninstall` flag, Start-menu shortcut, best-effort cleanup across all seven locations. Uninstall tests go GREEN.

**Phase 7 — Updater dual-asset + migration.** Release workflow builds a zip with both exes; updater downloads + swaps UI only (daemon stays up). Update-ui-only test goes GREEN. Update-daemon test exercises the rare-path restart.

**Phase 8 — Dogfood + polish.** Self-install on my machine, run it for a day, fix what breaks. Version mismatch + crash fallback tests go GREEN.

**Phase 9 — Ship v1.2.0 opt-in.** Release notes describe the flag and what it buys. Monitor issues for a week.

**Phase 10 — v1.3.0 default-on.** Flip the default; flag becomes an escape hatch for users who want to pin the old behavior.

## Timeline estimate

~6-7 days of focused work for Phases 1-9. Daily checkpoints via `/step`.

## Open items (tracked, not blocking)

- Per-PTY ring buffer size tuning (start 256 KB, revisit if users complain about lost scrollback).
- Daemon log rotation policy (default 10 MB cap; single file).
- Security note: daemon exposes HTTP + WS on loopback, gated by a per-install bearer token (see IPC authentication above). Any process running as the same user can read the token file and connect — equivalent to "same user can read your app's state", which is the baseline Windows threat model. Cross-user isolation is provided by NTFS ACL on `%LOCALAPPDATA%` which is per-user by default.

## Research evidence backing these choices (2026-04-24)

- **HPCON is not transferable between processes** (MS `terminal` #4479, #1130) — validates that daemon-owns-PTY is the only correct model. Cannot shortcut with handle inheritance.
- **Windows Defender Firewall does not prompt on loopback binds** (WFP built-in loopback exemption) — validates 127.0.0.1 stays invisible.
- **Reference implementations using this exact pattern:** WezTerm `wezterm-mux-server` (closest analog; daemon + GUI client), VSCode `ptyHost` utility process, VSCode-Server for remote mode, Docker Desktop `com.docker.service` (Windows service variant — rejected for us as too heavy).
- **Squirrel/MSI-based updaters are known to orphan child processes on uninstall** (VSCode, Cursor). Our uninstall CLI explicitly walks the process tree and kills PTY grandchildren to avoid this class of bug.
