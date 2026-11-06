import { defineConfig, devices } from '@playwright/test';
import { main, noJs } from './helpers/env';
import { updateSite } from './helpers/update-package';

/**
 * E2E tests (projet.md 21). Two isolated servers (dev/e2e-serve.sh): a copy of the deliverable
 * and a blank database each, wiped when the run ends.
 * - main (8090): "setup" installs it through the browser, then each browser project runs the
 *   account and administration scenarios against it;
 * - no-js (8091): installed with JavaScript disabled;
 * - update (8093): installed by update.spec.ts itself, which then updates it (maintenance).
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
  // Headless Firefox on Linux runners turns WebGL off unless forced (the map scene needs it).
  firefox: { ...devices['Desktop Firefox'], launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true } } },
  webkit: devices['Desktop Safari'],
} as const;

const server = (port: number, dbName: string) => ({
  command: 'bash ../dev/e2e-serve.sh',
  url: `http://127.0.0.1:${port}/install.php`,
  env: { E2E_PORT: String(port), E2E_DB_NAME: dbName },
  reuseExistingServer: false,
  // Three servers each copy the site at startup: slow when the disk is busy (synced folder).
  timeout: 180_000,
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
  webServer: [
    server(main.port, main.dbName),
    server(noJs.port, noJs.dbName),
    server(updateSite.port, updateSite.dbName), // update.spec.ts: an update puts its site in maintenance
  ],
  projects: [
    {
      name: 'setup',
      testMatch: /install\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    ...browsers.map((name) => ({
      name,
      // E2E_NO_WEBGL=firefox (CI): headless Firefox on the runners has no WebGL at all, so the
      // scenarios that need a live scene (console, player view, screens) cannot run there; the
      // editor scenarios already skip themselves when the engine reports "unsupported".
      ...(process.env.E2E_NO_WEBGL === name
        ? {
            testIgnore: /(displays-criteria|displays-gm|floors|notes-session)\.spec\.ts/,
            grepInvert: /games, sessions, GM console|keyboard-only walkthrough/,
          }
        : {}),
      testMatch: /(a11y|auth|admin|library|games|editor|maps|versions|procgen|export-png|vision|sessions-gm|sessions-player|sessions-criteria|update|display|displays-gm|displays-criteria|floors|notes-session|palette|templates|help)\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...deviceOf[name as keyof typeof deviceOf] },
    })),
    // Help screenshots (P13-2): on demand only, E2E_HELP_SHOTS=1 npx playwright test --project=help-shots
    ...(process.env.E2E_HELP_SHOTS === '1'
      ? [
          {
            name: 'help-shots',
            testDir: './shots',
            testMatch: /help-shots\.ts/,
            dependencies: ['setup'],
            timeout: 420_000,
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
    // README screenshots (P13-4b): on demand only, E2E_README_SHOTS=1 npx playwright test --project=readme-shots
    ...(process.env.E2E_README_SHOTS === '1'
      ? [
          {
            name: 'readme-shots',
            testDir: './shots',
            testMatch: /readme-shots\.ts/,
            dependencies: ['setup'],
            timeout: 900_000,
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
    {
      name: 'install-no-js',
      testMatch: /install-no-js\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: noJs.baseURL, javaScriptEnabled: false },
    },
  ],
});
