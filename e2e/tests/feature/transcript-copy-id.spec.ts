import { test, expect } from '@playwright/test';

/**
 * Transcript copy-session-id button.
 */
test('click the session id chip → writes the full uuid to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto('/');
  await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

  const firstRow = page.locator('[data-testid^="session-row-"]').first();
  await firstRow.waitFor({ state: 'visible', timeout: 10_000 });
  await firstRow.click();

  const copyBtn = page.getByTestId('transcript-copy-id');
  await expect(copyBtn).toBeVisible({ timeout: 5_000 });

  const shownId = (await copyBtn.textContent())?.trim() ?? '';
  expect(shownId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

  await copyBtn.click();

  const copied = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  });
  expect(copied).toBe(shownId);

  // The button shows "✓ copied" feedback.
  await expect(copyBtn).toContainText('copied');
});
