import { test, expect, Page } from '@playwright/test';
import { seedAdHocShellTab, seedEmptyLayout } from '../../helpers/layout-seed';

test.afterEach(async ({ request }) => {
  // Reset layout so a subsequent test in this worker doesn't inherit our
  // terminal tab + split pane (poisoning tests that assume Transcript is
  // the active right-pane tab).
  await seedEmptyLayout(request);
});

/**
 * Critical regression: splitting a pane must NOT restart the PTY of the
 * original pane. Before the portal refactor, the recursive TileTree's
 * inline <TerminalPane> unmounted whenever the tree restructured
 * (leaf → split-with-two-children), which closed its WebSocket and
 * killed the backend PTY. For a long-running agent that's data loss.
 *
 * Observable: each WebSocket to /api/pty/ws sends one `{type:"spawn"}`
 * at the start and receives one `{type:"ready", id}` back. Count the
 * distinct pty ids that the server emits over the lifetime of the page.
 *
 *   Before fix: ≥3 (original + remount of original + new pane)
 *   After fix:  2   (original stays bound, new pane spawns)
 */
test('splitting a pane preserves the original pane\'s PTY (no remount)', async ({ page, request }) => {
  // Predictable starting layout: one tab, one pane running cmd.exe.
  await seedAdHocShellTab(request);

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
      } catch { /* ignore non-JSON frames */ }
    });
  });

  await page.goto('/');
  await expect(page.getByTestId('right-tab-term-1')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('right-tab-term-1').click();

  // Wait for the first PTY to be ready (original pane).
  await expect.poll(() => readyIds.length, { timeout: 8_000 }).toBeGreaterThanOrEqual(1);
  const originalPtyId = readyIds[0];
  expect(originalPtyId).toBeTruthy();

  // Give the UI a beat to settle before the restructure.
  await page.waitForTimeout(500);
  const idsBeforeSplit = [...readyIds];

  // Split horizontally — this restructures the tile tree.
  await page.getByTestId('split-h-btn').click();

  // Wait for the new pane's PTY to connect.
  await expect.poll(() => readyIds.length, { timeout: 8_000 }).toBeGreaterThanOrEqual(
    idsBeforeSplit.length + 1
  );

  // Settle — if the original pane was remounted, a 3rd `ready` would appear
  // shortly after the split as React reconciles and the remounted pane
  // opens a fresh WS.
  await page.waitForTimeout(1_500);

  // Assertions:
  // 1) Exactly 2 distinct PTYs ever became ready (original + new pane).
  //    Any remount of the original would produce a 3rd.
  const distinctIds = [...new Set(readyIds)];
  expect(distinctIds).toHaveLength(2);

  // 2) The original PTY id is still in the set.
  expect(distinctIds).toContain(originalPtyId);
});
