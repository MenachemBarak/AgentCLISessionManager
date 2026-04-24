import { test, expect } from '@playwright/test';

/**
 * Pin-to-top feature. Clicking the ☆ / ★ on a session row calls
 * POST /api/sessions/{sid}/pin and the row jumps to the top of the
 * list on next refresh.
 */
test.describe.configure({ mode: 'serial' });

test.describe('pin session to top', () => {
  test.beforeEach(async ({ request }) => {
    // Make sure nothing is pinned from a prior run.
    const r = await request.get('/api/sessions');
    const body = await r.json();
    for (const s of body.items) {
      if (s.pinned) {
        await request.post(`/api/sessions/${s.id}/pin`, { data: { pinned: false } });
      }
    }
  });

  test('clicking the star pins a session and it moves to the top', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

    // Find the LAST row (least recent) so we can verify it moves to the top.
    const rows = page.locator('[data-testid^="session-row-"]');
    await rows.first().waitFor({ state: 'visible' });
    const count = await rows.count();
    if (count < 2) test.skip();

    const targetRow = rows.nth(count - 1);
    const targetId = (await targetRow.getAttribute('data-testid'))?.replace(/^session-row-/, '') ?? '';

    // Star is hidden until hover — use dispatchEvent or force-click.
    const star = page.getByTestId(`session-pin-${targetId}`);
    await targetRow.hover();
    await expect(star).toBeVisible({ timeout: 3_000 });
    await star.click();

    // Backend should now report the session as pinned + first.
    await expect.poll(async () => {
      const r = await request.get('/api/sessions');
      const body = await r.json();
      return body.items[0].id.slice(0, 8);
    }, { timeout: 5_000 }).toBe(targetId);
  });

  test('pin persists across reloads', async ({ page, request }) => {
    // Pin the last session.
    const r = await request.get('/api/sessions');
    const items = (await r.json()).items;
    if (items.length < 2) test.skip();
    const targetSid = items[items.length - 1].id;
    await request.post(`/api/sessions/${targetSid}/pin`, { data: { pinned: true } });

    // Reload — pinned row is at the top. Poll because SSE may re-render
    // the list asynchronously right after initial mount.
    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => {
      const first = await page.locator('[data-testid^="session-row-"]').first().getAttribute('data-testid');
      return first;
    }, { timeout: 8_000 }).toBe(`session-row-${targetSid.slice(0, 8)}`);
  });
});
