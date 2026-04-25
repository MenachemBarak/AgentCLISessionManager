import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { seedEmptyLayout } from '../../helpers/layout-seed';

/**
 * T-63 audit final slice: active-session row buttons.
 *
 * The hermetic fixture has 0 active sessions because no claude
 * process is running in CI. To exercise the active-row UI path we
 * write a "legacy-shape" active marker (pid only, no startedAt) into
 * the fixture's sessions/ dir pointing at the Playwright runner's
 * own pid. Backend's _is_live_marker takes the pid_exists-only
 * fallback when startedAt is absent (per v1.2.15 behavior in #88).
 *
 * Buttons covered:
 *   - rowbtn-focus            → POST /api/focus
 *   - rowbtn-open-in-manager  → openInViewer → spawns shell-wrap tab
 */
const FIXTURE_HOME = path.resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', 'claude-home');
const ACTIVE_DIR = path.join(FIXTURE_HOME, 'sessions');
const FIRST_FIXTURE_SID = '11111111-1111-4111-8111-111111111111';

let markerPath: string;

test.beforeEach(async ({ request }) => {
  await seedEmptyLayout(request);
  // Seed an active marker pointing at OUR own pid. Legacy shape
  // (no startedAt) so _is_live_marker takes the pid_exists fallback.
  fs.mkdirSync(ACTIVE_DIR, { recursive: true });
  markerPath = path.join(ACTIVE_DIR, `${process.pid}.json`);
  fs.writeFileSync(markerPath, JSON.stringify({
    pid: process.pid,
    sessionId: FIRST_FIXTURE_SID,
  }), { encoding: 'utf-8' });
  // Force the backend to re-pick up the marker.
  await request.post('/api/rescan');
});

test.afterEach(async ({ request }) => {
  try { fs.unlinkSync(markerPath); } catch { /* best-effort */ }
  await request.post('/api/rescan');
  await seedEmptyLayout(request);
});

test('Active row exposes rowbtn-focus that POSTs /api/focus with the sid', async ({ page }) => {
  const sid8 = FIRST_FIXTURE_SID.slice(0, 8);

  await page.goto('/');
  await page.locator(`[data-testid="session-row-${sid8}"]`).waitFor({ state: 'visible', timeout: 10_000 });
  const row = page.locator(`[data-testid="session-row-${sid8}"]`);
  await row.click({ position: { x: 5, y: 5 } });

  const focusBtn = row.locator('[data-testid="rowbtn-focus"]');
  await expect(focusBtn).toBeVisible({ timeout: 2_000 });

  const reqP = page.waitForRequest(
    (req) => req.url().endsWith('/api/focus') && req.method() === 'POST',
  );
  await focusBtn.click({ force: true });
  const req = await reqP;
  const body = req.postDataJSON() as { sessionId?: string };
  expect(body.sessionId).toBe(FIRST_FIXTURE_SID);
});

test('Active+unmanaged row exposes rowbtn-open-in-manager → spawns shell-wrap tab', async ({ page, request }) => {
  const sid8 = FIRST_FIXTURE_SID.slice(0, 8);

  await page.goto('/');
  await page.locator(`[data-testid="session-row-${sid8}"]`).waitFor({ state: 'visible', timeout: 10_000 });
  const row = page.locator(`[data-testid="session-row-${sid8}"]`);
  await row.click({ position: { x: 5, y: 5 } });

  const openInMgr = row.locator('[data-testid="rowbtn-open-in-manager"]');
  await expect(openInMgr).toBeVisible({ timeout: 2_000 });
  await openInMgr.click({ force: true });

  // Wait for the tab to spawn + the persist debounce to fire.
  await page.waitForTimeout(700);

  const layout = await request.get('/api/layout-state').then((r) => r.json());
  const sids: string[] = [];
  function walk(n: any) {
    if (!n) return;
    if (n.kind === 'pane') {
      const s = n.spawn?._autoResume?.sessionId;
      if (s) sids.push(s);
    }
    if (n.kind === 'split') (n.children || []).forEach(walk);
  }
  for (const t of layout.terminals || []) walk(t.tree);
  expect(sids).toContain(FIRST_FIXTURE_SID);
});
