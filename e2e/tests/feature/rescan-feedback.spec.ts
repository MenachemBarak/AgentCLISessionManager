import { test, expect } from '@playwright/test';

/**
 * Rescan button feedback (v1.2.16): clicking Rescan surfaces how
 * many stale active markers were cleaned. Follows v1.2.15's ghost-
 * marker PID-reuse fix — users need a visible confirmation that the
 * click actually did something, not just a silent reload.
 *
 * Source-level contract test: pins the wiring so the backend's
 * `staleActiveMarkersRemoved` field keeps flowing into the UI.
 */
test('rescan handler reads staleActiveMarkersRemoved and sets feedback', async ({ request }) => {
  const src = await request.get('/compact-list.jsx').then((r) => r.text());

  // Handler must read the count off the response body.
  expect(src, 'handleRescan must parse the response JSON')
    .toMatch(/r\.json\(\)\.catch/);
  expect(src, 'must read staleActiveMarkersRemoved from the response body')
    .toContain('staleActiveMarkersRemoved');

  // Both the "cleaned N stale" and "no ghosts" strings must be present
  // so the user gets distinct feedback for "worked" vs "nothing to do".
  expect(src).toContain('cleaned ');
  expect(src).toContain('no ghosts');

  // The feedback element is marked for test + manual debugging.
  expect(src).toMatch(/data-testid="rescan-feedback"/);
});
