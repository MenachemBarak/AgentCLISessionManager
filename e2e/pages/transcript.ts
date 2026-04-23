import type { Page, Locator } from '@playwright/test';

/**
 * Transcript — the right-pane `data-testid="transcript-pane"` div. Shows
 * message history for the selected session. We don't inspect individual
 * message text (copy is volatile) — we assert presence + visibility only.
 */
export class Transcript {
  constructor(private readonly page: Page) {}

  root(): Locator {
    return this.page.getByTestId('transcript-pane');
  }

  async isVisible(): Promise<boolean> {
    // Can be hidden via display:none when the user has a terminal tab
    // active — a rendered pane is proof enough for selection tests.
    return await this.root().isVisible();
  }

  /** The `Transcript` tab in the right-pane tab bar. Clicking it brings
   *  the transcript back into view after the user switched to a terminal. */
  async activate(): Promise<void> {
    await this.page.getByTestId('right-tab-transcript').click();
  }
}
