import type { Page, Locator } from '@playwright/test';

/**
 * SessionList — the compact left-pane list. Every row carries
 * `data-testid="session-row-<sid8>"` (8-char prefix of the session UUID).
 * Action buttons inside a row auto-generate testids via IconBtn's
 * label-derived fallback, e.g. `rowbtn-in-viewer`, `rowbtn-focus`.
 */
export class SessionList {
  constructor(private readonly page: Page) {}

  async waitReady(): Promise<void> {
    // Session list populates after /api/sessions resolves. We accept any
    // of the list's structural pills as proof of ready.
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

  rowByShortId(shortId: string): Locator {
    return this.page.getByTestId(`session-row-${shortId}`);
  }

  async clickFirst(): Promise<void> {
    await this.rows().first().click();
  }

  /** Type into the search box. Returns the matching-row count after a
   *  short debounce so callers can assert the filter applied. */
  async searchFor(query: string): Promise<number> {
    const input = this.page.getByTestId('session-search-input');
    await input.fill(query);
    // Filter is synchronous in the current implementation, but wait a
    // tick to let React re-render.
    await this.page.waitForTimeout(150);
    return await this.count();
  }

  async clearSearch(): Promise<void> {
    const input = this.page.getByTestId('session-search-input');
    await input.fill('');
  }

  /** Hover a row and click its "In viewer" row-action button. */
  async clickInViewerForRow(rowLocator: Locator): Promise<void> {
    await rowLocator.hover();
    // Button is revealed via hover opacity; it's still present in DOM so
    // testid click works even without visual hover state, but hover
    // exercises the real user path.
    await rowLocator.getByTestId('rowbtn-in-viewer').click();
  }

  /** Click the rescan button. Returns the fresh session count reported
   *  by /api/sessions after the rescan completes. */
  async rescan(): Promise<number> {
    await this.page.getByTestId('rescan-btn').click();
    // Wait for any pending refetch to settle — allow up to 3s.
    await this.page.waitForTimeout(300);
    return await this.count();
  }
}
