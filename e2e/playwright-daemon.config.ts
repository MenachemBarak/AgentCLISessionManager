// Dedicated Playwright config for the daemon/UI split e2e project
// (ADR-18 / Task #42). Starts an actual daemon via `python -m daemon`
// against a tmp AGENTMANAGER_STATE_DIR so tests can probe pidfile +
// token + port without touching the user's real install.
//
// Run with:
//   pnpm exec playwright test --config=playwright-daemon.config.ts
import { defineConfig, devices } from '@playwright/test';
import * as os from 'os';
import * as path from 'path';

// Stable state dir so reuseExistingServer doesn't leave the test runner
// pointing at a previous run's pid-randomized dir. Cleared between runs
// by `reuseExistingServer: false` + the webServer lifecycle.
const STATE_DIR = path.join(os.tmpdir(), 'agentmanager-e2e-daemon');
const DAEMON_PORT = '8765';
process.env.AGENTMANAGER_STATE_DIR = STATE_DIR;

export default defineConfig({
  testDir: './tests/daemon',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${DAEMON_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'daemon', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Launch daemon with a state dir isolated from the user's real install.
    // The daemon process creates daemon.pid + token there on boot.
    command: `python -m daemon`,
    url: `http://127.0.0.1:${DAEMON_PORT}/api/health`,
    // Always start a fresh daemon for the daemon e2e — reuse would
    // leave us probing stale pid/token from a previous run.
    reuseExistingServer: false,
    timeout: 30_000,
    cwd: '..',
    env: {
      AGENTMANAGER_STATE_DIR: STATE_DIR,
      AGENTMANAGER_DAEMON_PORT: DAEMON_PORT,
      PYTHONIOENCODING: 'utf-8',
      CLAUDE_HOME: path.resolve(__dirname, '..', 'tests', 'fixtures', 'claude-home'),
    },
  },
});
