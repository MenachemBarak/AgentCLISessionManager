import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SSE live updates — watchdog Observer detects new/modified/deleted
 * session JSONL files and pushes `session_created` / `session_updated`
 * / `session_deleted` events through SSE. The frontend consumes these
 * and updates the left-pane row list in real time, WITHOUT requiring a
 * Rescan click.
 *
 * This test exercises the path end-to-end: write a file on disk,
 * assert the DOM row appears within N seconds (no user interaction).
 */
test.describe.configure({ mode: 'serial' });

const FIXTURE_ROOT = path.resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', 'claude-home');
const PROJECTS = path.join(FIXTURE_ROOT, 'projects');
const SSE_SID = '66666666-6666-4666-8666-666666666666';
const SSE_DIR = 'C--sse-live-test';

function cleanupSse(): void {
  const dir = path.join(PROJECTS, SSE_DIR);
  if (fs.existsSync(dir)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); }
    catch { /* best effort */ }
  }
}

test.describe('SSE live updates', () => {
  test.beforeEach(() => { cleanupSse(); });
  test.afterAll(() => { cleanupSse(); });

  test('new JSONL on disk → DOM row appears via watchdog+SSE (no rescan)', async ({ page }) => {
    await page.goto('/');
    const sid8 = SSE_SID.slice(0, 8);

    // PROOF BEFORE: wait for React to mount + confirm the row is absent.
    // Can't use `waitForLoadState('networkidle')` because the SSE stream
    // keeps a long-poll open → network is never idle.
    await expect(page.getByTestId('rescan-btn')).toBeVisible({ timeout: 10_000 });
    const beforeCount = await page.getByTestId(`session-row-${sid8}`).count();
    expect(beforeCount, 'row must not exist before we write the file').toBe(0);

    // ACT: write the JSONL on disk AFTER the page has mounted — so
    // we're exercising the LIVE watchdog path, not the initial index
    // build.
    const dir = path.join(PROJECTS, SSE_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${SSE_SID}.jsonl`),
      '{"type":"user","timestamp":"2026-04-23T10:00:00Z","cwd":"C:/sse/live/test",'
      + '"gitBranch":"main","message":{"content":"sse live","model":"claude-opus-4-7"}}\n',
      { encoding: 'utf8' },
    );

    // PROOF AFTER: row shows up within the SSE propagation window
    // (watchdog observation tick + SSE push + React render). Budget 15s
    // for CI slowness.
    await expect(page.getByTestId(`session-row-${sid8}`))
      .toBeVisible({ timeout: 30_000 });
  });

  test('deleting the JSONL → row disappears from DOM', async ({ page }) => {
    // Re-seed for deletion test
    const dir = path.join(PROJECTS, SSE_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${SSE_SID}.jsonl`);
    fs.writeFileSync(
      file,
      '{"type":"user","timestamp":"2026-04-23T10:00:00Z","cwd":"C:/sse/live/test",'
      + '"gitBranch":"main","message":{"content":"sse delete test","model":"claude-opus-4-7"}}\n',
      { encoding: 'utf8' },
    );

    const sid8 = SSE_SID.slice(0, 8);
    await page.goto('/');
    await expect(page.getByTestId(`session-row-${sid8}`))
      .toBeVisible({ timeout: 30_000 });

    // ACT: remove the file
    fs.unlinkSync(file);

    // PROOF: row disappears within propagation window
    await expect(page.getByTestId(`session-row-${sid8}`))
      .toHaveCount(0, { timeout: 30_000 });
  });
});
