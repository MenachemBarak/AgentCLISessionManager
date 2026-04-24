import { test, expect } from '@playwright/test';
import { seedEmptyLayout } from '../../helpers/layout-seed';
import { RightPane } from '../../pages/rightPane';

/**
 * T-63 coverage: tile-divider drag. Zero previous coverage even though
 * it's one of the primary layout-manipulation flows. Split → grab the
 * divider → drag → the persisted `tree.ratio` must reflect the new
 * position (non-default, non-clamped).
 */
test.beforeEach(async ({ request }) => {
  await seedEmptyLayout(request);
});

test.afterEach(async ({ request }) => {
  await seedEmptyLayout(request);
});

test('dragging the divider between 2 H-split panes updates tree.ratio', async ({ page, request }) => {
  const rp = new RightPane(page);
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/');
  await rp.openNewTerminal();
  await expect.poll(() => rp.paneCount(), { timeout: 10_000 }).toBe(1);
  await rp.splitActivePaneHorizontal();
  await expect.poll(() => rp.paneCount(), { timeout: 5_000 }).toBe(2);

  // The divider for the root split is `tile-divider-root-h`.
  const divider = page.getByTestId('tile-divider-root-h');
  const box = await divider.boundingBox();
  expect(box).not.toBeNull();
  const { x, y, width, height } = box!;
  const startX = x + width / 2;
  const startY = y + height / 2;

  // Drag the divider ~40% to the LEFT. For an h-split with ratio 0.5,
  // we expect ratio to drop to ~0.1.
  const pane = page.locator('[data-testid^="tile-pane-"]').first();
  const paneBox = await pane.boundingBox();
  const totalW = (paneBox?.width ?? 0) * 2;  // ~ total width of parent flex
  const targetX = startX - Math.round(totalW * 0.4);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(targetX, startY, { steps: 10 });
  await page.mouse.up();

  // Wait for the debounced persist.
  await page.waitForTimeout(700);

  const layout = await request.get('/api/layout-state').then((r) => r.json());
  const t = layout.terminals?.[0];
  expect(t).toBeDefined();
  expect(t.tree.kind).toBe('split');
  // Ratio should have moved meaningfully left of 0.5 but above the 0.05 clamp.
  expect(t.tree.ratio).toBeLessThan(0.4);
  expect(t.tree.ratio).toBeGreaterThan(0.05);

  expect(pageErrors.map((e) => e.message)).toEqual([]);
});
