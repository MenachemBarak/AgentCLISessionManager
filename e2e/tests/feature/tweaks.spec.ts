import { test, expect } from '@playwright/test';
import { Tweaks } from '../../pages/tweaks';
import { seedEmptyLayout } from '../../helpers/layout-seed';

test.describe('tweaks drawer', () => {
  test.beforeEach(async ({ request }) => {
    // Isolate: other test files may leave corrupt or populated layouts.
    await seedEmptyLayout(request);
  });

  test('tweaks button is reachable by testid', async ({ page }) => {
    await page.goto('/');
    const tw = new Tweaks(page);
    await expect.poll(() => tw.isAvailable(), { timeout: 5_000 }).toBe(true);
  });

  // Known bug: TweaksPanel references `<Segmented>` which isn't defined
  // anywhere and isn't registered on `window`. Clicking the button
  // triggers a ReferenceError inside React's render, which React
  // recovers from but logs as a pageerror. Un-fixme when task #43 lands.
  test.fixme('clicking the button does not crash the app', async ({ page }) => {
    await page.goto('/');
    const tw = new Tweaks(page);

    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));

    // Let the page settle before interacting (initial render + layout fetch).
    await page.waitForTimeout(500);

    await tw.toggle();
    await page.waitForTimeout(300);

    // The softest proof that "nothing crashed": no uncaught errors during
    // or after the toggle, and the Tweaks button is still clickable (i.e.
    // the WindowChrome still exists). A TweaksPanel overlay may or may
    // not render depending on how the tweaks feature flag is wired in
    // this build.
    expect(pageErrors, `tweaks toggle produced page errors:\n${pageErrors.map((e) => e.stack).join('\n')}`).toHaveLength(0);
    await expect(page.getByTestId('tweaks-button')).toBeVisible();
  });

  test('tweaks persist to localStorage under cm_tweaks', async ({ page }) => {
    await page.goto('/');
    const tw = new Tweaks(page);
    // The component writes cm_tweaks on every tweaks change. The initial
    // render seeds it from DEFAULT_TWEAKS, so the key should exist after
    // a tick.
    await expect.poll(async () => (await tw.readPersisted()) !== null, { timeout: 5_000 }).toBe(true);
    const persisted = await tw.readPersisted();
    // Shape contract — these keys exist in DEFAULT_TWEAKS.
    expect(persisted).toMatchObject({
      theme: expect.any(String),
      accent: expect.any(String),
      density: expect.any(String),
      hoverMode: expect.any(String),
      liveOn: expect.any(Boolean),
    });
  });
});
