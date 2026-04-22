import { test, expect } from '@playwright/test';
import { WindowChrome } from '../../pages/windowChrome';
import { SessionList } from '../../pages/sessionList';

/**
 * App-boots feature — the one test that would have caught the
 * black-screen regression that v0.9.0 shipped with: the React tree
 * crashed on malformed persisted layout state, leaving the pywebview
 * window entirely black even though /api/status returned 200.
 *
 * We treat any uncaught page error or console exception during mount
 * as a hard failure — "it responds to /api/status" is NOT proof the UI
 * loaded.
 */
test.describe('app boots', () => {
  const pageErrors: Error[] = [];
  const consoleExceptions: string[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors.length = 0;
    consoleExceptions.length = 0;
    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'exception') {
        consoleExceptions.push(msg.text());
      }
    });
  });

  test('renders a title bar with version and a session list (or empty state)', async ({ page }) => {
    await page.goto('/');

    const chrome = new WindowChrome(page);
    const list = new SessionList(page);

    // React must actually mount. The black-screen bug showed #root having
    // zero children — we assert the opposite directly.
    await expect.poll(async () =>
      await page.evaluate(() => document.getElementById('root')?.children.length ?? 0),
    { timeout: 10_000 }).toBeGreaterThan(0);

    // Title bar shows a semver-shaped version fetched from /api/status.
    await expect.poll(() => chrome.readVersion(), { timeout: 5_000 }).toMatch(/^v\d+\.\d+\.\d+$/);

    // Session list either rendered rows or the empty-state — but it
    // resolved. A crashing list (the original TileTree bug) never does.
    await list.waitReady();

    // And no uncaught errors made it to the page. This is the single
    // assertion that makes the whole test load-bearing.
    expect(pageErrors, `uncaught page errors during boot:\n${pageErrors.map(e => e.stack).join('\n')}`).toHaveLength(0);
    expect(consoleExceptions, `console errors during boot:\n${consoleExceptions.join('\n')}`).toHaveLength(0);
  });

  test('recovers from a corrupt persisted layout state (regression: v0.9.0 probe bug)', async ({ page, request }) => {
    // Seed the exact shape that broke the v0.9.0 release: kind:"leaf"
    // is not something TileTree knows about — the unhardened version
    // fell through to the split branch and crashed on undefined children.
    await request.put('/api/layout-state', {
      data: {
        terminals: [{ id: 't1', label: 'probe', tree: { id: 'p1', kind: 'leaf', spawn: { cmd: ['cmd.exe'] } } }],
        activeId: 't1',
        focusedPaneId: 'p1',
      },
    });

    await page.goto('/');

    // With the defensive migration in TileTree, this bad shape should
    // log a warning but NOT break the render tree.
    await expect.poll(async () =>
      await page.evaluate(() => document.getElementById('root')?.children.length ?? 0),
    { timeout: 10_000 }).toBeGreaterThan(0);

    expect(pageErrors).toHaveLength(0);
  });
});
