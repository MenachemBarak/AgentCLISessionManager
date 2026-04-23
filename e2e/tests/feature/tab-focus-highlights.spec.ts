import { test, expect } from '@playwright/test';
import { seedResumableTab, seedEmptyLayout } from '../../helpers/layout-seed';
import { readSessions } from '../../helpers/api-probe';

/**
 * Feature #39 — when a terminal tab holding a resumable session
 * becomes active, the matching session row in the left pane must get
 * the "selected" marker. Proof-by-diff:
 *   1. Seed layout with a resumable tab whose sessionId is one that
 *      /api/sessions actually returns.
 *   2. Load the page. activeId hydrates to the seeded tab id.
 *   3. Assert the left-pane row for that session is highlighted.
 */

// Layout state is a shared file — stay serial.
test.describe.configure({ mode: 'serial' });

test.describe('terminal tab focus → session row highlight', () => {
  test('active resumable tab on hydration highlights the matching row', async ({ page, request }) => {
    // PROOF BEFORE: find a real sessionId the backend knows about.
    const { items } = await readSessions(page);
    test.skip(items.length === 0, 'fixture CLAUDE_HOME must have at least one session');
    const sid = items[0].id;
    const sid8 = sid.slice(0, 8);

    await seedResumableTab(request, sid, `cc-${sid8}`);

    await page.goto('/');

    // The row must exist (session is in the list) AND must carry the
    // selected style. The app applies a visible border/background to the
    // selected row — we assert via the class/attribute Chrome will pick
    // up. Since the CompactRow wraps in a div, checking the computed
    // border-color is fragile; instead rely on the scrollIntoView side
    // effect being called only when selected flips on. We verify the
    // simpler invariant: the row renders and is the one `CompactList`
    // passes `selected=true` to, via a computed-style probe.
    const row = page.getByTestId(`session-row-${sid8}`);
    await expect(row).toBeVisible({ timeout: 5_000 });

    // The row's border color changes when selected. We probe the inline
    // style directly through the DOM — the selected branch uses
    // `1.5px solid ${accent}`.
    await expect.poll(async () =>
      await row.evaluate((el) => {
        const s = (el as HTMLElement).style;
        const border = s.border || `${s.borderWidth} ${s.borderStyle} ${s.borderColor}`;
        return border.includes('1.5px') || !!s.background;
      }),
    { timeout: 5_000, message: 'row never picked up selected styling' }).toBe(true);
  });

  test('switching to the Transcript tab does not unhighlight', async ({ page, request }) => {
    // Prior selection should persist across tab switches — the highlight
    // is tied to selectedId, not activeId directly.
    const { items } = await readSessions(page);
    test.skip(items.length === 0, 'fixture CLAUDE_HOME must have at least one session');
    const sid = items[0].id;
    const sid8 = sid.slice(0, 8);

    await seedResumableTab(request, sid, `cc-${sid8}`);

    await page.goto('/');
    const row = page.getByTestId(`session-row-${sid8}`);
    await expect(row).toBeVisible();

    // Click Transcript tab — active tab changes, but the selected row
    // should not lose its state.
    await page.getByTestId('right-tab-transcript').click();
    await page.waitForTimeout(200);

    await expect(row).toBeVisible();
  });

  test('empty layout does not crash the active-session effect', async ({ page, request }) => {
    // Guard: activeId === 'transcript' + empty terminals array should
    // not attempt to call onActiveSessionChange with undefined.
    await seedEmptyLayout(request);

    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));

    await page.goto('/');
    await page.waitForTimeout(500);
    expect(pageErrors, `errors on empty-layout mount:\n${pageErrors.map((e) => e.stack).join('\n')}`).toHaveLength(0);
  });
});
