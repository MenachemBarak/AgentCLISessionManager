import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

// The tests point at a server that the runner starts via `webServer` below.
// CSV_APP_URL lets CI override to an already-running instance (e.g. the built
// exe launched in a separate step) — when set we skip webServer entirely.
const externalUrl = process.env.CSV_APP_URL;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // the app is stateful (one server), parallel writes would corrupt layout
  workers: 1,           // hard limit — we share one backend, cannot parallelize file-level either
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: externalUrl ?? 'http://127.0.0.1:8769',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // When pointing at an external server (the built exe), don't start one.
  // Otherwise spin up the dev server against a tmp CLAUDE_HOME for hermetic runs.
  webServer: externalUrl
    ? undefined
    : {
        command: 'python -m backend.cli --server-only --port 8769 --no-browser',
        url: 'http://127.0.0.1:8769/api/status',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
        cwd: '..',
        env: {
          CSV_TEST_MODE: '1',
          // Point at the repo's fixture tree — guarantees the session list
          // has rows to render in CI (user HOME is empty on runners). The
          // backend's conftest uses the same directory.
          CLAUDE_HOME: path.resolve(__dirname, '..', 'tests', 'fixtures', 'claude-home'),
          PYTHONIOENCODING: 'utf-8',
        },
      },
});
