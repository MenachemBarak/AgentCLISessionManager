import { test, expect } from '@playwright/test';

/**
 * Frontend integration for task #40 smart search.
 *
 * When the search input has 2+ words, the left pane fires off a
 * debounced GET /api/search and filters by the returned id set
 * instead of the local substring match. Single-word / empty queries
 * keep the zero-latency local filter.
 *
 * This test intercepts the network to prove the endpoint is actually
 * called — assumption-free verification.
 */
test.describe('smart search — frontend wiring (#40)', () => {
  test('multi-word query triggers GET /api/search', async ({ page }) => {
    const searchCalls: string[] = [];
    await page.route('**/api/search*', async (route) => {
      searchCalls.push(route.request().url());
      // Respond with an empty-match body so the test doesn't depend on
      // fixture content. Match the real endpoint's shape.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ query: 'probe', total: 0, items: [] }),
      });
    });

    await page.goto('/');
    const input = page.getByTestId('session-search-input');
    await expect(input).toBeVisible({ timeout: 10_000 });

    // Single-word query — must NOT call /api/search.
    await input.fill('single');
    await page.waitForTimeout(500);  // past the debounce window
    expect(searchCalls.length, 'single-token query must use local filter, not /api/search').toBe(0);

    // Multi-word query — MUST call /api/search after debounce.
    await input.fill('two words here');
    await expect.poll(() => searchCalls.length, { timeout: 3_000 }).toBeGreaterThanOrEqual(1);

    // URL encodes the query correctly.
    const lastUrl = searchCalls[searchCalls.length - 1];
    expect(lastUrl).toContain('/api/search');
    expect(lastUrl).toMatch(/q=two.*words.*here/i);
    expect(lastUrl).toContain('limit=100');
  });

  test('clearing multi-word query reverts to local filter', async ({ page }) => {
    let searchHits = 0;
    await page.route('**/api/search*', async (route) => {
      searchHits += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ query: '', total: 0, items: [] }),
      });
    });

    await page.goto('/');
    const input = page.getByTestId('session-search-input');
    await expect(input).toBeVisible({ timeout: 10_000 });

    // Fire multi-word → API called.
    await input.fill('multi word query');
    await expect.poll(() => searchHits, { timeout: 3_000 }).toBeGreaterThanOrEqual(1);
    const after = searchHits;

    // Clear the field. No further API calls should fire.
    await input.fill('');
    await page.waitForTimeout(500);
    expect(searchHits, 'clearing the query must not fire /api/search').toBe(after);
  });
});
