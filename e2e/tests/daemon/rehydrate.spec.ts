/**
 * Daemon Phases 4-5 contract — ring buffer, rehydrate-on-reconnect, UI
 * restart survivability, multi-UI, daemon-side layout state.
 * Part of ADR-18 / Task #42. Red against v1.1.0 by design.
 */
import { test, expect } from '@playwright/test';
import { daemonGet, daemonPost } from '../../helpers/daemon-probe';

test.describe.configure({ mode: 'serial' });

test.describe('PTY survives UI restart (ADR-18 §Ring buffer & rehydrate)', () => {
  test('ring buffer replay on WS reconnect (Phase 4)', async ({ page }) => {
    await page.goto('/');
    // Open a terminal, write a unique marker, close the tab, reopen — the
    // marker must be present in the replayed scrollback.
    const marker = `REHYDRATE-${Date.now()}`;
    // APIs below are Phase 4 additions: /api/pty/{id}/write, /api/pty/{id}/replay
    const create = await daemonPost('/api/pty', { cmd: ['cmd.exe'] });
    expect(create.status).toBe(200);
    const { id } = await create.json();
    await daemonPost(`/api/pty/${id}/write`, { data: `echo ${marker}\r` });
    await page.waitForTimeout(500);
    const replay = await daemonGet(`/api/pty/${id}/replay`);
    expect(replay.status).toBe(200);
    const body = await replay.text();
    expect(body, 'ring buffer must retain the marker for replay').toContain(marker);
  });

  test('ring buffer caps at 256 KB (no OOM on large producer) (Phase 4)', async () => {
    const create = await daemonPost('/api/pty', { cmd: ['cmd.exe'] });
    const { id } = await create.json();
    // Fire ~1 MB of output, then assert replay is bounded.
    for (let i = 0; i < 200; i += 1) {
      await daemonPost(`/api/pty/${id}/write`, {
        data: 'A'.repeat(5000) + '\r',
      });
    }
    const replay = await daemonGet(`/api/pty/${id}/replay`);
    const body = await replay.text();
    expect(
      body.length,
      'ring buffer must cap at ~256 KB — never stream back the full 1 MB',
    ).toBeLessThanOrEqual(300_000);
  });

  test('UI restart preserves PTY + scrollback (Phase 5)', async ({ page, context }) => {
    await page.goto('/');
    const marker = `SURVIVE-${Date.now()}`;
    const create = await daemonPost('/api/pty', { cmd: ['cmd.exe'] });
    const { id } = await create.json();
    await daemonPost(`/api/pty/${id}/write`, { data: `echo ${marker}\r` });

    // Simulate UI restart: close context, open new page — daemon untouched.
    await context.close();
    const newContext = await page.context().browser()!.newContext();
    const page2 = await newContext.newPage();
    await page2.goto('/');

    const replay = await daemonGet(`/api/pty/${id}/replay`);
    const body = await replay.text();
    expect(body, 'PTY must still exist + marker still in scrollback after UI restart').toContain(marker);
  });

  test('layout state lives daemon-side, survives UI restart (Phase 5)', async ({ page }) => {
    await page.goto('/');
    // Write a custom layout via the existing PUT /api/layout-state endpoint.
    const sentinel = `layout-${Date.now()}`;
    await daemonPost('/api/layout-state', {
      terminals: [{ id: sentinel, label: 'probe', tree: { kind: 'pane', id: 'p1' } }],
      activeId: sentinel,
      focusedPaneId: 'p1',
    });
    // Re-fetch after "UI restart" (just re-query; in prod this is a fresh exe).
    const r = await daemonGet('/api/layout-state');
    const body = await r.json();
    const found = (body.terminals || []).some((t: { id: string }) => t.id === sentinel);
    expect(found, 'layout must be persisted daemon-side, not UI-side').toBe(true);
  });

  test('two UIs against one daemon see the same layout (Phase 5)', async ({ page, context }) => {
    await page.goto('/');
    const marker = `multi-ui-${Date.now()}`;
    await daemonPost('/api/layout-state', {
      terminals: [{ id: marker, label: 'probe', tree: { kind: 'pane', id: 'p1' } }],
      activeId: marker,
      focusedPaneId: 'p1',
    });
    const p2 = await (await context.browser()!.newContext()).newPage();
    await p2.goto('/');
    const r = await daemonGet('/api/layout-state');
    const body = await r.json();
    expect((body.terminals || []).some((t: { id: string }) => t.id === marker)).toBe(true);
  });
});
