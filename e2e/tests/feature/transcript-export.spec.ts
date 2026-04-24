import { test, expect } from '@playwright/test';

/**
 * Transcript markdown export — click the ↓ .md button in the transcript
 * header and the browser should trigger a download of session-<id>.md.
 */
test.describe('transcript export to markdown', () => {
  test('export button is reachable and points at the .md endpoint', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

    // Pick the first session in the fixture so the transcript renders.
    // Row testids are `session-row-<first-8-of-id>`; rather than
    // hardcoding an id, click the first row we find.
    const firstRow = page.locator('[data-testid^="session-row-"]').first();
    await firstRow.waitFor({ state: 'visible', timeout: 10_000 });
    await firstRow.click();

    const exportBtn = page.getByTestId('transcript-export-md');
    await expect(exportBtn).toBeVisible({ timeout: 5_000 });

    // The button is an <a href=/api/sessions/<sid>/transcript.md>. We
    // don't trigger the download (Playwright's download assertion is
    // flaky across CI environments); we assert the href points at the
    // right endpoint, which is the actual contract we care about.
    const href = await exportBtn.getAttribute('href');
    expect(href).toMatch(/\/api\/sessions\/[0-9a-f-]+\/transcript\.md$/);
    const downloadAttr = await exportBtn.getAttribute('download');
    expect(downloadAttr).toMatch(/^session-[0-9a-f]{8}\.md$/);
  });

  test('hitting the .md endpoint returns markdown with a download disposition', async ({ request }) => {
    // Pull a session id from the API rather than guessing.
    const r = await request.get('/api/sessions');
    expect(r.ok()).toBe(true);
    const body = await r.json();
    if (body.items.length === 0) test.skip();
    const sid = body.items[0].id;

    const md = await request.get(`/api/sessions/${sid}/transcript.md`);
    expect(md.ok()).toBe(true);
    expect(md.headers()['content-type']).toContain('text/markdown');
    expect(md.headers()['content-disposition']).toContain('attachment');
    expect(md.headers()['content-disposition']).toContain(`session-${sid.slice(0, 8)}.md`);
    const text = await md.text();
    expect(text).toMatch(/^# /);  // top-level H1 title
    expect(text).toContain(sid);   // metadata includes session id
  });
});
