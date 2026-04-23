import type { APIRequestContext } from '@playwright/test';

/**
 * Helpers that PUT known states to /api/layout-state so each test starts
 * from a predictable tile-tree.
 */

export async function seedEmptyLayout(request: APIRequestContext): Promise<void> {
  await request.put('/api/layout-state', {
    data: { terminals: [], activeId: null, focusedPaneId: null },
  });
}

export async function seedAdHocShellTab(request: APIRequestContext): Promise<void> {
  await request.put('/api/layout-state', {
    data: {
      terminals: [{
        id: 'term-1', label: 'shell',
        tree: { kind: 'pane', id: 'p1', spawn: { cmd: ['cmd.exe'] } },
      }],
      activeId: 'term-1',
      focusedPaneId: 'p1',
    },
  });
}

export async function seedResumableTab(request: APIRequestContext, sessionId: string, label = 'resume'): Promise<void> {
  await request.put('/api/layout-state', {
    data: {
      terminals: [{
        id: 'term-1', label,
        tree: { kind: 'pane', id: 'p1', spawn: { provider: 'claude-code', sessionId } },
      }],
      activeId: 'term-1',
      focusedPaneId: 'p1',
    },
  });
}

/** The shape the v0.9.0 crash was caused by. Regression guard. */
export async function seedCorruptLayout(request: APIRequestContext): Promise<void> {
  await request.put('/api/layout-state', {
    data: {
      terminals: [{
        id: 'term-1', label: 'probe',
        tree: { id: 'p1', kind: 'leaf', spawn: { cmd: ['cmd.exe'] } },
      }],
      activeId: 'term-1',
      focusedPaneId: 'p1',
    },
  });
}
