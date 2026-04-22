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
    // The list fetches /api/sessions on mount. We wait for either a
    // session row or the list status pill (FOLDERS count / ACTIVE count)
    // to settle — both are rendered once the fetch resolves. A raw row
    // check alone would hang in environments with zero sessions.
    await this.page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid^="session-row-"]').length > 0 ||
        /FOLDERS|ACTIVE|no sessions/i.test(document.body.innerText),
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
