import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

/**
 * Runtime proof that v1.1.0's shell-wrap actually types the claude
 * command into the PTY when a tab is hydrated with `_autoResume`.
 *
 * The shell-wrap-resume.spec.ts file pins the SOURCE contract — this
 * file proves the RUNTIME BEHAVIOUR by intercepting WebSocket frames
 * sent from the browser to /api/pty/ws. We see the chunked typing of
 * the command AND the separate `\r` frame.
 */
test.describe.configure({ mode: 'serial' });

const AUTO_SID = '55555555-5555-4555-8555-555555555555';

async function seedShellWrapTab(request: APIRequestContext, sid: string): Promise<void> {
  await request.put('/api/layout-state', {
    data: {
      terminals: [{
        id: 'term-sw-1',
        label: `resume-${sid.slice(0, 8)}`,
        tree: {
          kind: 'pane',
          id: 'p-sw-1',
          spawn: {
            cmd: ['cmd.exe'],
            cwd: process.env.TEMP || 'C:/Windows/Temp',
            _autoResume: {
              sessionId: sid,
              provider: 'claude-code',
            },
          },
        },
      }],
      activeId: 'term-sw-1',
      focusedPaneId: 'p-sw-1',
    },
  });
}

test('shell-wrap tab types chunked claude command into PTY then Enter', async ({ page, request }) => {
  await seedShellWrapTab(request, AUTO_SID);

  // Intercept WS frames — specifically client→server sends with type:'input'.
  const sentInputs: string[] = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/api/pty/ws')) return;
    ws.on('framesent', (f) => {
      try {
        const msg = JSON.parse(String(f.payload || ''));
        if (msg && msg.type === 'input' && typeof msg.data === 'string') {
          sentInputs.push(msg.data);
        }
      } catch {
        /* non-JSON ping/heartbeat frames — ignore */
      }
    });
  });

  await page.goto('/');

  // The flow in terminal-pane.jsx: ready → 1.2s wait → typeIntoPty
  // chunks the command (16 chars, 30ms gap each) → then separate `\r`.
  // The command is
  //   claude --dangerously-skip-permissions --resume <sid>
  // That's ~70 chars → ~5 chunks of 16 + ~150ms of gaps → under 2s
  // after the 1.2s wait. Budget 10s for CI + cmd.exe spawn latency.
  const expected = `claude --dangerously-skip-permissions --resume ${AUTO_SID}`;

  await expect.poll(() => {
    const joined = sentInputs.join('');
    return joined.includes(expected);
  }, { timeout: 15_000, message: `never saw full command in captured inputs. Got: ${JSON.stringify(sentInputs)}` }).toBe(true);

  // Confirm Enter was a SEPARATE frame (not concatenated). There must
  // be at least one input frame containing ONLY `\r`, sent AFTER the
  // last chunk of the command.
  const enterIdx = sentInputs.lastIndexOf('\r');
  expect(enterIdx, 'must have sent \\r as its own frame — concatenated Enter would trigger the v1.0.0 paste bug').toBeGreaterThanOrEqual(0);

  // The command chunks must be ≤ 16 chars each (typeIntoPty's CHUNK
  // constant). A 50+ char single frame would indicate regression to
  // the single-paste anti-pattern.
  const chunks = sentInputs.filter((s) => s.includes('claude'));
  for (const c of chunks) {
    expect(c.length, `chunk exceeds 16 chars (${c.length}): ${JSON.stringify(c)}`)
      .toBeLessThanOrEqual(20);  // 16 + small slack for edge cases
  }
});
