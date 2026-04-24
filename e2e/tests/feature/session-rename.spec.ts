import { test, expect } from '@playwright/test';

/**
 * Inline session rename. Click the title of a session row in the left
 * pane → the title becomes an input → type a new label → Enter saves
 * via PUT /api/sessions/{sid}/label → the new label renders.
 *
 * This feature has existed for a while but had no e2e regression guard;
 * this spec fills that gap.
 */
test.describe.configure({ mode: 'serial' });

test.describe('inline session rename', () => {
  test.beforeEach(async ({ request }) => {
    // Clear any leftover label on the fixture sessions so the assertions
    // have a known starting point.
    const r = await request.get('/api/sessions');
    for (const s of (await r.json()).items) {
      if (s.userLabel) {
        await request.put(`/api/sessions/${s.id}/label`, { data: { userLabel: null } });
      }
    }
  });

  test('click title, type, Enter → label persists in API', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

    const firstRow = page.locator('[data-testid^="session-row-"]').first();
    await firstRow.waitFor({ state: 'visible' });
    const rowTestId = await firstRow.getAttribute('data-testid');
    const sid8 = rowTestId?.replace(/^session-row-/, '') ?? '';

    // Click the title to enter edit mode.
    const title = page.getByTestId(`title-${sid8}`);
    await title.click();

    const input = page.getByTestId(`title-input-${sid8}`);
    await expect(input).toBeVisible({ timeout: 2_000 });
    await expect(input).toBeFocused();

    const label = `renamed-${Date.now()}`;
    await input.fill(label);
    await page.keyboard.press('Enter');

    // Input disappears + label propagates to the API.
    await expect(input).toHaveCount(0, { timeout: 2_000 });
    await expect.poll(async () => {
      const r = await request.get('/api/sessions');
      const row = (await r.json()).items.find((s: { id: string }) => s.id.startsWith(sid8));
      return row?.userLabel;
    }, { timeout: 3_000 }).toBe(label);

    // Cleanup — clear the label for subsequent test runs.
    const r = await request.get('/api/sessions');
    const full = (await r.json()).items.find((s: { id: string }) => s.id.startsWith(sid8));
    if (full) {
      await request.put(`/api/sessions/${full.id}/label`, { data: { userLabel: null } });
    }
  });

  test('Esc cancels the edit without calling the API', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

    const firstRow = page.locator('[data-testid^="session-row-"]').first();
    await firstRow.waitFor({ state: 'visible' });
    const rowTestId = await firstRow.getAttribute('data-testid');
    const sid8 = rowTestId?.replace(/^session-row-/, '') ?? '';

    // Baseline: capture the current userLabel from API.
    const rBefore = await request.get('/api/sessions');
    const rowBefore = (await rBefore.json()).items.find((s: { id: string }) => s.id.startsWith(sid8));
    const labelBefore = rowBefore?.userLabel ?? null;

    const title = page.getByTestId(`title-${sid8}`);
    await title.click();

    const input = page.getByTestId(`title-input-${sid8}`);
    await expect(input).toBeVisible();
    await input.fill('this should not persist');
    await page.keyboard.press('Escape');

    await expect(input).toHaveCount(0, { timeout: 2_000 });

    // API label is unchanged.
    const rAfter = await request.get('/api/sessions');
    const rowAfter = (await rAfter.json()).items.find((s: { id: string }) => s.id.startsWith(sid8));
    expect(rowAfter?.userLabel ?? null).toBe(labelBefore);
  });
});
