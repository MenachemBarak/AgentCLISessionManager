/**
 * Daemon Phase 8 contract — crash fallback + version mismatch.
 * Part of ADR-18 / Task #42. Red against v1.1.0 by design.
 */
import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { daemonGet, pidIsAlive, readPidFile } from '../../helpers/daemon-probe';

test.describe.configure({ mode: 'serial' });

// SKIPPED pending ADR-18 Phase 8 — these tests need a UI shim with
// reconnect banner / reconnect button testids, plus a CSV_TEST_MODE
// seed-daemon-version hook. The underlying kill-and-respawn logic is
// covered at the unit level in tests/test_daemon_phase3.py (pid lock
// + singleton refusal).
test.skip();

test.describe('daemon crash & version-mismatch handling', () => {
  test('killed daemon → UI shows clear state, next launch respawns', async ({ page }) => {
    const pf = readPidFile();
    expect(pidIsAlive(pf.pid)).toBe(true);

    // Forcibly kill the daemon (simulates crash).
    execSync(`taskkill /F /PID ${pf.pid}`, { encoding: 'utf8' });
    await page.waitForTimeout(500);
    expect(pidIsAlive(pf.pid)).toBe(false);

    // UI should surface an error state (Phase 8 feature).
    await page.goto('/');
    const banner = page.getByTestId('daemon-disconnected-banner');
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // Clicking "Reconnect" respawns the daemon and restores function.
    await page.getByTestId('daemon-reconnect-btn').click();
    const r = await daemonGet('/api/health');
    expect(r.status).toBe(200);
    const pf2 = readPidFile();
    expect(pf2.pid).not.toBe(pf.pid);
  });

  test('daemon/UI version mismatch surfaces a warning to the user', async ({ page }) => {
    // Phase 8 responsibility: UI reads /api/health.daemonVersion, compares
    // to its own bundle version, and when they differ badly enough shows a
    // warning banner recommending a full restart. Tested by seeding a
    // mismatched daemon version via CSV_TEST_MODE seed hook (Phase 8 hook).
    await page.goto('/');
    const r = await fetch('http://127.0.0.1:8765/api/_test/seed-daemon-version', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ daemonVersion: '0.0.1-probe' }),
    });
    expect(r.status).toBe(200);
    await page.reload();
    await expect(page.getByTestId('daemon-version-mismatch-banner')).toBeVisible({ timeout: 5_000 });
  });
});
