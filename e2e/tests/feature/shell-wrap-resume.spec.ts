import { test, expect } from '@playwright/test';

/**
 * v1.1.0 (#47) — session tabs spawn a shell then type
 * `claude --resume <sid>` into it. This replaces the v1.0.x model
 * where claude was argv[0], which caused `/exit` to kill the tab.
 *
 * This is a source-level contract test — it pins the shape invariants
 * that the graceful-exit architecture depends on. A real end-to-end
 * test would need a mock PTY that echoes the shell+claude interaction,
 * which is substantial plumbing; the source contract here is
 * cross-checked against the keystroke-splitting.spec.ts invariants
 * from v1.0.1 so the two fixes can't drift.
 */

test('openInViewer spawns a shell, not `claude` directly (v1.1.0 shell-wrap)', async ({ request }) => {
  const r = await request.get('/app.jsx');
  const src = await r.text();

  // The openInViewer handler must NOT pass `provider/sessionId` at the
  // top level of spawn — that's the legacy shape where backend routed
  // through ClaudeCodeProvider.resume_command. New shape is shell + cwd
  // + `_autoResume` nested metadata.
  const openInViewerBlock = src.match(/window\.openInViewer\s*=[\s\S]*?};/);
  expect(openInViewerBlock, 'openInViewer handler must exist').not.toBeNull();
  const block = (openInViewerBlock as RegExpMatchArray)[0];

  expect(block, 'spawn must include cmd array (shell) as top-level field').toMatch(/cmd:\s*\[/);
  expect(block, 'spawn must carry _autoResume metadata with sessionId')
    .toMatch(/_autoResume:\s*\{[\s\S]*?sessionId/);
  // The old top-level `sessionId: session.id` as a SPAWN field is
  // forbidden — it means the shell-wrap was bypassed and claude will
  // be argv[0] again, losing /exit survivability. Inside _autoResume
  // is fine (and required); at top-level it is not.
  const spawnOpenIdx = block.indexOf('spawn:');
  const autoResumeIdx = block.indexOf('_autoResume');
  expect(spawnOpenIdx).toBeGreaterThanOrEqual(0);
  expect(autoResumeIdx).toBeGreaterThan(spawnOpenIdx);
  const topLevel = block.slice(spawnOpenIdx, autoResumeIdx);
  expect(topLevel, 'sessionId must live inside _autoResume, not at spawn top level')
    .not.toMatch(/\bsessionId:\s*session/);
});

test('terminal-pane types claude --resume into shell on ready (v1.1.0)', async ({ request }) => {
  const r = await request.get('/terminal-pane.jsx');
  const src = await r.text();

  // Auto-resume branch must exist in the ready handler.
  expect(src, 'must read spawn._autoResume.sessionId')
    .toMatch(/autoResume[\s\S]{0,200}\.sessionId/);

  // Must construct the claude command string including the resume flag.
  expect(src, 'auto-typed command must include claude --resume <sessionId>')
    .toMatch(/claude --dangerously-skip-permissions --resume/);

  // Must use typeIntoPty() (the chunked writer) NOT a single send call
  // with the whole command — that would be the same bracketed-paste
  // bug we fixed in v1.0.1.
  expect(src, 'must call typeIntoPty helper to chunk the command')
    .toMatch(/typeIntoPty\(/);

  // Dedupe tracker exists so a re-render / second ready for the same
  // PTY doesn't re-type the command.
  expect(src).toContain('_autoResumeTyped');
});

test('session-id detection accepts both legacy and v1.1.0 spawn shapes', async ({ request }) => {
  const r = await request.get('/app.jsx');
  const src = await r.text();

  // spawnSessionId() helper must prefer _autoResume.sessionId but fall
  // back to spawn.sessionId (so pre-v1.1.0 persisted layouts still
  // hydrate correctly).
  expect(src, 'spawnSessionId helper must prefer _autoResume.sessionId')
    .toMatch(/_autoResume\?\.\s*sessionId\s*\|\|\s*spawn\.sessionId/);
});
