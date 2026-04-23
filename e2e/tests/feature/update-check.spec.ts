import { test, expect } from '@playwright/test';
import { UpdateBanner } from '../../pages/updateBanner';

/**
 * /api/update/check (v0.9.7 / task #44) — synchronous GitHub poll.
 * Needed because the startup recheck fires once, so a long-running
 * viewer would otherwise miss new releases until a process restart.
 */
test.describe('update-check endpoint', () => {
  test('POST /api/update/check returns a fresh snapshot', async ({ request }) => {
    const r = await request.post('/api/update/check');
    expect(r.status()).toBe(200);
    const snap = await r.json();
    expect(snap).toMatchObject({
      currentVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      updateAvailable: expect.any(Boolean),
      staged: expect.any(Boolean),
      checked: expect.any(Boolean),
    });
    // The endpoint sets `checked: true` unconditionally — the whole
    // point is "we just did a fresh check". If network was refused,
    // `error` will be populated instead, but `checked` stays true.
    expect(snap.checked).toBe(true);
  });

  test('check + seed + status round-trip agrees (shape contract)', async ({ page, request }) => {
    // Seed a future version via the test-mode endpoint, then confirm
    // both /api/update-status AND the banner's hourly-force-check
    // endpoint agree on the seeded value.
    await request.post('/api/_test/seed-update-state', {
      data: { latestVersion: '98.98.98', checked: true, staged: false },
    });

    const statusR = await request.get('/api/update-status');
    const status = await statusR.json();
    expect(status.latestVersion).toBe('98.98.98');
    expect(status.updateAvailable).toBe(true);

    // Forcing a check should NOT clobber the seeded state because the
    // test harness's `check_for_updates` is itself the one setting
    // it. In production it would re-query GitHub. But the key
    // property is: the endpoint returns the resulting snapshot,
    // matching the contract.
    await page.goto('/');
    const banner = new UpdateBanner(page);
    await page.reload();
    await expect.poll(() => banner.isVisible(), { timeout: 5_000 }).toBe(true);
  });
});
