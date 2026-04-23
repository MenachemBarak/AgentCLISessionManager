import { test, expect } from '@playwright/test';
import { RightPane } from '../../pages/rightPane';
import { Transcript } from '../../pages/transcript';
import { capturePageState } from '../../helpers/page-state';
import { seedEmptyLayout } from '../../helpers/layout-seed';

test.describe.configure({ mode: 'serial' });

test.describe('right pane — tabs and splits', () => {
  test.beforeEach(async ({ request }) => {
    // Every test starts from zero terminal tabs so tab-count assertions
    // are deterministic regardless of earlier fixture leftovers.
    await seedEmptyLayout(request);
  });

  test('opening a new terminal creates a tab + a pane', async ({ page }) => {
    await page.goto('/');
    const rp = new RightPane(page);

    // Gate on the testid being present — under the frozen exe on CI,
    // React mount is noticeably slower than dev server and a premature
    // capturePageState() would see an empty testid map.
    await expect(page.getByTestId('right-tab-new-terminal')).toBeVisible({ timeout: 10_000 });

    // PROOF BEFORE: zero terminal tabs, zero tile-panes.
    const before = await capturePageState(page);
    expect(before.testidGroups['right-tab-new-terminal'] ?? 0).toBe(1);
    expect(await rp.tabCount()).toBe(0);
    expect(await rp.paneCount()).toBe(0);

    // ACT
    await rp.openNewTerminal();

    // PROOF AFTER: one more terminal tab and one tile-pane.
    await expect.poll(() => rp.tabCount(), { timeout: 3_000 }).toBe(1);
    expect(await rp.paneCount()).toBe(1);
  });

  test('splitting the active pane H adds a pane', async ({ page }) => {
    await page.goto('/');
    const rp = new RightPane(page);
    await rp.openNewTerminal();
    await expect.poll(() => rp.paneCount(), { timeout: 3_000 }).toBe(1);

    await rp.splitActivePaneHorizontal();
    await expect.poll(() => rp.paneCount(), { timeout: 3_000 }).toBe(2);
  });

  test('splitting the active pane V adds a pane', async ({ page }) => {
    await page.goto('/');
    const rp = new RightPane(page);
    await rp.openNewTerminal();
    await expect.poll(() => rp.paneCount(), { timeout: 3_000 }).toBe(1);

    await rp.splitActivePaneVertical();
    await expect.poll(() => rp.paneCount(), { timeout: 3_000 }).toBe(2);
  });

  test('closing a terminal tab drops it and its panes', async ({ page }) => {
    await page.goto('/');
    const rp = new RightPane(page);

    await rp.openNewTerminal();
    await expect.poll(() => rp.tabCount(), { timeout: 3_000 }).toBe(1);

    // Find the term-id the app assigned (it auto-increments).
    const termId = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-testid^="right-tab-term-"]')].find(
        (e) => /^right-tab-term-\d+$/.test(e.getAttribute('data-testid') || ''),
      );
      return el ? (el.getAttribute('data-testid') || '').replace('right-tab-', '') : null;
    });
    expect(termId, 'expected a right-tab-term-N testid to be present').not.toBeNull();

    await rp.closeTab(termId as string);
    await expect.poll(() => rp.tabCount(), { timeout: 3_000 }).toBe(0);
    await expect.poll(() => rp.paneCount(), { timeout: 3_000 }).toBe(0);
  });

  test('transcript pane is the default active tab', async ({ page }) => {
    await page.goto('/');
    const t = new Transcript(page);
    // Wait for React mount; on the frozen exe, transcript-pane can take
    // a beat longer to appear than on the dev server.
    await expect(t.root()).toBeVisible({ timeout: 10_000 });
    expect(await t.isVisible()).toBe(true);
  });
});
