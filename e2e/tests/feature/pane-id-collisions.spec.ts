import { test, expect } from '@playwright/test';

/**
 * Regression guard for T-61: the blank-pane bug on v1.2.15 where a
 * user's persisted layout had pane-id collisions (within a tree and
 * across tabs), and the v1.2.15 portal refactor silently resolved the
 * wrong slot or collapsed duplicate React keys.
 *
 * Two cases:
 *   (A) Same pane-id in two different tabs → TerminalPane's slot lookup
 *       must scope to the owning tab div, not `document`.
 *   (B) Duplicate pane-id within one tree → app must dedup on load so
 *       React keys stay unique and every pane gets its own TerminalPane.
 */

test('pane-id collision across tabs — each tab\'s pane finds its OWN slot', async ({ page, request }) => {
  // Seed two tabs, both with a pane whose id is `pane-2`.
  await request.put('/api/layout-state', {
    data: {
      terminals: [
        { id: 'term-A', label: 'A',
          tree: { kind: 'pane', id: 'pane-2', spawn: { cmd: ['cmd.exe'] } } },
        { id: 'term-B', label: 'B',
          tree: { kind: 'pane', id: 'pane-2', spawn: { cmd: ['cmd.exe'] } } },
      ],
      activeId: 'term-B',
      focusedPaneId: 'pane-2',
    },
  });

  await page.goto('/');
  // activeId=term-B is already in the seed — no click needed (clicking
  // the tab button hit-tests to the close-X and removes the tab).
  await expect(page.getByTestId('right-tab-term-B')).toBeVisible({ timeout: 10_000 });

  // Both tabs' slots must each be filled by exactly one wrapper. After
  // the on-load dedup, one of the tabs has its pane renamed to a fresh
  // id, so we check that every tab with a data-pane-slot has a non-
  // empty slot — no cross-tab grabbing allowed.
  await expect.poll(async () =>
    page.evaluate(() => {
      const tabs = document.querySelectorAll('[data-terminal-tab]');
      const report: Array<{ tab: string, slots: number, filled: number }> = [];
      for (const t of tabs) {
        const slots = t.querySelectorAll('[data-pane-slot]');
        const filled = [...slots].filter((s) => s.children.length > 0).length;
        report.push({ tab: t.getAttribute('data-terminal-tab') || '', slots: slots.length, filled });
      }
      return report;
    }),
  { timeout: 10_000 }
  ).toEqual([
    { tab: 'term-A', slots: 1, filled: 1 },
    { tab: 'term-B', slots: 1, filled: 1 },
  ]);
});

test('duplicate pane-ids within one tree are deduped on load', async ({ page, request }) => {
  // Intentionally corrupt tree: two panes with id=pane-1.
  await request.put('/api/layout-state', {
    data: {
      terminals: [{
        id: 'term-dup', label: 'dup',
        tree: {
          kind: 'split', dir: 'h', ratio: 0.5,
          children: [
            { kind: 'pane', id: 'pane-1', spawn: { cmd: ['cmd.exe'] } },
            { kind: 'pane', id: 'pane-1', spawn: { cmd: ['cmd.exe'] } },
          ],
        },
      }],
      activeId: 'term-dup',
      focusedPaneId: 'pane-1',
    },
  });

  await page.goto('/');
  await page.getByTestId('right-tab-term-dup').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('right-tab-term-dup').click();

  // After dedup + render, BOTH slots must be distinct and filled.
  await expect.poll(async () =>
    page.evaluate(() => {
      const tab = document.querySelector('[data-terminal-tab="term-dup"]');
      if (!tab) return { err: 'no-tab' };
      const slots = tab.querySelectorAll('[data-pane-slot]');
      const ids = [...slots].map((s) => s.getAttribute('data-pane-slot'));
      const filled = [...slots].filter((s) => s.children.length > 0).length;
      return { count: slots.length, unique: new Set(ids).size, filled };
    }),
  { timeout: 10_000 }
  ).toMatchObject({ count: 2, unique: 2, filled: 2 });
});
