/**
 * Daemon Phase 3 contract — autostart, singleton, port-conflict, invisibility.
 * Part of ADR-18 / Task #42. Red against v1.1.0 by design (no daemon yet).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as net from 'net';
import {
  agentManagerStateDir,
  daemonGet,
  listeningAddressesFor,
  pidIsAlive,
  readPidFile,
  readToken,
} from '../../helpers/daemon-probe';

test.describe.configure({ mode: 'serial' });

test.describe('daemon autostart & singleton (ADR-18 §Law 1 + §Architecture)', () => {
  test('health endpoint responds (Phase 2)', async () => {
    const r = await daemonGet('/api/health');
    expect(r.status, 'daemon /api/health must return 200 once Phase 2 lands').toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('daemonVersion');
  });

  test('pid file exists with pid + start-time + version after launch', async () => {
    const pf = readPidFile();
    expect(pf.pid).toBeGreaterThan(0);
    expect(pf.startTimeEpoch).toBeGreaterThan(0);
    expect(pf.daemonVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(pidIsAlive(pf.pid)).toBe(true);
  });

  test('bearer token file exists with user-only ACL + 32 bytes entropy', () => {
    const token = readToken();
    expect(token.length, 'token must be 32+ hex chars').toBeGreaterThanOrEqual(32);
    // ACL verification: stat mode on Windows isn't a precise test, but the
    // file must at least exist + be readable by the current user. Deeper
    // DACL inspection happens in a backend unit test.
    const file = `${agentManagerStateDir()}\\token`;
    expect(fs.existsSync(file)).toBe(true);
  });

  test('requests without a bearer token get 401', async () => {
    const r = await fetch('http://127.0.0.1:8765/api/sessions');
    expect(r.status, 'unauthenticated /api/sessions must be rejected').toBe(401);
  });

  test('daemon binds 127.0.0.1 ONLY (invisible — no firewall prompt)', () => {
    const addrs = listeningAddressesFor(8765);
    expect(addrs.length, 'daemon must be listening on 8765').toBeGreaterThan(0);
    for (const a of addrs) {
      expect(a, `daemon bound ${a} — must be 127.0.0.1 only, never 0.0.0.0`).toBe('127.0.0.1');
    }
  });

  // In this test project, our OWN daemon already owns 8765, so we can't
  // stage a 'port held by unrelated process' scenario without tearing
  // down the webServer. The probe's 'other' branch is unit-tested in
  // tests/test_daemon_phase3b.py::test_cli_probe_daemon_other_returns_3
  // against a fake in-process HTTP listener. Skip here.
  test.skip('port held by unrelated process → UI fails fast with legible error', async () => {
    // Occupy :8765 before any UI launch — simulates the clash case.
    const squatter = net.createServer();
    await new Promise<void>((resolve, reject) => {
      squatter.once('error', reject);
      squatter.listen(8765, '127.0.0.1', () => resolve());
    });
    try {
      // UI launch path (Phase 3b+) must detect NOT-our-daemon on the
      // port and surface an error. We exercise via `backend/cli.py
      // --probe-daemon` — the PyInstaller exe runs this exact code path.
      // Exit 3 + stderr references port 8765 / "unrelated" when squatted.
      const { spawnSync } = await import('child_process');
      const res = spawnSync('python', ['-m', 'backend.cli', '--probe-daemon', '--port', '8765'], {
        encoding: 'utf8',
        timeout: 5_000,
      });
      expect(res.status, '--probe-daemon must exit 3 when port squatted').toBe(3);
      const err = String(res.stderr || '').toLowerCase();
      expect(
        err.includes('port 8765') || err.includes('unrelated'),
        `stderr must mention the squatted port: ${JSON.stringify(res.stderr)}`,
      ).toBe(true);
    } finally {
      squatter.close();
    }
  });

  test('two UI launches share ONE daemon (singleton)', async () => {
    const pf1 = readPidFile();
    // A second `python -m daemon` launch against the same state dir must
    // refuse (DaemonAlreadyRunning → exit 2) so the first daemon keeps
    // owning the pidfile. This is the Phase-3a singleton invariant.
    const { spawnSync } = await import('child_process');
    const res = spawnSync('python', ['-m', 'daemon'], {
      encoding: 'utf8',
      timeout: 5_000,
      env: { ...process.env, AGENTMANAGER_DAEMON_PORT: '8766' },  // diff port so uvicorn bind doesn't conflict first
    });
    // Exit 2 = DaemonAlreadyRunning (preferred). 0 shouldn't happen.
    expect(res.status, `expected the second daemon spawn to refuse, got stdout=${res.stdout} stderr=${res.stderr}`).not.toBe(0);
    const pf2 = readPidFile();
    expect(pf2.pid, 'first daemon pid must be unchanged').toBe(pf1.pid);
  });

  test('daemon version exposed at /api/health matches exe version', async () => {
    const r = await daemonGet('/api/health');
    const body = await r.json();
    const pf = readPidFile();
    expect(body.daemonVersion).toBe(pf.daemonVersion);
  });
});
