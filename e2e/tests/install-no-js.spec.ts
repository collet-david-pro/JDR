import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { noJs } from '../helpers/env';
import { runInstaller, sitePath } from '../helpers/install';

/**
 * install.php works without JavaScript (projet.md 19): plain forms, and step 5 chained by the
 * <noscript> meta refresh. Second isolated instance (port 8091, database jdr_e2e_nojs).
 */
test('installs JDR with JavaScript disabled', async ({ page, request }) => {
  await runInstaller(page, noJs.baseURL, noJs.dbName);

  const site = sitePath(noJs.port);
  expect(existsSync(join(site, 'config.php'))).toBe(true);
  expect(existsSync(join(site, 'install.php'))).toBe(false);

  const health = await (await request.get(`${noJs.baseURL}/api/v1/health`)).json();
  expect(health.data.db).not.toBe('not_configured');
  expect((await request.get(`${noJs.baseURL}/install.php`)).status()).toBe(404);
});
