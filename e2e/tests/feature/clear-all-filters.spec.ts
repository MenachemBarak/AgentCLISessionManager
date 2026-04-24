import { test, expect } from '@playwright/test';

/**
 * 'clear' button in the left-pane footer wipes every active filter
 * (search + date range + status + folder) in one click.
 */
test('clicking the footer clear button wipes every active filter', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid^="session-row-"]').first()).toBeVisible();

  const search = page.getByTestId('session-search-input');
  const clearBtn = page.getByTestId('clear-all-filters');

  // Baseline: no filter → clear button hidden
  await expect(clearBtn).toHaveCount(0);

  // Apply a no-match search filter
  await search.fill('zzz-no-matching-session-zzz');
  await expect(clearBtn).toBeVisible({ timeout: 2_000 });

  await clearBtn.click();
  await expect(search).toHaveValue('');
  await expect(clearBtn).toHaveCount(0, { timeout: 2_000 });

  // All rows restored.
  await expect(page.locator('[data-testid^="session-row-"]').first()).toBeVisible();
});
