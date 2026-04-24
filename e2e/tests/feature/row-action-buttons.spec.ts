import { test, expect } from '@playwright/test';
import { seedEmptyLayout } from '../../helpers/layout-seed';
import { RightPane } from '../../pages/rightPane';

/**
 * T-63 coverage: the per-row action buttons on the left-pane session
 * list had ZERO e2e coverage before this spec. Each button's onClick
 * calls `onOpen(session, mode)` which routes through app.jsx's
 * handleOpen. Modes:
 *   - 'focus'          → window.openSession (external Windows Terminal)
 *   - 'tab' / 'split'  → window.openSession (external)
 *   - 'in-viewer'      → window.openInViewer (embedded shell-wrap tab)
 *
 * External-Windows-Terminal modes are skipped here (would need a
 * mock). The 'in-viewer' flow is fully testable inside Playwright —
 * it spawns a new terminal tab with a shell-wrap spawn payload that
 * includes `_autoResume.sessionId` matching the clicked row's sid.
 */
test.beforeEach(async ({ request }) => {
  await seedEmptyLayout(request);
});

test.afterEach(async ({ request }) => {
  // Don't leak the spawned terminal tab into later tests' persisted state.
  await seedEmptyLayout(request);
});

test('clicking "In viewer" on an inactive session row spawns a shell-wrap tab', async ({ page, request }) => {
  const rp = new RightPane(page);
  // Capture pageerror so we catch regressions like the removeChild
  // tear-down from PR #98.
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/');
  await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

  // Pick the first INACTIVE session row (fixture has 2 non-active
  // sessions — neither of their PIDs is live).
  const rows = page.locator('[data-testid^="session-row-"]');
  await rows.first().waitFor({ state: 'visible' });
  const firstRow = rows.first();
  const rowTid = await firstRow.getAttribute('data-testid');
  expect(rowTid).toMatch(/^session-row-/);
  const sid8 = rowTid!.replace('session-row-', '');

  // Hover to reveal the per-row action buttons.
  await firstRow.hover();

  const inViewerBtn = firstRow.locator('[data-testid="rowbtn-in-viewer"]');
  await expect(inViewerBtn).toBeVisible({ timeout: 2_000 });
  await inViewerBtn.click();

  // A new terminal tab should now exist. Its label starts with "Resume"
  // or a custom user label, but the right-tab-* testid is definitive.
  await expect.poll(() => rp.tabCount(), { timeout: 5_000 }).toBeGreaterThan(0);

  // Wait for the 400ms debounced layout-state persist to fire.
  await page.waitForTimeout(700);

  // The persisted layout state should contain a pane with _autoResume
  // matching the row's sid (first 8 chars).
  const layout = await request.get('/api/layout-state').then((r) => r.json());
  const sids: string[] = [];
  function walk(node: any) {
    if (!node) return;
    if (node.kind === 'pane') {
      const s = node.spawn?._autoResume?.sessionId;
      if (s) sids.push(s.slice(0, 8));
    }
    if (node.kind === 'split') (node.children || []).forEach(walk);
  }
  for (const t of layout.terminals || []) walk(t.tree);
  expect(sids).toContain(sid8);

  expect(pageErrors.map((e) => e.message)).toEqual([]);
});
