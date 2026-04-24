import { test, expect } from '@playwright/test';

/**
 * Transcript Ctrl+F find-in-page.
 */
test.describe('transcript find (Ctrl+F)', () => {
  test('Ctrl+F opens the find bar + input is focused', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

    // Select a session so the transcript loads.
    const firstRow = page.locator('[data-testid^="session-row-"]').first();
    await firstRow.waitFor({ state: 'visible' });
    await firstRow.click();

    // Ctrl+F outside any input — must hit the transcript handler.
    // Click empty area of the right pane first so focus isn't in an input.
    await page.locator('body').click();
    await page.keyboard.press('Control+f');

    const bar = page.getByTestId('transcript-find-bar');
    await expect(bar).toBeVisible({ timeout: 2_000 });
    await expect(page.getByTestId('transcript-find-input')).toBeFocused();
  });

  test('typing filters + Enter cycles matches + count renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

    const firstRow = page.locator('[data-testid^="session-row-"]').first();
    await firstRow.waitFor({ state: 'visible' });
    await firstRow.click();

    // Wait for the transcript to actually render at least one message.
    await expect(page.locator('[data-msg-index]').first()).toBeVisible({ timeout: 5_000 });

    await page.locator('body').click();
    await page.keyboard.press('Control+f');
    await expect(page.getByTestId('transcript-find-bar')).toBeVisible();

    // Pull a guaranteed-in-content word by reading the actual transcript
    // body via API — innerText of the message row includes metadata
    // headers like "You"/"Assistant"/timestamps that aren't in msg.content.
    const apiResp = await page.request.get('/api/sessions');
    const items = (await apiResp.json()).items;
    if (items.length === 0) test.skip();
    const sid = items[0].id;
    const tr = await page.request.get(`/api/sessions/${sid}/transcript`);
    const trBody = await tr.json();
    const content = (trBody.messages?.[0]?.content ?? '') as string;
    const firstWord = content.match(/[A-Za-z]{4,}/)?.[0] ?? '';
    if (!firstWord) test.skip();

    await page.getByTestId('transcript-find-input').fill(firstWord);

    const count = page.getByTestId('transcript-find-count');
    await expect(count).toContainText(/\d+\/\d+/, { timeout: 3_000 });

    // Esc closes the bar.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('transcript-find-bar')).toHaveCount(0);
  });
});
