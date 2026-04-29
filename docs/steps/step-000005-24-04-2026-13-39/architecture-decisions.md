# Architecture decisions — step 000005

## ADR-25: Manual install of v1.2.14 over v1.1.1 in place, keeping the rollback chain

- **Decision**: Download the v1.2.14 raw exe, rename current `AgentManager.exe` → `AgentManager.exe.old-1.1.1`, copy the new binary into place. Keep every prior `.old-<ver>` sibling untouched (v1.0.0, v1.1.0, v1.1.1 all present).
- **Alternatives considered**:
  - Use the in-app update banner (not invoked by user; they explicitly asked for a manual install).
  - Run the v1.2.14 installer (`AgentManager-1.2.14-setup.exe`) instead. Rejected: user's install is the raw-exe layout from earlier manual swaps, not an Inno-managed install, so the installer would create a parallel Add/Remove Programs entry and leave the current layout stale.
  - Skip keeping `.old-1.1.1` and just overwrite. Rejected: we've hit swap-helper problems before (v0.9.2 lesson). Having the previous binary one rename away is cheap insurance.
- **Why**: Preserves the exact layout the user is used to, gives single-step rollback, and skips any Inno-vs-raw collision.
- **Blast radius**: Single file at `%LOCALAPPDATA%\Programs\AgentManager\AgentManager.exe`. Shortcuts unchanged. No registry changes.
- **Reversibility**: Trivial — `move AgentManager.exe AgentManager.exe.bad-1.2.14 & move AgentManager.exe.old-1.1.1 AgentManager.exe`.

## ADR-26: Not cutting v1.2.15 during the idle window

- **Decision**: Stop releasing polish features. Hold at v1.2.14 until there's either user feedback or a real signal (CI failure, bug report, dependabot PR) to act on.
- **Alternatives considered**:
  - Keep cranking polish (remember-last-selected, better empty states, accessibility polish). Rejected: diminishing returns, each release costs user attention, and "something to ship" is not a reason to ship.
  - Start #42 Phase 8 (dogfood rollout + reconnect banner). Rejected: needs the user to dogfood opt-in daemon mode first — no way to write Phase 8 blind.
- **Why**: Release fatigue is a real thing. 14 releases in a day is high-cadence enough; further tightening adds noise.
- **Blast radius**: None — decision is not to ship.
- **Reversibility**: Trivial (always can cut a new release).
