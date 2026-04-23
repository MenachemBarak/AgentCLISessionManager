import type { Page } from '@playwright/test';

/**
 * Thin wrappers around the backend HTTP API used for "second source of
 * proof" assertions. A DOM-only assertion could be lying — cross-checking
 * with /api/sessions or /api/status ensures the data-layer agrees.
 */

export async function readStatus(page: Page): Promise<{ version: string; ready: boolean; phase: string; done: number; total: number }> {
  const r = await page.request.get('/api/status');
  return await r.json();
}

export async function readSessions(page: Page): Promise<{ total: number; items: Array<{ id: string; title: string; cwd: string; active: boolean; provider: string }> }> {
  const r = await page.request.get('/api/sessions');
  return await r.json();
}

export async function readUpdateStatus(page: Page): Promise<{
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  staged: boolean;
  checked: boolean;
  downloadProgress: number;
  error: string | null;
}> {
  const r = await page.request.get('/api/update-status');
  return await r.json();
}

export async function readLayoutState(page: Page): Promise<{ terminals: unknown[]; activeId: string | null; focusedPaneId: string | null }> {
  const r = await page.request.get('/api/layout-state');
  return await r.json();
}
