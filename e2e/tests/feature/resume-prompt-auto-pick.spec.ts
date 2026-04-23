import { test, expect } from '@playwright/test';

/**
 * v0.9.10 — when Claude Code's `--resume` prompts with
 *   1. Resume from summary (recommended)
 *   2. Resume full session as-is
 *   3. Don't ask me again
 * the viewer auto-picks option 2 for each resumable session tab,
 * once per boot.
 *
 * We can't easily inject a fake PTY output stream from Playwright
 * without running a real claude binary, so this test pins the
 * CONTRACT in the source code — any refactor that drops the marker
 * or the keypress will fail here at PR time.
 */

test('terminal-pane auto-picks "Resume full session as-is" (v0.9.10)', async ({ request }) => {
  const r = await request.get('/terminal-pane.jsx');
  expect(r.status()).toBe(200);
  const src = await r.text();

  // The distinctive marker string we scan output for.
  expect(src, 'RESUME_PROMPT_MARKER must match option 2\'s label exactly')
    .toContain("'Resume full session as-is'");

  // The keystroke we send — down-arrow CSI then CR. Any change here
  // breaks the auto-pick flow.
  expect(src, 'RESUME_PROMPT_PICK_FULL must be ESC [B \\r (down + enter)')
    .toContain("'\\x1b[B\\r'");

  // Dedupe tracker exists so one pane doesn't answer the prompt twice.
  expect(src).toContain('_resumePromptHandled');

  // Guard check is present on the 'output' handler — search for the
  // .includes(RESUME_PROMPT_MARKER) call that drives the send.
  expect(src).toMatch(/data\.includes\(RESUME_PROMPT_MARKER\)/);
});
