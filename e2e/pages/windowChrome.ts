import type { Page, Locator } from '@playwright/test';

/**
 * WindowChrome — the top title bar (app name, version label, active/total
 * counters, Tweaks button). Exposes read-only actions plus the Tweaks
 * toggle since that's the only interactive element in the chrome itself.
 */
export class WindowChrome {
  constructor(private readonly page: Page) {}

  /** The top bar locator — used by other actions to scope queries. */
  titleBar(): Locator {
    return this.page.locator('div').filter({ hasText: /^Session Manager/ }).first();
  }

  /**
   * Read the version label rendered next to "Session Manager". Returns
   * the string (e.g. "v0.9.1") or null if not rendered yet — useful as
   * a signal the frontend has finished its first `/api/status` fetch.
   */
  async readVersion(): Promise<string | null> {
    // The version span is the immediate sibling after the app name.
    // We match by regex so we tolerate leading "v".
    const loc = this.page.getByText(/^v\d+\.\d+\.\d+$/).first();
    if (await loc.count() === 0) return null;
    return (await loc.textContent())?.trim() ?? null;
  }

  /** Open the Tweaks drawer (accent colour, density, etc). */
  async openTweaks(): Promise<void> {
    await this.page.getByRole('button', { name: /Tweaks/i }).click();
  }
}
