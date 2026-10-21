import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectSignedIn, login } from '../helpers/app';
import { admin, main } from '../helpers/env';
import { runInstaller, sitePath } from '../helpers/install';

/**
 * Project "setup": full installation through the browser on a blank database (projet.md 19,
 * P1 criteria "installation complète sans éditer de fichier" and "install.php inutilisable ensuite").
 * The other browser projects depend on it.
 */
test.describe.configure({ mode: 'serial' });

test('installs JDR through the 6-step wizard (JavaScript enabled)', async ({ page, request }) => {
  const before = await (await request.get('/api/v1/health')).json();
  expect(before.data.db).toBe('not_configured');

  await runInstaller(page, main.baseURL, main.dbName);

  // config.php written in the copy, install.php deleted (no .git folder there).
  const site = sitePath(main.port);
  expect(existsSync(join(site, 'config.php'))).toBe(true);
  expect(statSync(join(site, 'config.php')).size).toBeGreaterThan(0);
  expect(existsSync(join(site, 'storage', 'install.lock'))).toBe(true);
  expect(existsSync(join(site, 'install.php'))).toBe(false);

  const after = await (await request.get('/api/v1/health')).json();
  expect(after.data.db).not.toBe('not_configured');

  // "Se connecter" leads to the SPA login page; the new administrator signs in.
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, admin.email, admin.password, admin.username);
  await expect(page.getByRole('link', { name: 'Administration' })).toBeVisible();
});

test('install.php can no longer be used once installed', async ({ browser }) => {
  // A fresh browser (no installer session): the deleted script must not answer.
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.goto('/install.php');
  expect(response, 'navigation response').not.toBeNull();
  const status = response!.status();
  expect([403, 404], `GET /install.php answered ${status}`).toContain(status);
  if (status === 403) {
    await expect(page.getByRole('heading', { name: 'JDR est déjà installé' })).toBeVisible();
  }
  // A forged POST to a later step does not run anything either.
  const post = await context.request.post('/install.php?step=run', {
    form: { _token: 'x', action: 'start' },
    maxRedirects: 0,
  });
  expect([403, 404, 405], `POST /install.php answered ${post.status()}`).toContain(post.status());
  // Not the SPA shell either (which would answer 200 to any unknown path).
  expect(await response!.text()).not.toContain('id="app"');
  await context.close();
});

test('the administrator session survives a reload', async ({ page }) => {
  await login(page, admin.email, admin.password, admin.username);
  await page.reload();
  await expectSignedIn(page, admin.username);
});
