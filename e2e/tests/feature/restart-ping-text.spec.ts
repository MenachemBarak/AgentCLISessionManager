import { test, expect } from '@playwright/test';

/**
 * Pins the exact restart-ping text introduced in v0.9.8. The ping is
 * load-bearing UX — it tells resumed agents what to do — so changes
 * to the text should be deliberate, reviewed, and broken by this
 * test until updated.
 *
 * We read the source of backend/frontend/terminal-pane.jsx directly
 * rather than trying to observe the ping being sent, because
 * observing requires a real PTY with a real `claude` binary and a
 * controlled prompt pattern that the pane would idle on.
 */
test('restart-ping text is the expanded directive (v0.9.8)', async ({ request }) => {
  const r = await request.get('/terminal-pane.jsx');
  expect(r.status()).toBe(200);
  const src = await r.text();

  // Required clauses — each one prevents a different failure mode of
  // an unattended resume. Missing any one weakens the directive in
  // a user-visible way.
  // The literal const in terminal-pane.jsx is split across several
  // string-concatenation lines for readability, so we match each
  // clause in isolation (never across the `+` boundary).
  const requiredClauses = [
    'SOFTWARE RESTARTED',
    'GO ON EXACTLY',
    'IF YOU WAS IDLE',
    'KEEP IDELING',  // user's exact spelling
    'IN TASK PROGRESS',
    'DO NOT TAKE INITIATIVE',
    'BACKGROUND TASKS',
    'CRON JOBS',
    'PRESERVED',
  ];

  for (const clause of requiredClauses) {
    expect(src, `restart-ping text missing required clause: ${clause}`).toContain(clause);
  }

  // Short-message regression guard — v0.9.7 and earlier used only
  // "GO ON FROM WHERE YOU LEFT OFF". A file containing ONLY that
  // (without the expanded clauses) means we regressed.
  const hasShortVersion = /GO ON FROM WHERE YOU LEFT OFF/.test(src);
  const hasExpandedVersion = /DO NOT TAKE INITIATIVE/.test(src);
  expect(
    hasExpandedVersion,
    'restart-ping appears to have regressed to the short v0.9.7 text',
  ).toBe(true);
  // The old phrase may appear in a comment, so we don't forbid it
  // outright — only assert the expanded version is present.
  if (hasShortVersion) {
    // This is tolerated only if it's inside a comment, not the active
    // RESTART_PING_TEXT constant. Check the constant line directly.
    const constLine = src.split('\n').find((l) => l.includes('const RESTART_PING_TEXT'));
    expect(constLine, 'const RESTART_PING_TEXT line is missing').toBeDefined();
  }
});
