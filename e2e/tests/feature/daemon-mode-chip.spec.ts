import { test, expect } from '@playwright/test';

/**
 * The title bar shows a small "DAEMON" chip next to the version
 * when the app was launched in opt-in daemon-split mode (detected
 * by the inline auth-init script stashing window._daemonToken).
 *
 * In default (legacy) mode no fragment is ever written, so the chip
 * must stay hidden.
 */
test.describe('daemon-mode indicator chip', () => {
  test('is hidden in default mode (no #token fragment)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('daemon-mode-chip')).toHaveCount(0);
  });

  test('shows when the URL carries a #token= fragment (daemon shim shape)', async ({ page }) => {
    // Stash a fake token before navigation so the inline auth-init
    // picks it up the same way the pywebview shim would.
    await page.goto('/#token=deadbeefdeadbeefdeadbeefdeadbeef');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

    const chip = page.getByTestId('daemon-mode-chip');
    await expect(chip).toBeVisible({ timeout: 3_000 });
    await expect(chip).toContainText(/daemon/i);
  });
});
