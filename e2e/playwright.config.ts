import { defineConfig, devices } from '@playwright/test';
import { main, noJs } from './helpers/env';

/**
 * E2E tests (projet.md 21). Two isolated servers (dev/e2e-serve.sh): a copy of the deliverable
 * and a blank database each, wiped when the run ends.
 * - main (8090): "setup" installs it through the browser, then each browser project runs the
 *   account and administration scenarios against it;
 * - no-js (8091): installed with JavaScript disabled.
 * One worker: the scenarios share server-wide state (registration mode, rate limits).
 *
 * Browsers: E2E_BROWSERS=chromium,firefox,webkit (default: all three).
 *
 * Usage (front built first: cd frontend && npm run build):
 *   cd e2e && npm ci && npx playwright install chromium firefox webkit
 *   npx playwright test                       # everything
 *   E2E_BROWSERS=chromium npx playwright test # Chromium only
 *   npx playwright show-report                # HTML report
 * Database: E2E_DB_HOST/PORT/USER/PASS (default 127.0.0.1:3306, root, no password); the
 * databases jdr_e2e and jdr_e2e_nojs are dropped and recreated by every run.
 */
const browsers = (process.env.E2E_BROWSERS ?? 'chromium,firefox,webkit')
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name !== '');

const deviceOf = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
} as const;

const server = (port: number, dbName: string) => ({
  command: 'bash ../dev/e2e-serve.sh',
  url: `http://127.0.0.1:${port}/install.php`,
  env: { E2E_PORT: String(port), E2E_DB_NAME: dbName },
  reuseExistingServer: false,
  timeout: 60_000,
  stdout: 'pipe' as const,
  stderr: 'pipe' as const,
  gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 15_000 },
});

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: main.baseURL,
    locale: 'fr-FR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [server(main.port, main.dbName), server(noJs.port, noJs.dbName)],
  projects: [
    {
      name: 'setup',
      testMatch: /install\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    ...browsers.map((name) => ({
      name,
      testMatch: /(auth|admin|library|games|editor)\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...deviceOf[name as keyof typeof deviceOf] },
    })),
    {
      name: 'install-no-js',
      testMatch: /install-no-js\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: noJs.baseURL, javaScriptEnabled: false },
    },
  ],
});
