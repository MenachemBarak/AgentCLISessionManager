import type { Page, Locator } from '@playwright/test';

/**
 * UpdateBanner — the amber strip under the title bar that appears when
 * /api/update-status reports a newer release. Covers the full
 * check→download→stage→apply state machine.
 *
 * The banner only renders in three states: `updateAvailable && !staged`,
 * `updateAvailable && staged`, or `downloadProgress > 0`. In any other
 * state it unmounts, so `isVisible()` is the primary gate.
 */
export class UpdateBanner {
  constructor(private readonly page: Page) {}

  root(): Locator {
    return this.page.getByTestId('update-banner');
  }

  async isVisible(): Promise<boolean> {
    return (await this.root().count()) > 0 && await this.root().isVisible();
  }

  /** Seed the backend into "newer version available" state (CSV_TEST_MODE=1 only). */
  async seedUpdateAvailable(latestVersion: string, opts: { staged?: boolean } = {}): Promise<void> {
    const resp = await this.page.request.post('/api/_test/seed-update-state', {
      data: { latestVersion, checked: true, staged: opts.staged ?? false },
    });
    if (!resp.ok()) {
      throw new Error(`seed failed (${resp.status()}): ${await resp.text()}. Is CSV_TEST_MODE=1 set?`);
    }
    // Nudge the banner's 5-min poll by forcing a refresh via a direct fetch
    // in the page context — the next render cycle picks up the new state.
    await this.page.evaluate(async () => {
      await fetch('/api/update-status');
    });
  }

  /**
   * Read the snapshot the banner is driven by. Useful for asserting the
   * shape contract that both the banner and any future automation depend on.
   */
  async snapshot(): Promise<{ currentVersion: string; latestVersion: string | null; updateAvailable: boolean; staged: boolean; checked: boolean }> {
    const r = await this.page.request.get('/api/update-status');
    return await r.json();
  }

  /** Click the Download button. Does not wait for download to finish. */
  async clickDownload(): Promise<void> {
    await this.page.getByRole('button', { name: /^Download$/ }).click();
  }

  /**
   * Click "Restart & apply". Only exposed when a .new is staged. We do
   * NOT auto-accept the confirm dialog here — the test must handle it
   * via `page.on('dialog', d => d.accept())` so the intent is explicit.
   */
  async clickRestartApply(): Promise<void> {
    await this.page.getByRole('button', { name: /Restart.*apply/i }).click();
  }
}
