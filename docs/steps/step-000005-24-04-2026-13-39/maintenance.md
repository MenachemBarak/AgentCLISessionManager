# Maintenance — step 000005

## Current install on this machine

- Path: `C:\Users\User\AppData\Local\Programs\AgentManager\AgentManager.exe`
- Version: v1.2.14 (as of this step)
- Install shape: **raw-exe swap chain** (no Inno `unins000.exe` present). Chain of backups:
  - `AgentManager.exe.old-1.1.1` ← one step back
  - `AgentManager.exe.old-1.1.0`
  - `AgentManager.exe.old-1.0.0`
  - `AgentManager.exe.old`
- Desktop shortcut: `Desktop\AgentManager.lnk` (points at `AgentManager.exe`)
- Start-menu shortcut: `Start Menu\Programs\AgentManager.lnk`

## How to update going forward

**Preferred**: wait for the in-app update banner, click "Restart & apply". This runs the bundled swap helper and preserves the backup chain.

**Manual fallback** (what step 000005 did):
```bash
# Download new asset
curl -L -o "$TEMP\AgentManager-X.Y.Z.exe" \
  https://github.com/MenachemBarak/AgentCLISessionManager/releases/download/vX.Y.Z/AgentManager-X.Y.Z-windows-x64.exe

# Stop running app
taskkill //F //IM AgentManager.exe

# Swap
cd "$LOCALAPPDATA\Programs\AgentManager"
mv AgentManager.exe AgentManager.exe.old-<current-version>
cp "$TEMP\AgentManager-X.Y.Z.exe" AgentManager.exe

# Verify
./AgentManager.exe --version
```

## Switching to the proper Inno install

If the user ever wants to ditch the raw-exe chain and adopt the installer:
1. Back up `~/.claude/viewer-labels.json` and `~/.claude/viewer-terminal-state.json` (user data).
2. Delete `%LOCALAPPDATA%\Programs\AgentManager\` entirely.
3. Run `AgentManager-X.Y.Z-setup.exe`. Creates fresh install + registers in Add/Remove Programs.
4. User data is untouched (`~/.claude/*` is not inside the install dir).

## Rollback

If v1.2.14 has a problem:
```bash
cd "$LOCALAPPDATA\Programs\AgentManager"
mv AgentManager.exe AgentManager.exe.bad-1.2.14
mv AgentManager.exe.old-1.1.1 AgentManager.exe
# relaunch
```

## Where are the logs / state

- Frozen-exe log: `~/.claude/claude-sessions-viewer.log` (file logging enabled for debugging)
- User labels + pin state: `~/.claude/viewer-labels.json`
- Persisted tab layout: `~/.claude/viewer-terminal-state.json`
- Daemon state (opt-in mode only): `%LOCALAPPDATA%\AgentManager\daemon.pid`, `token`

## What's open / pending

- **#42 Phases 8-10**: shipping milestones for daemon split. Requires real-world dogfood of opt-in (`AGENTMANAGER_DAEMON=1`) before flipping default.
- **Dependabot**: all cleared. Next bump will arrive automatically.
- No open PRs, no open issues, latest 3 workflow runs green.
