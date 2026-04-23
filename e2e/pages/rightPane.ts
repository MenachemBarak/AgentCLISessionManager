import type { Page, Locator } from '@playwright/test';

/**
 * RightPane — the tab bar + body holding Transcript and a dynamic list
 * of terminal tabs. Covers tab creation, close, split operations, and
 * the pane-focus keyboard shortcuts.
 */
export class RightPane {
  constructor(private readonly page: Page) {}

  async openNewTerminal(): Promise<void> {
    await this.page.getByTestId('right-tab-new-terminal').click();
  }

  tabs(): Locator {
    return this.page.locator('[data-testid^="right-tab-"]').filter({
      hasNotText: /^Transcript$/,
    });
  }

  async tabCount(): Promise<number> {
    // Count all `right-tab-<id>` buttons (excluding the fixed "transcript"
    // and the "new" + close buttons which share the prefix).
    return await this.page.evaluate(() => {
      const nodes = document.querySelectorAll('[data-testid^="right-tab-"]');
      let n = 0;
      for (const el of nodes) {
        const tid = el.getAttribute('data-testid') || '';
        // Terminal tab testids are `right-tab-term-N`.
        if (/^right-tab-term-\d+$/.test(tid)) n += 1;
      }
      return n;
    });
  }

  async closeTab(termId: string): Promise<void> {
    // Close button is `right-tab-close-<termid>`.
    await this.page.getByTestId(`right-tab-close-${termId}`).click();
  }

  async splitActivePaneHorizontal(): Promise<void> {
    await this.page.getByTestId('split-h-btn').click();
  }

  async splitActivePaneVertical(): Promise<void> {
    await this.page.getByTestId('split-v-btn').click();
  }

  async closeActivePane(): Promise<void> {
    await this.page.getByTestId('close-pane-btn').click();
  }

  /** Returns the number of tile-panes currently mounted in the active tab. */
  async paneCount(): Promise<number> {
    return await this.page.locator('[data-testid^="tile-pane-"]').count();
  }
}
