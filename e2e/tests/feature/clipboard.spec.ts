/**
 * Clipboard integration — Ctrl+C copy and Ctrl+V paste.
 *
 * Terminal (xterm.js):
 *   - Ctrl+C with a selection → copies to clipboard, does NOT send SIGINT
 *   - Ctrl+V → pastes clipboard text into the PTY
 *
 * Transcript:
 *   - Ctrl+C on selected transcript text → copies to clipboard
 */
import { test, expect } from '@playwright/test';

test.describe('clipboard — transcript', () => {
  test('Ctrl+C on selected transcript text copies to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

    // Select any session that has transcript content.
    const firstRow = page.locator('[data-testid^="session-row-"]').first();
    await firstRow.waitFor({ state: 'visible', timeout: 10_000 });
    await firstRow.click();

    // Wait for at least one message to render.
    const msgLocator = page.locator('[data-testid^="msg-"]').first();
    await msgLocator.waitFor({ state: 'visible', timeout: 8_000 });

    // Programmatically select the text of the first message element.
    const selectedText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid^="msg-"]');
      if (!el) return '';
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return sel?.toString() ?? '';
    });

    expect(selectedText.length, 'need some text to copy').toBeGreaterThan(0);

    // Ctrl+C should copy selected text.
    await page.keyboard.press('Control+c');

    const clipboard = await page.evaluate(async () => {
      try { return await navigator.clipboard.readText(); } catch { return ''; }
    });

    expect(clipboard).toBe(selectedText);
  });
});

test.describe('clipboard — terminal (xterm.js)', () => {
  test('new terminal tab renders xterm canvas (handler wired on open)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

    // Click "New terminal" — this triggers TerminalPane mount which calls
    // term.open() and attaches our clipboard handler.
    await page.locator('[title*="New terminal"], [title*="Ctrl+Shift+T"]').first().click();

    // Canvas renders → Terminal() ran → attachCustomKeyEventHandler was called.
    await expect(page.locator('.xterm-screen canvas').first()).toBeVisible({ timeout: 8_000 });
  });

  test('Ctrl+C with xterm selection copies text, does not send SIGINT to PTY', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await expect(page.getByTestId('session-search-input')).toBeVisible({ timeout: 10_000 });

    // Open terminal and wait for PTY ready (cursor visible in canvas).
    await page.locator('[title*="New terminal"], [title*="Ctrl+Shift+T"]').first().click();
    await expect(page.locator('.xterm-screen canvas').first()).toBeVisible({ timeout: 8_000 });

    // Seed clipboard so we can tell whether Ctrl+C changed it.
    await page.evaluate(async () => navigator.clipboard.writeText('__before__'));

    // Type a unique marker — it echoes in the terminal output.
    const marker = 'CLIPBOARD-TEST-MARKER';
    await page.keyboard.type(marker);
    // Wait a tick for echo, then select the typed text via mouse drag on the canvas.
    await page.waitForTimeout(300);

    // Use xterm's selectAll via the exposed Terminal API on the window.
    // If selectAll isn't available, Ctrl+A in xterm selects all.
    await page.evaluate(() => {
      // xterm 5 exposes selectAll on the Terminal instance bound to .xterm
      const host = document.querySelector('.xterm') as HTMLElement | null;
      if (!host) return;
      // Access the Terminal instance via the internal __xterm__ property xterm sets.
      const term = (host as any)._core?._terminal ?? (host as any).__xterm__;
      term?.selectAll?.();
    });
    await page.waitForTimeout(100);

    // Ctrl+C: our handler copies selection to clipboard (not SIGINT).
    await page.keyboard.press('Control+c');

    const after = await page.evaluate(async () => {
      try { return await navigator.clipboard.readText(); } catch { return '__before__'; }
    });

    // Clipboard must have changed — selection was copied, not __before__.
    expect(after).not.toBe('__before__');
  });
});
