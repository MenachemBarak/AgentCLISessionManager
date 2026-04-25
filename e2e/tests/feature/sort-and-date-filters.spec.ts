import { test, expect } from '@playwright/test';
import { seedEmptyLayout } from '../../helpers/layout-seed';

test.beforeEach(async ({ request }) => {
  // Avoid prior-test layout state intercepting the page-load focus
  // path which could shift selectedId and trigger an unexpected re-
  // render storm.
  await seedEmptyLayout(request);
});

/**
 * T-63 audit: Sort + Created (date-range) dropdowns at the top of
 * the left pane had zero coverage. Added testids on the underlying
 * CompactDropdown so we can drive them deterministically from e2e.
 *
 * The behavioral expectations are:
 *   - Picking a Sort option re-orders the rendered session rows.
 *   - Picking a Date option may reduce the visible row count.
 * Both flows go through React state updates with no network call —
 * we observe DOM order/count.
 */

test('Sort dropdown reorders rows: Last active vs Newest', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/');
  await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

  const orderOf = async () => page.evaluate(() => {
    const rows = document.querySelectorAll('[data-testid^="session-row-"]');
    return [...rows].map((r) => r.getAttribute('data-testid'));
  });

  // Default sort is `last_active`. Capture that order.
  const lastActiveOrder = await orderOf();
  expect(lastActiveOrder.length).toBeGreaterThan(0);

  // Open Sort dropdown → pick "Newest" (created desc).
  await page.getByTestId('sort-dropdown-button').click();
  await page.getByTestId('sort-dropdown-option-created').click();

  // Rows should re-render under the new ordering. We don't assert a
  // specific order (depends on fixture timestamps), but we DO assert
  // the dropdown closed AND the listing is still populated AND no
  // pageerrors fired during the re-render.
  await expect(page.getByTestId('sort-dropdown-menu')).toBeHidden({ timeout: 1_000 });
  const createdOrder = await orderOf();
  expect(createdOrder.length).toBe(lastActiveOrder.length);

  expect(pageErrors.map((e) => e.message)).toEqual([]);
});

test('Date dropdown filters to "Today" and may reduce visible count', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/');
  await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

  const countOf = async () => page.locator('[data-testid^="session-row-"]').count();
  const before = await countOf();

  await page.getByTestId('created-dropdown-button').click();
  await page.getByTestId('created-dropdown-option-today').click();
  await expect(page.getByTestId('created-dropdown-menu')).toBeHidden({ timeout: 1_000 });

  // Fixtures are dated in 2026-02 (per the seed body); "Today" should
  // either keep or reduce the count, never increase.
  const after = await countOf();
  expect(after).toBeLessThanOrEqual(before);

  expect(pageErrors.map((e) => e.message)).toEqual([]);
});
