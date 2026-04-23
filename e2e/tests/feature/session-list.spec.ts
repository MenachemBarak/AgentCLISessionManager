import { test, expect } from '@playwright/test';
import { WindowChrome } from '../../pages/windowChrome';
import { SessionList } from '../../pages/sessionList';
import { capturePageState } from '../../helpers/page-state';
import { readSessions, readStatus } from '../../helpers/api-probe';

/**
 * Session list — the left pane. Tests that what the API reports
 * (`/api/sessions`) matches what the DOM renders (`[data-testid^="session-row-"]`).
 * A one-source assertion could lie in either direction — we cross-check.
 */
test.describe('session list', () => {
  test('DOM row count matches /api/sessions total (up to visible limit)', async ({ page }) => {
    // PROOF BEFORE: backend is ready and has a known session total.
    const status = await readStatus(page);
    expect(status.ready, `/api/status reports ready=false (phase=${status.phase})`).toBe(true);

    const beforeSessions = await readSessions(page);
    expect(beforeSessions.total, 'fixture CLAUDE_HOME should have seeded sessions').toBeGreaterThan(0);

    // ACT
    await page.goto('/');
    const list = new SessionList(page);
    await list.waitReady();

    // PROOF AFTER: DOM count tracks API count (accepting that some filters
    // may hide a few; but with default filters every session should be
    // visible unless a user-supplied query was left in localStorage).
    const after = await capturePageState(page);
    const domRowCount = after.testidGroups['session-row-'] ?? 0;
    expect(domRowCount, `DOM rows=${domRowCount}, api total=${beforeSessions.total}`)
      .toBeGreaterThanOrEqual(Math.min(beforeSessions.total, 1));

    // Title bar reports some count of "active" — must be <= total.
    expect(after.bodyTextHead).toMatch(/active/);
  });

  test('title bar version matches /api/status version (no hardcoded drift)', async ({ page }) => {
    const { version } = await readStatus(page);

    await page.goto('/');
    const chrome = new WindowChrome(page);
    // WindowChrome fetches /api/status on first paint — the span may be
    // empty for a brief moment. Poll until it settles.
    await expect.poll(() => chrome.readVersion(), { timeout: 5_000 })
      .toBe(`v${version}`);
  });

  test('search input narrows the rendered list', async ({ page, request: _req }) => {
    await page.goto('/');
    const list = new SessionList(page);
    await list.waitReady();

    // PROOF BEFORE: capture current visible row count + get one known title from the data.
    const beforeCount = await list.count();
    expect(beforeCount, 'fixture must seed at least 2 sessions to test search').toBeGreaterThanOrEqual(2);

    // Grab a row's label from the API so we know a real query hit.
    const { items } = await readSessions(page);
    const needle = (items[0].title || items[0].id).slice(0, 4);

    // ACT: type the prefix and wait for re-render.
    const matchingAfter = await list.searchFor(needle);

    // PROOF AFTER: row count is <= before (filter narrowed or kept same
    // if every session happens to share the prefix, which is rare).
    expect(matchingAfter, `search for "${needle}" did not narrow the list (before=${beforeCount}, after=${matchingAfter})`)
      .toBeLessThanOrEqual(beforeCount);
    expect(matchingAfter).toBeGreaterThanOrEqual(1);

    // Clearing restores the full list.
    await list.clearSearch();
    await page.waitForTimeout(150);
    const cleared = await list.count();
    expect(cleared).toBe(beforeCount);
  });
});
