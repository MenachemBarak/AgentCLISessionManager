import { test, expect } from '@playwright/test';

/**
 * Session count footer shows 'X total' by default and flips to
 * 'showing N of X' (amber) when a filter is hiding rows.
 */
test.describe('filter count footer', () => {
  test("shows 'N total' with no filter + flips to 'showing X of N' when searching", async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid^="session-row-"]').first()).toBeVisible();

    const footer = page.getByTestId('session-count-footer');
    await expect(footer).toBeVisible();
    // Baseline: fixture has 2 sessions → "2 total".
    await expect(footer).toContainText(/^\d+ total$/);

    // Type a term that filters out at least one session.
    const search = page.getByTestId('session-search-input');
    await search.fill('qqq-no-such-token-xxx');

    // Footer flips to "showing N of M" (amber) when rows are hidden.
    await expect(footer).toContainText(/showing \d+ of \d+/, { timeout: 3_000 });
  });
});
