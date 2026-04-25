import { test, expect } from '@playwright/test';
import { seedEmptyLayout } from '../../helpers/layout-seed';

/**
 * T-63 audit: the FolderFilter (left-pane "Folders X/Y" expandable
 * panel + per-folder checkboxes) had zero coverage. Added stable
 * testids on the toggle, the All/None buttons, and the panel.
 *
 * Behavior covered: clicking "None" inside the folder-filter panel
 * removes every visible session row from the All-sessions section
 * (since the listing is gated on folder match). Clicking "All"
 * restores them.
 */
test.beforeEach(async ({ request }) => {
  await seedEmptyLayout(request);
});

test('Folders → None hides all rows; All restores them', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/');
  await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });
  // Wait for at least one session row to render before measuring.
  await page.locator('[data-testid^="session-row-"]').first().waitFor({ state: 'visible', timeout: 5_000 });

  const rowCount = () => page.locator('[data-testid^="session-row-"]').count();
  const before = await rowCount();
  expect(before).toBeGreaterThan(0);

  // Open the folder-filter panel.
  await page.getByTestId('folder-filter-toggle').click();
  await expect(page.getByTestId('folder-filter-panel')).toBeVisible({ timeout: 1_000 });

  // Click "None" → all rows hide.
  await page.getByTestId('folder-filter-none').click();
  await expect.poll(() => rowCount(), { timeout: 2_000 }).toBe(0);

  // Click "All" → rows return.
  await page.getByTestId('folder-filter-all').click();
  await expect.poll(() => rowCount(), { timeout: 2_000 }).toBe(before);

  expect(pageErrors.map((e) => e.message)).toEqual([]);
});
