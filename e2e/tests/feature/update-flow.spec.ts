import { test, expect } from '@playwright/test';
import { UpdateBanner } from '../../pages/updateBanner';
import { WindowChrome } from '../../pages/windowChrome';

/**
 * Update-flow feature — the user-visible arc of the self-update system.
 * We don't hit GitHub here; the CSV_TEST_MODE seed endpoint stands in
 * for a real release so the test is hermetic and fast.
 *
 * Flow exercised:
 *   1. Backend reports up-to-date  → banner is hidden
 *   2. Seed "newer version" state  → banner appears with Download button
 *   3. Seed "staged" state         → banner shows Restart & apply button
 *   4. Apply endpoint guards (dev-mode refuses cleanly, doesn't crash UI)
 */
test.describe('self-update banner', () => {
  test('hidden when no update is available', async ({ page }) => {
    // Baseline: reset state to "checked, no newer version".
    await page.request.post('/api/_test/seed-update-state', {
      data: { latestVersion: '0.0.0', checked: true, staged: false },
    });
    await page.goto('/');
    const banner = new UpdateBanner(page);
    // Give React a tick to render — then confirm the banner is NOT there.
    await page.waitForTimeout(500);
    expect(await banner.isVisible()).toBe(false);
  });

  test('appears with Download button when a newer version is seeded', async ({ page }) => {
    await page.goto('/');
    const banner = new UpdateBanner(page);

    // Use a far-future version so _version_gt returns true regardless
    // of what the running build calls itself — avoids a racy parse of
    // the title bar and keeps this test independent of the release tag.
    const latest = '99.99.99';

    await banner.seedUpdateAvailable(latest);

    // Verify the seed took effect before we rely on the banner to
    // reflect it — if this fails it's a backend/seed bug, not a
    // rendering one.
    const snapAfterSeed = await banner.snapshot();
    expect(snapAfterSeed.updateAvailable, `seed didn't flip updateAvailable — snap=${JSON.stringify(snapAfterSeed)}`).toBe(true);

    // The banner polls every 5 min in prod; in-test we reload to force
    // a fresh fetch on mount.
    await page.reload();

    await expect.poll(() => banner.isVisible(), { timeout: 5_000 }).toBe(true);
    await expect(page.getByRole('button', { name: /^Download$/ })).toBeVisible();

    const snap = await banner.snapshot();
    expect(snap.updateAvailable).toBe(true);
    expect(snap.latestVersion).toBe(latest);
  });

  test('shows Restart & apply when a staged download is present', async ({ page }) => {
    await page.goto('/');
    const banner = new UpdateBanner(page);
    await banner.seedUpdateAvailable('99.99.99', { staged: true });
    await page.reload();

    await expect.poll(() => banner.isVisible(), { timeout: 5_000 }).toBe(true);
    await expect(page.getByRole('button', { name: /Restart.*apply/i })).toBeVisible();
  });

  test('apply endpoint refuses gracefully when nothing is staged (no crash)', async ({ page }) => {
    // Apply has three stacked guards:
    //   1. non-Windows  → "apply is Windows-only for now"
    //   2. !sys.frozen  → "self-apply only available in the packaged .exe"
    //   3. no staged    → "no staged update; call /api/update/download first"
    // Which branch fires depends on where the tests run (dev server vs
    // built exe). All three are graceful refusals that must leave
    // {ok:false} and not crash the UI — we accept any of them.
    const r = await page.request.post('/api/update/apply');
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(false);
    expect(body.message.toLowerCase(), `unexpected apply message: ${body.message}`)
      .toMatch(/windows|packaged|staged/);

    // Navigate and confirm nothing blew up after the call.
    await page.goto('/');
    await expect.poll(async () =>
      await page.evaluate(() => document.getElementById('root')?.children.length ?? 0),
    { timeout: 5_000 }).toBeGreaterThan(0);
  });
});
