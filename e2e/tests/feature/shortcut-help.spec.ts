import { test, expect } from '@playwright/test';

/**
 * '?' shortcut opens a keyboard-shortcut help overlay.
 * Esc / backdrop-click close it. Ignored inside text inputs and xterm.
 */
test.describe('shortcut help overlay (?)', () => {
  test('press ? opens the help overlay; Esc closes', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId('shortcut-help')).toHaveCount(0);

    // Dispatch the keydown directly on window rather than routing
    // through Playwright's physical-key simulation — WebKit-via-
    // pywebview's handling of Shift+Slash is inconsistent across CI
    // runners. The handler listens on window.keydown with e.key === '?'.
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    const panel = page.getByTestId('shortcut-help');
    await expect(panel).toBeVisible({ timeout: 3_000 });

    // Content sanity — at least one group heading + a few shortcuts render.
    await expect(panel).toContainText('Navigation');
    await expect(panel).toContainText('Ctrl');
    await expect(panel).toContainText('K');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcut-help')).toHaveCount(0);
  });

  test("'?' is ignored inside a text input", async ({ page }) => {
    await page.goto('/');
    const search = page.getByTestId('session-search-input');
    await expect(search).toBeVisible({ timeout: 10_000 });

    await search.click();
    await page.keyboard.press('?');
    // The overlay must NOT appear — the character should land in the input.
    await expect(page.getByTestId('shortcut-help')).toHaveCount(0);
    await expect(search).toHaveValue('?');
  });
});
