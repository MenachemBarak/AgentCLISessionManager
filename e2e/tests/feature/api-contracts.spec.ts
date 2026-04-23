import { test, expect } from '@playwright/test';
import { readSessions, readStatus, readUpdateStatus, readLayoutState } from '../../helpers/api-probe';

/**
 * API contracts — the frontend binds to specific field names on each
 * endpoint. If a field disappears or changes type, the UI can break
 * silently (the rendered output may still look plausible). These tests
 * pin the shapes so any backend change surfaces as a test failure here,
 * not as a user-facing regression.
 */
test.describe('API contracts', () => {
  test('GET /api/status', async ({ page }) => {
    const s = await readStatus(page);
    expect(s).toMatchObject({
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      ready: expect.any(Boolean),
      phase: expect.any(String),
      done: expect.any(Number),
      total: expect.any(Number),
    });
  });

  test('GET /api/sessions', async ({ page }) => {
    const s = await readSessions(page);
    expect(typeof s.total).toBe('number');
    expect(Array.isArray(s.items)).toBe(true);
    if (s.items.length > 0) {
      expect(s.items[0]).toMatchObject({
        id: expect.any(String),
        title: expect.any(String),
        cwd: expect.any(String),
        provider: expect.any(String),
      });
    }
  });

  test('GET /api/update-status', async ({ page }) => {
    const u = await readUpdateStatus(page);
    expect(u).toMatchObject({
      currentVersion: expect.any(String),
      updateAvailable: expect.any(Boolean),
      staged: expect.any(Boolean),
      checked: expect.any(Boolean),
      downloadProgress: expect.any(Number),
    });
  });

  test('GET /api/layout-state round-trip', async ({ page, request }) => {
    const payload = {
      terminals: [{
        id: 'contract-t1', label: 'contract',
        tree: { kind: 'pane', id: 'cp1', spawn: { cmd: ['cmd.exe'] } },
      }],
      activeId: 'contract-t1',
      focusedPaneId: 'cp1',
    };
    const put = await request.put('/api/layout-state', { data: payload });
    expect(put.ok()).toBe(true);

    const got = await readLayoutState(page);
    expect(got).toMatchObject({
      terminals: expect.arrayContaining([expect.objectContaining({ id: 'contract-t1' })]),
      activeId: 'contract-t1',
      focusedPaneId: 'cp1',
    });
  });

  test('POST /api/update/apply guards stack consistently', async ({ page }) => {
    const r = await page.request.post('/api/update/apply');
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(false);
    // One of the three documented guards fired — message must reflect that.
    expect(body.message.toLowerCase()).toMatch(/windows|packaged|staged/);
  });
});
