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

  test('clicking the button does not crash the app', async ({ page }) => {
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

  test('Segmented buttons render inside the drawer + selection changes persist', async ({ page }) => {
    await page.goto('/');
    const tw = new Tweaks(page);
    await tw.toggle();
    await page.waitForTimeout(300);

    // Drawer mounts with at least one Segmented group (Theme / Density /
    // Hover preview / Live activity — four groups in total).
    const groupCount = await page.getByTestId('segmented-group').count();
    expect(groupCount, 'tweaks drawer should render ≥1 Segmented group').toBeGreaterThan(0);

    // Picking a theme option updates cm_tweaks.theme — round-trip
    // proof that Segmented → onChange → setTweaks → localStorage works.
    const before = await tw.readPersisted();
    const beforeTheme = (before as Record<string, unknown> | null)?.theme;
    const target = beforeTheme === 'warm' ? 'dark' : 'warm';
    await page.getByTestId(`segmented-option-${target}`).first().click();
    await page.waitForTimeout(200);
    const after = await tw.readPersisted();
    expect((after as Record<string, unknown> | null)?.theme).toBe(target);
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
