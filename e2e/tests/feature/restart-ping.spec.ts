import { test, expect } from '@playwright/test';

/**
 * Restart-ping feature — when the viewer boots, tabs restored from
 * persisted layout that hold a resumable session (`spawn.sessionId`)
 * should be queued for an auto-ping after their PTY reports ready.
 *
 * We don't exercise the PTY WebSocket here (that needs a real claude
 * binary and would be flaky across environments). Instead we verify the
 * collection half of the pipeline: given a layout state with a resumable
 * tab, does the hydration effect populate `window._restartPingPending`?
 *
 * The pane-level "fire the ping after ready" branch is covered by manual
 * e2e verification and by unit-level invariants baked into terminal-pane.jsx.
 */
// Layout state is a single file on disk — parallel workers would overwrite
// each other's seeds. Run this file's tests serially.
test.describe.configure({ mode: 'serial' });

test.describe('restart ping', () => {
  test('hydration seeds pending set with every restored sessionId', async ({ page, request }) => {
    const sidA = '11111111-1111-4111-8111-111111111111';
    const sidB = '22222222-2222-4222-8222-222222222222';

    // Seed a layout with two resumable tabs + one ad-hoc shell.
    await request.put('/api/layout-state', {
      data: {
        terminals: [
          {
            id: 'term-1', label: 'resume-A',
            tree: { kind: 'pane', id: 'p1', spawn: { provider: 'claude-code', sessionId: sidA } },
          },
          {
            id: 'term-2', label: 'resume-B',
            tree: { kind: 'pane', id: 'p2', spawn: { provider: 'claude-code', sessionId: sidB } },
          },
          {
            id: 'term-3', label: 'shell',
            tree: { kind: 'pane', id: 'p3', spawn: { cmd: ['cmd.exe'] } },
          },
        ],
        activeId: 'term-1',
        focusedPaneId: 'p1',
      },
    });

    await page.goto('/');

    // Hydration runs async in a useEffect. The sessionId makes at most
    // one round trip: pending (just-seeded) → fired (after PTY ready
    // schedules the ping). Either location proves "the restart-ping
    // pipeline noticed this sessionId on boot", which is what the test
    // actually guarantees. Asserting only on `pending.has(sid)` races
    // against the PTY ready handler.
    await expect.poll(async () =>
      await page.evaluate(({ a, b }) => {
        const seen = (sid) =>
          (window._restartPingPending && window._restartPingPending.has(sid))
          || (window._restartPingFired && window._restartPingFired.has(sid));
        return seen(a) && seen(b);
      }, { a: sidA, b: sidB }),
    { timeout: 5_000, message: 'restart-ping pipeline never saw sidA + sidB' }).toBe(true);

    // Neither set must contain any junk (pane id, cmd.exe, etc). The
    // union should be exactly {sidA, sidB} — pending.size + fired.size
    // equals 2, all members match the two seeded sids.
    const unionSize = await page.evaluate(() => {
      const p = window._restartPingPending || new Set();
      const f = window._restartPingFired || new Set();
      const u = new Set([...p, ...f]);
      return u.size;
    });
    expect(unionSize).toBe(2);
  });

  test('nested splits still collect all sessionIds', async ({ page, request }) => {
    const sidC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const sidD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    await request.put('/api/layout-state', {
      data: {
        terminals: [{
          id: 'term-1', label: 'split-tab',
          tree: {
            kind: 'split', dir: 'h', ratio: 0.5,
            children: [
              { kind: 'pane', id: 'p1', spawn: { provider: 'claude-code', sessionId: sidC } },
              {
                kind: 'split', dir: 'v', ratio: 0.5,
                children: [
                  { kind: 'pane', id: 'p2', spawn: { provider: 'claude-code', sessionId: sidD } },
                  { kind: 'pane', id: 'p3', spawn: { cmd: ['cmd.exe'] } },
                ],
              },
            ],
          },
        }],
        activeId: 'term-1',
        focusedPaneId: 'p1',
      },
    });

    await page.goto('/');

    await expect.poll(async () =>
      await page.evaluate(({ c, d }) => {
        const seen = (sid) =>
          (window._restartPingPending && window._restartPingPending.has(sid))
          || (window._restartPingFired && window._restartPingFired.has(sid));
        return seen(c) && seen(d);
      }, { c: sidC, d: sidD }),
    { timeout: 5_000 }).toBe(true);
  });

  test('empty layout produces an empty pending set (no crash)', async ({ page, request }) => {
    await request.put('/api/layout-state', {
      data: { terminals: [], activeId: null, focusedPaneId: null },
    });

    await page.goto('/');

    // Both sets must be empty OR unset — no sids collected means no
    // pings queued or fired.
    await expect.poll(async () =>
      await page.evaluate(() => {
        const p = window._restartPingPending;
        const f = window._restartPingFired;
        return (!p || p.size === 0) && (!f || f.size === 0);
      }),
    { timeout: 5_000 }).toBe(true);
  });
});
