import { test, expect } from '@playwright/test';

/**
 * Active sessions that weren't started via AgentManager (e.g. a claude
 * running in a raw PowerShell window) should expose an "Open in manager"
 * action from the left-pane list, so users can adopt them into the
 * embedded terminal UI. Once a session IS managed (has a tab), the
 * button must disappear — otherwise clicking it again would spawn a
 * second tab for the same sid.
 *
 * Can't easily seed "an active-but-unmanaged session" from Playwright
 * (the backend's activity detection reads real processes), so we pin
 * the contract at the source level: the button exists and is gated on
 * `!managed`, which is derived from the shared session-id store
 * published by RightPane.
 */
test('Open-in-manager button is wired on active rows (post-v1.2.14)', async ({ request }) => {
  const clSrc = await request.get('/compact-list.jsx').then((r) => r.text());
  const appSrc = await request.get('/app.jsx').then((r) => r.text());

  // The button label + its !managed gate must be present in CompactRow.
  expect(clSrc, 'Open in manager button must exist in CompactRow')
    .toMatch(/label="Open in manager"/);
  expect(clSrc, 'button must be gated on `!managed`')
    .toMatch(/!managed\s*&&\s*\(/);

  // `managed` must be derived from the shared session-id store, not
  // from a stale snapshot or a hard-coded check.
  expect(clSrc)
    .toMatch(/window\.useManagedSessionIds/);
  expect(clSrc)
    .toMatch(/managedIds\.has\(session\.id\)/);

  // RightPane must publish the set whenever terminals change — without
  // that the store stays empty and every active session would show the
  // button even when it's already managed.
  expect(appSrc)
    .toMatch(/window\._managedSessionsStore\.set\(collectSessionIds\(terminals\)\)/);
});
