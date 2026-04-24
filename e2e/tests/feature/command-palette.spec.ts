import { test, expect } from '@playwright/test';

/**
 * Ctrl+K command palette — jump-to-session powered by /api/search.
 */
test.describe('command palette (Ctrl+K)', () => {
  test('Ctrl+K opens the palette + Esc closes it', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

    // Palette hidden on load.
    await expect(page.getByTestId('command-palette')).toHaveCount(0);

    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 2_000 });
    // Input focused so typing goes into the palette, not the list.
    await expect(page.getByTestId('command-palette-input')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
  });

  test('preview pane shows first user messages for the highlighted row', async ({ page }) => {
    await page.route('**/api/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          query: 'x',
          total: 1,
          items: [
            {
              id: 'dddddddd-4444-4444-8444-444444444444',
              title: 'Preview test',
              userLabel: null,
              claudeTitle: null,
              firstUserMessages: [
                'this is the first user message',
                'and here is a second one for good measure',
              ],
              cwd: 'C:/some/path',
              branch: 'main',
              active: false,
              _score: 4.2,
              lastActive: 1712000000000,
            },
          ],
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Control+k');
    await page.getByTestId('command-palette-input').fill('preview');
    await expect(page.getByTestId('palette-item-dddddddd')).toBeVisible({ timeout: 3_000 });

    const preview = page.getByTestId('palette-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Preview test');
    await expect(preview).toContainText('this is the first user message');
    await expect(preview).toContainText('C:/some/path');
  });

  test('typing calls /api/search and renders results', async ({ page }) => {
    const searchCalls: string[] = [];
    await page.route('**/api/search*', async (route) => {
      searchCalls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          query: 'probe',
          total: 2,
          items: [
            {
              id: 'aaaaaaaa-1111-4111-8111-111111111111',
              title: 'Palette result A',
              userLabel: null,
              claudeTitle: null,
              cwd: '',
              active: false,
              _score: 5.0,
            },
            {
              id: 'bbbbbbbb-2222-4222-8222-222222222222',
              title: 'Palette result B',
              userLabel: 'user-label B',
              claudeTitle: null,
              cwd: '',
              active: true,
              _score: 3.0,
            },
          ],
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();

    await page.getByTestId('command-palette-input').fill('my query');
    // Wait until the mocked /api/search call has fired.
    await expect.poll(() => searchCalls.length, { timeout: 3_000 }).toBeGreaterThanOrEqual(1);

    // Rendered items from the mock body.
    await expect(page.getByTestId('palette-item-aaaaaaaa')).toBeVisible();
    await expect(page.getByTestId('palette-item-bbbbbbbb')).toBeVisible();
  });

  test('Enter picks the highlighted result and closes', async ({ page }) => {
    await page.route('**/api/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          query: 'x',
          total: 1,
          items: [
            {
              id: 'cccccccc-3333-4333-8333-333333333333',
              title: 'Pickable',
              userLabel: null,
              claudeTitle: null,
              cwd: '',
              active: false,
              _score: 7.0,
            },
          ],
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Control+k');
    await page.getByTestId('command-palette-input').fill('pick me');
    await expect(page.getByTestId('palette-item-cccccccc')).toBeVisible({ timeout: 3_000 });

    await page.keyboard.press('Enter');
    // Palette closes after pick.
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
  });
});
