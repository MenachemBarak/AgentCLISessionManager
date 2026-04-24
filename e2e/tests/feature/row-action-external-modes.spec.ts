import { test, expect } from '@playwright/test';
import { seedEmptyLayout } from '../../helpers/layout-seed';

/**
 * T-63 coverage (follow-up to row-action-buttons.spec.ts):
 * The New-tab / Split / Focus row buttons call `window.openSession`,
 * which POSTs to `/api/open` (or `/api/focus`) to hand off to the
 * native Windows-Terminal shell. We observe the NETWORK call here
 * instead of stubbing the global — that avoids fighting with
 * data.jsx's own `Object.assign(window, { openSession })`.
 */
test.beforeEach(async ({ request }) => {
  await seedEmptyLayout(request);
});

for (const { label, mode, endpoint, expectSessionIdField } of [
  { label: 'New tab', mode: 'tab', endpoint: '/api/open', expectSessionIdField: 'sessionId' },
  { label: 'Split', mode: 'split', endpoint: '/api/open', expectSessionIdField: 'sessionId' },
]) {
  test(`clicking "${label}" on an inactive row POSTs ${endpoint} with mode=${mode}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

    const rows = page.locator('[data-testid^="session-row-"]');
    await rows.first().waitFor({ state: 'visible' });
    const firstRow = rows.first();
    const rowTid = await firstRow.getAttribute('data-testid');
    const sid8 = rowTid!.replace('session-row-', '');

    // Select the row so row-action buttons become pointer-enabled.
    await firstRow.click({ position: { x: 5, y: 5 } });

    // Start intercepting /api/open BEFORE we click the button.
    const request = page.waitForRequest((req) =>
      req.url().endsWith(endpoint) && req.method() === 'POST',
    );

    const btn = firstRow.locator(`[data-testid="rowbtn-${label.toLowerCase().replace(/\s+/g, '-')}"]`);
    await expect(btn).toBeVisible({ timeout: 2_000 });
    await btn.click({ force: true });

    const req = await request;
    const body = req.postDataJSON() as { sessionId?: string; mode?: string };
    expect(body[expectSessionIdField] && body[expectSessionIdField]!.slice(0, 8)).toBe(sid8);
    expect(body.mode).toBe(mode);
  });
}
