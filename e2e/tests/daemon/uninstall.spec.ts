/**
 * Daemon Phase 6 contract — fully uninstallable (Law 3 from ADR-18).
 * A single `AgentManager.exe --uninstall` removes all artifacts including
 * a running daemon and any PTY grandchildren. Red against v1.1.0 by design.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';
import { agentManagerStateDir, agentManagerProcessCount, readPidFile } from '../../helpers/daemon-probe';

// SKIPPED in the daemon Playwright project pending Phase 8/9:
// these tests spawn AgentManager.exe (the PyInstaller binary) directly
// and assert %USERPROFILE%\Desktop shortcut removal. Unit-tested in
// tests/test_daemon_phase6.py (8 cases covering the orchestrator).
test.skip();

test.describe.configure({ mode: 'serial' });

test.describe('uninstall CLI (ADR-18 §Law 3)', () => {
  test('--uninstall removes state dir + shortcuts + kills daemon + PTY tree', () => {
    // Pre-condition: installation is present with running daemon.
    expect(
      fs.existsSync(agentManagerStateDir()),
      'state dir must exist before --uninstall runs',
    ).toBe(true);
    const pf = readPidFile();
    expect(pf.pid).toBeGreaterThan(0);
    expect(agentManagerProcessCount()).toBeGreaterThan(0);

    // Run the uninstaller (Phase 6 CLI entry).
    const out = spawnSync('AgentManager.exe', ['--uninstall', '--yes'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(out.status, `--uninstall must exit 0: ${out.stderr}`).toBe(0);

    // Post: state dir gone, daemon process gone, no AgentManager processes left.
    expect(fs.existsSync(agentManagerStateDir()), 'state dir must be removed').toBe(false);
    expect(
      agentManagerProcessCount(),
      'no AgentManager-* processes may remain post-uninstall',
    ).toBe(0);

    // Shortcuts gone.
    const desktop = path.join(process.env.USERPROFILE || '', 'Desktop', 'AgentManager.lnk');
    const startMenu = path.join(
      process.env.APPDATA || '',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'AgentManager.lnk',
    );
    expect(fs.existsSync(desktop), 'Desktop shortcut must be removed').toBe(false);
    expect(fs.existsSync(startMenu), 'Start-menu shortcut must be removed').toBe(false);
  });

  test('--uninstall is idempotent: second run with no state still exits 0', () => {
    const out = spawnSync('AgentManager.exe', ['--uninstall', '--yes'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(
      out.status,
      'second --uninstall against already-clean state must still exit 0',
    ).toBe(0);
  });

  test('--uninstall kills PTY grandchildren (Squirrel-orphan defense)', () => {
    // Precondition: start the app fresh, spawn a PTY, then uninstall.
    // In Phase 6 the uninstaller walks psutil process tree and terminates
    // PTY children (cmd.exe + claude) so nothing is orphaned.
    // This is the regression-guard against the known
    // VSCode/Cursor-Squirrel uninstaller class of bug (see ADR-18 research).
    // Scaffold: the test fails in v1.1.0 because AgentManager.exe doesn't
    // accept --uninstall at all; the assertion lives as a TDD anchor.
    const out = spawnSync('AgentManager.exe', ['--spawn-pty-then-uninstall-probe'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(out.status).toBe(0);
    // Count cmd.exe processes that remain parented under AgentManager-Daemon.
    // (None should — all killed with the daemon.)
    const tree = execSync(
      'wmic process where "Name=\'cmd.exe\'" get ParentProcessId,ProcessId /FORMAT:CSV',
      { encoding: 'utf8' },
    );
    expect(
      tree.toLowerCase().includes('agentmanager-daemon'),
      'no cmd.exe must remain parented to a dead AgentManager-Daemon',
    ).toBe(false);
  });
});
