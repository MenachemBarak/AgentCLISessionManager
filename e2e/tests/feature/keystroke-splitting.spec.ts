import { test, expect } from '@playwright/test';

/**
 * v1.0.1 — split keystrokes across separate WS frames so Ink-TUI's
 * bracketed-paste doesn't eat them.
 *
 * THE BUG (reproduced live in v1.0.0 on 23-04-2026):
 *   The restart-ping flow sent `SOFTWARE RESTARTED...\r` in one
 *   `send({type:'input', data: TEXT + '\r'})` call. Claude Code's
 *   TUI treated the entire block as a bracketed paste. The trailing
 *   `\r` was consumed as "confirm the current menu option" on the
 *   resume-choice menu — auto-picking "Compact summary" (option 1,
 *   default). User's session lost real working context.
 *   SEPARATELY, the ping text landed in the chat input as a literal
 *   paste and was NEVER SENT — because no Enter-to-submit keystroke
 *   was processed as a discrete key event.
 *
 * Same class of bug affected the `\x1b[B\r` resume-prompt auto-pick
 * from v0.9.10 — arrow-down was eaten, Enter confirmed the default.
 *
 * THE FIX:
 *   Split into TWO WS frames with a delay between. text → wait
 *   500ms → `\r`. arrow-down → wait 200ms → `\r`. The pause lets
 *   Ink close its bracketed-paste window so each frame is processed
 *   as an individual key event.
 *
 * THIS TEST pins the source-level contract: the single-send anti-
 * pattern must be ABSENT, and the split pattern (two nested
 * setTimeouts or two separate send calls inside the same branch)
 * must be PRESENT. Any refactor that re-concatenates will fail here.
 */

test('restart-ping splits text + Enter into separate WS frames (v1.0.1 regression guard)', async ({ request }) => {
  const r = await request.get('/terminal-pane.jsx');
  expect(r.status()).toBe(200);
  const src = await r.text();

  // 1. The ANTI-PATTERN must be absent — no send call that
  // concatenates RESTART_PING_TEXT with `\r` into a single data
  // payload. v1.0.0 had exactly this and caused the compact-on-
  // resume bug.
  expect(
    src,
    'restart-ping regressed: RESTART_PING_TEXT + \'\\r\' (or + \'\\n\') is concatenated. Must be split into separate send() calls with a timing gap.',
  ).not.toMatch(/data:\s*RESTART_PING_TEXT\s*\+\s*['"]\\[rn]['"]/);

  // 2. The CORRECT pattern must be present — the ping text is sent
  // alone, and Enter is sent separately. Both calls inside the
  // pending-check block.
  expect(src, 'restart-ping text send must pass RESTART_PING_TEXT alone (no concatenation)')
    .toMatch(/send\(\s*\{\s*type:\s*['"]input['"]\s*,\s*data:\s*RESTART_PING_TEXT\s*\}\s*\)/);
  expect(src, 'restart-ping must also have a separate Enter send')
    .toMatch(/send\(\s*\{\s*type:\s*['"]input['"]\s*,\s*data:\s*['"]\\r['"]\s*\}\s*\)/);
});

test('resume-prompt auto-pick uses one-keystroke digit pick (post-v1.2.14)', async ({ request }) => {
  const r = await request.get('/terminal-pane.jsx');
  const src = await r.text();

  // Regression guard: the concatenated arrow+enter payload must stay
  // absent. That was the v1.0.0 bug where Ink's bracketed-paste
  // detector ate the arrow and Enter picked option 1 (summary).
  expect(
    src,
    'auto-pick regressed: \\x1b[B\\r appears as one payload.',
  ).not.toMatch(/data:\s*['"]\\x1b\[B\\r['"]/);

  // Current approach (post-v1.2.14): one-keystroke digit pick `'2'`.
  // Ink's select component accepts a digit as an immediate pick; no
  // ESC sequence for the paste detector to swallow.
  expect(src, 'RESUME_PROMPT_PICK_FULL must be the digit "2"')
    .toMatch(/RESUME_PROMPT_PICK_FULL\s*=\s*'2'/);
});
