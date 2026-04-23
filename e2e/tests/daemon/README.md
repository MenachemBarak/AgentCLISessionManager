# Daemon-split tests (ADR-18 / Task #42)

**Phase 1 of 10. These tests fail against v1.1.0 by design.** They encode the invariants the daemon/UI split must uphold and are written FIRST per ADR-17 (TDD for architectural work).

## Contract

Each `test(...)` in this directory asserts one invariant from `docs/design/adr-18-daemon-split.md`. The test's failure mode on v1.1.0 is the signal that the invariant is not yet met. As each later phase lands, a predetermined test flips from RED to GREEN.

## Running them

Default CI and `pnpm test` run the `chromium` Playwright project — these daemon tests are in the `daemon` project, excluded from default runs to keep main CI green during the ~6-day implementation window.

To run locally against daemon code in progress:

```bash
pnpm exec playwright test --project=daemon
```

## Phase → test map

| Phase | Tests expected to flip GREEN |
|-------|------------------------------|
| 2 — Daemon extraction             | `autostart-singleton.spec.ts::health endpoint responds` |
| 3 — UI shim + autostart          | all of `autostart-singleton.spec.ts` |
| 4 — Ring buffer + rehydrate      | `rehydrate.spec.ts::*` |
| 5 — UI restart survives          | `rehydrate.spec.ts::ui restart preserves PTY`, `multi-ui`, `layout daemon-side` |
| 6 — Uninstall CLI                | all of `uninstall.spec.ts` |
| 7 — Updater dual-asset           | all of `update.spec.ts` |
| 8 — Polish + dogfood             | `crash.spec.ts::*` |

When this mapping drifts from reality, fix the mapping — don't silently weaken the assertion.

## Why the tests reference APIs that don't exist yet

That is the TDD property. `daemonProbe.readPidFile()`, `daemonProbe.health()`, `--uninstall` CLI — each test imports or shells a thing that doesn't exist in v1.1.0. When the Phase-N code lands, the helper gets real, and the matching test can pass.

## Do not skip tests to mute them

If a test is red for a reason you don't understand, open the ADR and trace which phase owns that invariant. If the phase isn't done yet, that's expected and OK. If the phase claims done but the test is still red, the phase isn't really done.
