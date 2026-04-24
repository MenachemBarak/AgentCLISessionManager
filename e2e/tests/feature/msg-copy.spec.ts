import { test, expect } from '@playwright/test';
import { seedEmptyLayout } from '../../helpers/layout-seed';

/**
 * Hover-to-copy message content. Each transcript message shows a
 * small "copy" button on hover; click → writes the message's content
 * to the clipboard; button flashes "✓ copied" for 1.2s.
 */
// Root cause of historical flake: prior tests in the same worker
// leave terminal tabs active in the persisted layout, which forces
// activeId away from 'transcript' on reload. Retries still help
// against rendering jitter on slow CI runners.
test.describe.configure({ retries: 2 });

test.beforeEach(async ({ request }) => {
  // Force a known-clean layout so the Transcript tab is the default
  // active pane when `/` loads. This replaces the #85 workaround
  // (post-hoc click on right-tab-transcript) with upfront isolation.
  await seedEmptyLayout(request);
});

test('hover a transcript message → copy button writes content to clipboard', async ({ page, context, request }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto('/');
  await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

  // Open the first session; wait for the first message row to render.
  const firstRow = page.locator('[data-testid^="session-row-"]').first();
  await firstRow.waitFor({ state: 'visible' });
  await firstRow.click();

  // Defensive: if anything above leaves activeId on a terminal tab,
  // explicitly switch to Transcript. With seedEmptyLayout this is a
  // no-op, but it keeps the assertion robust.
  await page.getByTestId('right-tab-transcript').click();

  const firstMsg = page.locator('[data-msg-index="0"]');
  await firstMsg.waitFor({ state: 'visible', timeout: 5_000 });

  // The canonical content we expect in the clipboard — read from the API
  // rather than DOM innerText so we don't fight role/timestamp chrome.
  const rSess = await request.get('/api/sessions');
  const sid = (await rSess.json()).items[0]?.id;
  if (!sid) test.skip();
  const rTx = await request.get(`/api/sessions/${sid}/transcript`);
  const expected = ((await rTx.json()).messages?.[0]?.content ?? '') as string;

  // Hover to reveal the copy button.
  await firstMsg.hover();
  const btn = page.getByTestId('msg-copy-0');
  await expect(btn).toBeVisible({ timeout: 2_000 });
  await btn.click();

  // Clipboard received the full message content.
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  expect(clip).toBe(expected);

  // Feedback swap.
  await expect(btn).toContainText('copied');
});
