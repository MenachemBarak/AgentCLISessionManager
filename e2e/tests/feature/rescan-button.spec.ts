import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Rescan button (v0.8.0). Exposed as `data-testid="rescan-btn"` inside
 * the ACTIVE section header. Clicking POSTs `/api/rescan`, which:
 *   1. Cleans up stale `~/.claude/sessions/<pid>.json` markers whose PIDs
 *      are no longer alive.
 *   2. Rebuilds the in-memory index by walking `projects/**\/*.jsonl`.
 *
 * This suite verifies the end-to-end: put a new session file on disk
 * AFTER the initial index build, click Rescan, assert the new row
 * appears in the DOM.
 *
 * Note: watchdog ALSO detects new files live. This test is specifically
 * for the manual Rescan path — we need a scenario the watcher can't
 * trivially catch. We simulate it by writing the file into a fresh
 * project dir that (maybe) the watcher will also notice, but we click
 * Rescan explicitly within a short window so the button's API call is
 * the load-bearing step.
 */
test.describe.configure({ mode: 'serial' });

const FIXTURE_ROOT = path.resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', 'claude-home');
const PROJECTS = path.join(FIXTURE_ROOT, 'projects');
const RESCAN_SID = '77777777-7777-4777-8777-777777777777';
const RESCAN_DIR = 'C--rescan-test-src';

function cleanupRescanArtifacts(): void {
  const dir = path.join(PROJECTS, RESCAN_DIR);
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}

async function listSessions(request: APIRequestContext): Promise<{ items: Array<{ id: string }> }> {
  const r = await request.get('/api/sessions');
  return await r.json();
}

test.describe('rescan button', () => {
  test.beforeEach(() => { cleanupRescanArtifacts(); });
  test.afterAll(() => { cleanupRescanArtifacts(); });

  test('clicking rescan picks up a newly-added session file', async ({ page, request }) => {
    // PROOF BEFORE: the rescan-test session is NOT in the list.
    const before = await listSessions(request);
    expect(before.items.find((s) => s.id === RESCAN_SID),
      'rescan-test sid must not be in fixture before the write').toBeUndefined();

    await page.goto('/');
    // Wait for React to finish mounting before probing for the rescan
    // button — on slow CI the initial render can lag the `.goto()` by
    // several seconds. Any testid that's always present works as a gate.
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('rescan-btn')).toBeAttached({ timeout: 10_000 });

    // ACT (filesystem): seed a new JSONL
    const dir = path.join(PROJECTS, RESCAN_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${RESCAN_SID}.jsonl`),
      '{"type":"user","timestamp":"2026-04-23T10:00:00Z","cwd":"C:/rescan/test/src",'
      + '"gitBranch":"main","message":{"content":"rescan test seed","model":"claude-opus-4-7"}}\n',
      { encoding: 'utf8' },
    );

    // ACT (UI): click the Rescan button
    await page.getByTestId('rescan-btn').click();

    // PROOF AFTER: /api/sessions now includes the new sid AND the DOM
    // rendered a row with the matching short-id testid.
    const sid8 = RESCAN_SID.slice(0, 8);
    await expect.poll(async () => {
      const s = await listSessions(request);
      return !!s.items.find((x) => x.id === RESCAN_SID);
    }, { timeout: 10_000 }).toBe(true);

    await expect(page.getByTestId(`session-row-${sid8}`))
      .toBeVisible({ timeout: 5_000 });
  });
});
