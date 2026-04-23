import { test, expect } from '@playwright/test';
import { seedResumableTab, seedEmptyLayout } from '../../helpers/layout-seed';

/**
 * v1.1.0 PROD BUG REPRODUCTION — legacy persisted tabs fail to resume.
 *
 * User reported: downloaded v1.1.0 and their persisted session tabs all
 * showed "session exited" immediately. The sessions did not auto-resume.
 *
 * Root cause: v1.1.0 introduced shell-wrap (ADR-16) — the `openInViewer`
 * path now emits `{cmd:['cmd.exe'], cwd, _autoResume:{sessionId,provider}}`.
 * But a user upgrading from v0.9.x / v1.0.x carries forward a persisted
 * layout whose panes still have the LEGACY shape
 * `{provider:'claude-code', sessionId}`. When rehydrated, the legacy
 * shape routes through backend `_resolve_pty_command` →
 * `ClaudeCodeProvider.resume_command()` → argv[0]=`claude`. In the
 * PyInstaller frozen exe the inherited PATH does NOT include where the
 * user's `claude.exe` lives — pywinpty's spawn fails with
 * "file not found", the PTY dies instantly, tab shows "session exited".
 *
 * Fix: rehydration must migrate any legacy-shape pane to the shell-wrap
 * shape in-place before spawning, and re-persist so future boots start
 * from the new shape.
 *
 * This test FAILS on v1.1.0 HEAD (reproduces the bug) and PASSES after
 * the fix lands.
 */
test.describe.configure({ mode: 'serial' });

const LEGACY_SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test.describe('legacy layout migration (v1.1.0 upgrade path)', () => {
  test.beforeEach(async ({ request }) => {
    await seedEmptyLayout(request);
  });

  test('legacy {provider,sessionId} pane is migrated to shell-wrap shape on rehydrate', async ({ page, request }) => {
    // ARRANGE — seed a layout with the LEGACY shape. This is the state an
    // upgrading user arrives in.
    await seedResumableTab(request, LEGACY_SID, `cc-${LEGACY_SID.slice(0, 8)}`);

    // Intercept the WS spawn frame — that's the moment of truth. If
    // rehydration correctly migrates, the frame carries cmd=['cmd.exe']
    // + _autoResume. If it doesn't, the frame carries provider+sessionId
    // and claude is argv[0] (which fails in the frozen exe).
    const spawnFrames: Array<Record<string, unknown>> = [];
    page.on('websocket', (ws) => {
      if (!ws.url().includes('/api/pty/ws')) return;
      ws.on('framesent', (f) => {
        try {
          const msg = JSON.parse(String(f.payload || ''));
          if (msg && msg.type === 'spawn') spawnFrames.push(msg);
        } catch { /* ignore non-JSON */ }
      });
    });

    // ACT — load the page; rehydration kicks off automatically.
    await page.goto('/');
    await expect(page.getByTestId('right-tab-transcript')).toBeVisible({ timeout: 10_000 });

    // Wait until we've observed at least one spawn frame (the rehydrated tab).
    await expect.poll(() => spawnFrames.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

    const first = spawnFrames[0];

    // ASSERT — post-fix invariants (these FAIL on current buggy code):
    expect(first.cmd, 'rehydrated spawn MUST carry cmd=["cmd.exe"] shell-wrap — got legacy shape').toEqual(['cmd.exe']);
    expect(first._autoResume, 'rehydrated spawn MUST carry _autoResume hint').toBeTruthy();
    const auto = first._autoResume as { sessionId?: string; provider?: string };
    expect(auto.sessionId).toBe(LEGACY_SID);
    expect(auto.provider).toBe('claude-code');

    // And the legacy fields must NOT be present — if they are, the
    // backend's _resolve_pty_command still routes through the provider
    // branch and argv[0]=claude, which is exactly what dies in the exe.
    expect(first.provider, 'legacy `provider` field must be stripped after migration').toBeUndefined();
    expect(first.sessionId, 'legacy top-level `sessionId` field must be stripped after migration').toBeUndefined();
  });

  test('migrated layout is re-persisted so subsequent boots start clean', async ({ page, request }) => {
    await seedResumableTab(request, LEGACY_SID, `cc-${LEGACY_SID.slice(0, 8)}`);

    await page.goto('/');
    await expect(page.getByTestId('right-tab-transcript')).toBeVisible({ timeout: 10_000 });

    // Give the debounced PUT /api/layout-state time to fire (400ms debounce
    // in app.jsx::RightPane).
    await page.waitForTimeout(1200);

    const r = await request.get('/api/layout-state');
    expect(r.ok()).toBe(true);
    const state = await r.json();
    expect(Array.isArray(state.terminals)).toBe(true);
    expect(state.terminals.length).toBeGreaterThanOrEqual(1);

    // Walk the persisted tree; every session-bound pane must now carry
    // the shell-wrap shape, not the legacy one.
    const visit = (node: Record<string, unknown>): void => {
      if (!node) return;
      if (node.kind === 'pane' || (!node.kind && node.spawn)) {
        const s = node.spawn as Record<string, unknown> | undefined;
        if (!s) return;
        // If there was a sessionId (either shape), the migrated version
        // must be shell-wrap.
        const legacyHadSid = typeof s.sessionId === 'string' || (s._autoResume as { sessionId?: string } | undefined)?.sessionId;
        if (legacyHadSid) {
          expect(s.cmd, 'persisted session pane must carry cmd=["cmd.exe"]').toEqual(['cmd.exe']);
          expect(s._autoResume, 'persisted session pane must carry _autoResume').toBeTruthy();
          expect(s.provider, 'persisted session pane must NOT carry legacy top-level provider').toBeUndefined();
          expect(s.sessionId, 'persisted session pane must NOT carry legacy top-level sessionId').toBeUndefined();
        }
      }
      if (node.kind === 'split' && Array.isArray(node.children)) {
        for (const c of node.children as Array<Record<string, unknown>>) visit(c);
      }
    };
    for (const tab of state.terminals as Array<{ tree: Record<string, unknown> }>) visit(tab.tree);
  });
});
