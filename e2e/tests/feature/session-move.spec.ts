import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Session move (v0.9.9 / task #37) — HIGH-RISK destructive operation.
 * The backend has two endpoints: `/move/plan` (read-only dry-run) and
 * `/move/execute` (actually relocates the JSONL). This suite exercises
 * both at the API level with proof-before and proof-after diffs from
 * /api/sessions.
 *
 * We use a dedicated, self-seeded session file for each test run so
 * the shared fixture tree under tests/fixtures/claude-home/ is never
 * mutated — every test creates and removes its own scratch session.
 */
test.describe.configure({ mode: 'serial' });
// Known flaky in full-suite runs due to shared _INDEX state across
// specs. In isolation 5/5; in full suite sometimes the eager
// re-scan races with prior-test cache state. v1.2.12's force=True
// rebuild made this reliable in isolation — these retries absorb
// the inter-spec race pending proper backend-per-spec isolation.
test.describe.configure({ retries: 2 });

const FIXTURE_ROOT = path.resolve(
  __dirname, '..', '..', '..', 'tests', 'fixtures', 'claude-home',
);
const PROJECTS = path.join(FIXTURE_ROOT, 'projects');
const MOVE_TEST_SID = '99999999-9999-4999-8999-999999999999';
const SOURCE_DIR = 'C--move-test-src';
const SESSION_BODY =
  '{"type":"user","timestamp":"2026-02-01T09:00:00Z","cwd":"C:/move/test/src",'
  + '"gitBranch":"dev","message":{"content":"move test source",'
  + '"model":"claude-opus-4-7"}}\n';

function sessionFile(encodedDir: string): string {
  return path.join(PROJECTS, encodedDir, `${MOVE_TEST_SID}.jsonl`);
}

function seedSession(): void {
  const dir = path.join(PROJECTS, SOURCE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionFile(SOURCE_DIR), SESSION_BODY, { encoding: 'utf8' });
}

function cleanupAllTestDirs(): void {
  // Remove anything starting with C--move-test- — covers the source dir
  // AND any scratch targets the test created.
  if (!fs.existsSync(PROJECTS)) return;
  for (const entry of fs.readdirSync(PROJECTS)) {
    if (entry.startsWith('C--move-test-')) {
      const p = path.join(PROJECTS, entry);
      try {
        fs.rmSync(p, { recursive: true, force: true });
      } catch { /* best effort */ }
    }
  }
}

async function listSessions(request: APIRequestContext): Promise<{ items: Array<{ id: string; path: string; cwd: string }> }> {
  const r = await request.get('/api/sessions');
  return await r.json();
}

async function rescan(request: APIRequestContext): Promise<void> {
  await request.post('/api/rescan');
}

test.describe('session move — /api/sessions/{sid}/move', () => {
  test.beforeEach(async ({ request }) => {
    cleanupAllTestDirs();
    seedSession();
    await rescan(request);
  });

  test.afterAll(async () => {
    cleanupAllTestDirs();
  });

  test('plan refuses execute without confirm=true (400)', async ({ request }) => {
    const r = await request.post(`/api/sessions/${MOVE_TEST_SID}/move/execute`, {
      data: { targetCwd: 'C:/move/test/target' },
    });
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.detail).toContain('confirm=true');
  });

  test('plan for a resumable session returns safe_to_move=true + sha + target encoded dir', async ({ request }) => {
    const r = await request.post(`/api/sessions/${MOVE_TEST_SID}/move/plan`, {
      data: { targetCwd: 'C:/move/test/fresh-target' },
    });
    expect(r.status()).toBe(200);
    const plan = await r.json();
    expect(plan.safe_to_move, `plan errors: ${JSON.stringify(plan.errors)}`).toBe(true);
    expect(plan.target_encoded_dir).toBe('C--move-test-fresh-target');
    expect(plan.src_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.dest_file_exists).toBe(false);
  });

  test('plan for unknown sid surfaces structured error', async ({ request }) => {
    const fakeSid = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const r = await request.post(`/api/sessions/${fakeSid}/move/plan`, {
      data: { targetCwd: 'C:/anywhere' },
    });
    expect(r.status()).toBe(200);
    const plan = await r.json();
    expect(plan.safe_to_move).toBe(false);
    expect(plan.errors.some((e: string) => /not found/i.test(e))).toBe(true);
  });

  test('execute moves session + /api/sessions shows it at new path', async ({ request }) => {
    // PROOF BEFORE: seed is at SOURCE_DIR.
    const before = await listSessions(request);
    const seeded = before.items.find((s) => s.id === MOVE_TEST_SID);
    expect(seeded, 'seeded session should be in /api/sessions before move').toBeDefined();
    expect(seeded!.path).toContain(SOURCE_DIR);

    // PLAN
    const planR = await request.post(`/api/sessions/${MOVE_TEST_SID}/move/plan`, {
      data: { targetCwd: 'C:/move/test/target-A' },
    });
    const plan = await planR.json();
    expect(plan.safe_to_move, `plan: ${JSON.stringify(plan.errors)}`).toBe(true);

    // EXECUTE
    const execR = await request.post(`/api/sessions/${MOVE_TEST_SID}/move/execute`, {
      data: { targetCwd: 'C:/move/test/target-A', confirm: true },
    });
    expect(execR.status()).toBe(200);
    const execBody = await execR.json();
    expect(execBody.ok, `execute failed: ${JSON.stringify(execBody)}`).toBe(true);

    // PROOF AFTER #1: filesystem shows the move.
    expect(fs.existsSync(sessionFile(SOURCE_DIR)),
      'source file should be gone after move').toBe(false);
    expect(fs.existsSync(sessionFile('C--move-test-target-A')),
      'destination file should exist after move').toBe(true);

    // PROOF AFTER #2: /api/sessions reflects the new path.
    // The execute handler does an eager re-scan, but on slow Windows CI
    // runners the scan can lag the HTTP response by a beat. Poll for up
    // to 5s before failing — the invariant is "eventually shows up", not
    // "synchronously visible".
    let moved: { id: string; path: string } | undefined;
    let lastAfter: { items: Array<{ id: string; path?: string }> } | undefined;
    for (let i = 0; i < 25; i += 1) {
      lastAfter = await listSessions(request);
      moved = lastAfter.items.find((s) => s.id === MOVE_TEST_SID) as typeof moved;
      if (moved?.path?.includes('C--move-test-target-A')) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(moved,
      `session disappeared from list after 5s poll. sid=${MOVE_TEST_SID} ` +
      `after.items=${lastAfter?.items.map((s) => s.id.slice(0, 8)).join(',')}`
    ).toBeDefined();
    expect(moved!.path).toContain('C--move-test-target-A');
  });

  test('same-dir move is refused as no-op', async ({ request }) => {
    // Target that encodes to the SAME SOURCE_DIR. "C:/move/test/src" →
    // "C--move-test-src" which matches our seed dir.
    const r = await request.post(`/api/sessions/${MOVE_TEST_SID}/move/plan`, {
      data: { targetCwd: 'C:/move/test/src' },
    });
    const plan = await r.json();
    expect(plan.safe_to_move).toBe(false);
    expect(plan.errors.some((e: string) => /no-op/.test(e))).toBe(true);
  });
});
