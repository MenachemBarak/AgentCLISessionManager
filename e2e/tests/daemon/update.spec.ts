/**
 * Daemon Phase 7 contract — updater dual-asset, UI-only updates are
 * zero-downtime, daemon updates restart PTYs (acceptable per ADR-18).
 * Red against v1.1.0 by design.
 */
import { test, expect } from '@playwright/test';
import { daemonGet, daemonPost, pidIsAlive, readPidFile } from '../../helpers/daemon-probe';

test.describe.configure({ mode: 'serial' });

test.describe('update flow under daemon split', () => {
  test('UI-only update → daemon pid unchanged → PTY survives', async ({ page }) => {
    const pf = readPidFile();
    const daemonPidBefore = pf.pid;

    // Create a PTY and write a marker.
    const create = await daemonPost('/api/pty', { cmd: ['cmd.exe'] });
    const { id } = await create.json();
    const marker = `update-probe-${Date.now()}`;
    await daemonPost(`/api/pty/${id}/write`, { data: `echo ${marker}\r` });

    // Simulate the UI-only swap helper: ask updater to swap UI exe.
    // Phase 7 exposes /api/update/apply-ui-only that returns when the new UI is
    // staged and the swap helper has relaunched the UI. Daemon stays up.
    const r = await daemonPost('/api/update/apply-ui-only', {
      stagedUiExe: 'FAKE-FOR-TEST',
    });
    expect(r.status).toBe(200);

    // After UI swap + relaunch, daemon must be the same pid, and PTY still alive.
    const pf2 = readPidFile();
    expect(pf2.pid, 'daemon pid must be unchanged across UI-only update').toBe(daemonPidBefore);
    expect(pidIsAlive(daemonPidBefore)).toBe(true);
    const replay = await daemonGet(`/api/pty/${id}/replay`);
    expect(await replay.text()).toContain(marker);
  });

  test('daemon update → PTYs restart → restart-ping fires (known cost)', async () => {
    const pf = readPidFile();
    const before = pf.pid;
    const create = await daemonPost('/api/pty', { cmd: ['cmd.exe'] });
    const { id } = await create.json();

    const r = await daemonPost('/api/update/apply-daemon', {
      stagedDaemonExe: 'FAKE-FOR-TEST',
    });
    expect(r.status).toBe(200);

    // Daemon pid should change (new daemon process).
    const pf2 = readPidFile();
    expect(pf2.pid, 'daemon pid must change across daemon update').not.toBe(before);
    // PTY id is NEW (can't be transferred; HPCON non-transferable).
    const stillExists = await daemonGet(`/api/pty/${id}/replay`);
    expect(stillExists.status, 'old PTY id should no longer resolve post-daemon-update').toBe(404);
  });
});
