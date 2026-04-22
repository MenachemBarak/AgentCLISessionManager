import type { Page, Locator } from '@playwright/test';

/**
 * SessionList — the compact left-pane list of Claude Code sessions.
 * Rows carry `data-testid="session-row-<id>"` and provider chips are
 * inside each row. Actions here are scoped to one row at a time so the
 * feature tests read like user flows.
 */
export class SessionList {
  constructor(private readonly page: Page) {}

  async waitReady(): Promise<void> {
    // The list fetches /api/sessions on mount. We wait for either a row
    // to appear or the empty-state text to settle before probing further.
    await this.page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid^="session-row-"]').length > 0 ||
        !!document.querySelector('[data-testid="session-empty-state"]'),
      null,
      { timeout: 10_000 },
    );
  }

  rows(): Locator {
    return this.page.locator('[data-testid^="session-row-"]');
  }

  async count(): Promise<number> {
    return await this.rows().count();
  }

  rowById(sessionId: string): Locator {
    return this.page.locator(`[data-testid="session-row-${sessionId}"]`);
  }

  async clickFirst(): Promise<void> {
    await this.rows().first().click();
  }

  /**
   * Click the "In viewer" button inside a specific row. This opens a
   * new terminal tab that resumes the session via the provider adapter
   * (so we can verify wiring end-to-end rather than just rendering).
   */
  async clickInViewerForRow(rowLocator: Locator): Promise<void> {
    await rowLocator.getByRole('button', { name: /In viewer/i }).click();
  }
}
