import type { Page } from '@playwright/test';

/**
 * Tweaks — the theme/accent/density drawer. Toggled from a button in
 * the WindowChrome title bar (testid `tweaks-button`).
 *
 * The drawer's internals live in a separate Edit Mode iframe in dev
 * builds, but the toggle side-effect (button responds to click, state
 * persists to localStorage) is still worth verifying.
 */
export class Tweaks {
  constructor(private readonly page: Page) {}

  async toggle(): Promise<void> {
    await this.page.getByTestId('tweaks-button').click();
  }

  async isAvailable(): Promise<boolean> {
    return (await this.page.getByTestId('tweaks-button').count()) > 0;
  }

  /** Read the persisted tweaks blob from localStorage. Frontend writes
   *  here on every change; a reload rehydrates from the same key. */
  async readPersisted(): Promise<Record<string, unknown> | null> {
    return await this.page.evaluate(() => {
      try {
        const raw = localStorage.getItem('cm_tweaks');
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    });
  }
}
