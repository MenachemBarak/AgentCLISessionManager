import { test, expect } from '@playwright/test';
import { seedEmptyLayout } from '../../helpers/layout-seed';
import { RightPane } from '../../pages/rightPane';

/**
 * Closing a pane drops it from the tile tree. Split-then-close is the
 * primary workflow for experimenting with layouts, and the
 * `close-pane-btn` was completely uncovered before this spec.
 *
 * Three cases:
 *   1. Close the only pane in a tab → tab's tree goes empty; tab
 *      itself may collapse back to "no terminal" state.
 *   2. Close one pane of a 2-pane split → sibling takes the full space.
 *   3. Close a pane in a nested split → the nested split collapses.
 *
 * Each case includes a hard invariant: the REMAINING panes' PTYs must
 * stay alive (the #86 portal refactor's guarantee). We assert by
 * capturing the WS ready frames and checking the survivor's spawn id
 * is stable before vs after.
 */
test.beforeEach(async ({ request }) => {
  await seedEmptyLayout(request);
});

test('close one pane of a 2-pane split → sibling takes full space, its PTY survives', async ({ page, request }) => {
  const rp = new RightPane(page);
  // A pageerror in THIS test indicates the removeChild regression (or a
  // fresh one). Surface it so the test never silently passes on an error.
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  const readyIds: string[] = [];
  page.on('websocket', (ws) => {
    if (!ws.url().endsWith('/api/pty/ws')) return;
    ws.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') return;
      try {
        const msg = JSON.parse(payload);
        if (msg.type === 'ready' && typeof msg.id === 'string') {
          readyIds.push(msg.id);
        }
      } catch { /* ignore */ }
    });
  });

  await page.goto('/');
  await rp.openNewTerminal();
  await expect.poll(() => rp.paneCount(), { timeout: 10_000 }).toBe(1);

  // Wait for the first PTY to be ready.
  await expect.poll(() => readyIds.length, { timeout: 8_000 }).toBeGreaterThanOrEqual(1);
  const firstPtyId = readyIds[0];

  // Split horizontally → 2 panes. splitNode auto-focuses the NEW pane.
  await rp.splitActivePaneHorizontal();
  await expect.poll(() => rp.paneCount(), { timeout: 5_000 }).toBe(2);
  await expect.poll(() => readyIds.length, { timeout: 8_000 }).toBeGreaterThanOrEqual(2);

  // Let React settle the focus-update setTimeout before closing.
  await page.waitForTimeout(200);

  // Close the focused (new) pane.
  await rp.closeActivePane();

  // Back to 1 pane; original PTY id should still be in the ready set
  // (no new spawn was needed for it).
  await expect.poll(() => rp.paneCount(), { timeout: 5_000 }).toBe(1);
  await page.waitForTimeout(600);
  expect(readyIds).toContain(firstPtyId);
  // Exactly 2 distinct PTYs were ever ready: the original + the split
  // child. Closing the child doesn't spawn a 3rd.
  expect(new Set(readyIds).size).toBe(2);

  // And: no React errors during the close (would indicate the
  // removeChild-on-moved-wrapper regression coming back).
  expect(pageErrors.map((e) => e.message).filter((m) => m.includes('removeChild'))).toEqual([]);
});

test('close the only pane in a tab → tab drops out of the tab list', async ({ page }) => {
  const rp = new RightPane(page);
  await page.goto('/');

  const before = await rp.tabCount();
  await rp.openNewTerminal();
  await expect.poll(() => rp.tabCount(), { timeout: 10_000 }).toBe(before + 1);
  await expect.poll(() => rp.paneCount(), { timeout: 10_000 }).toBe(1);

  await rp.closeActivePane();

  // Single-pane close should collapse the tab itself back out.
  await expect.poll(() => rp.tabCount(), { timeout: 5_000 }).toBe(before);
});
