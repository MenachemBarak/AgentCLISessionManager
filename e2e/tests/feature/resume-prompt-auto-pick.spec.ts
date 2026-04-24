import { test, expect } from '@playwright/test';

/**
 * v0.9.10 — when Claude Code's `--resume` prompts with
 *   1. Resume from summary (recommended)
 *   2. Resume full session as-is
 *   3. Don't ask me again
 * the viewer auto-picks option 2 for each resumable session tab,
 * once per boot.
 *
 * Post-v1.2.14 — after repeated failures where Ink's bracketed-paste
 * detector swallowed the ESC [B arrow sequence (users saw summary
 * compaction instead of resume), the pick keystroke is now simply
 * `'2'`: Ink's select component accepts a digit as a one-keystroke
 * pick. No ESC, no Enter, nothing for the paste detector to eat.
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

  // The keystroke we send — digit '2'. Any change here breaks the
  // auto-pick flow. Kept explicit here so a regression to ESC+arrow
  // would fail loudly at PR time rather than in a production surprise.
  expect(src, 'RESUME_PROMPT_PICK_FULL must be the digit "2"')
    .toMatch(/RESUME_PROMPT_PICK_FULL\s*=\s*'2'/);

  // Dedupe tracker exists so one pane doesn't answer the prompt twice.
  expect(src).toContain('_resumePromptHandled');

  // Guard check is present on the 'output' handler — search for the
  // .includes(RESUME_PROMPT_MARKER) call that drives the send.
  expect(src).toMatch(/data\.includes\(RESUME_PROMPT_MARKER\)/);

  // sid extraction accepts both legacy (spawn.sessionId) and v1.1.0
  // shell-wrap (spawn._autoResume.sessionId) shapes — otherwise the
  // auto-pick never fires for shell-wrap tabs.
  expect(src).toMatch(/_autoResume\?\.sessionId\s*\|\|\s*spawn\?\.sessionId/);
});
