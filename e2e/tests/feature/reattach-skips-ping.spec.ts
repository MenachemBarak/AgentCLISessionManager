import { test, expect } from '@playwright/test';

/**
 * v1.3.3 — when the daemon keeps a PTY alive across a UI restart, the
 * backend sends {type: "ready", reattached: true}. The terminal pane
 * must NOT type `--resume` into the live PTY (would nest a second
 * claude inside the running one) and must NOT send the "SOFTWARE
 * RESTARTED" ping (Claude was never interrupted).
 *
 * We can't drive a real PTY WebSocket from Playwright without a live
 * daemon, so this pins the CONTRACT in the source code — a refactor
 * that drops the guard will fail here at PR time before it reaches
 * production.
 */

test('terminal-pane skips auto-resume and restart-ping when reattached', async ({ request }) => {
  const r = await request.get('/terminal-pane.jsx');
  expect(r.status()).toBe(200);
  const src = await r.text();

  // The guard must check msg.reattached and break before any side-effects.
  // We look for the pattern: `if (msg.reattached) break` (whitespace-tolerant).
  expect(src, 'ready handler must break early when msg.reattached is true')
    .toMatch(/if\s*\(\s*msg\.reattached\s*\)\s*break/);

  // The guard must appear BEFORE the auto-resume block (which references
  // _autoResume.sessionId) so the reattach path never reaches it.
  const guardIdx = src.search(/if\s*\(\s*msg\.reattached\s*\)\s*break/);
  const resumeIdx = src.search(/_autoResume\?\.sessionId/);
  expect(guardIdx, 'reattach guard must appear before _autoResume block')
    .toBeLessThan(resumeIdx);

  // The guard must also appear before the restart-ping block. The ping
  // fires via _restartPingPending.has(sid) — search for that call so we
  // skip the global initialisation line that also mentions the set name.
  const pingIdx = src.search(/_restartPingPending\.has\(/);
  expect(guardIdx, 'reattach guard must appear before _restartPingPending.has() call')
    .toBeLessThan(pingIdx);
});
