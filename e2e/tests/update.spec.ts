import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin } from '../helpers/app';
import { runInstaller, sitePath } from '../helpers/install';
import {
  buildFakeZip,
  buildUpdatePackage,
  repoVersion,
  updateSite,
  type UpdatePackage,
} from '../helpers/update-package';

/**
 * Administration "Mise à jour" tab (MAJ-b). The tab renders on the common server in every
 * browser; the complete update runs in Chromium on a dedicated server (port 8093) because an
 * update puts the site in maintenance. "Vérifier les mises à jour" is never clicked: the E2E
 * servers must not reach the Internet.
 */

async function openUpdateTab(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Administration' }).click();
  await page
    .getByRole('navigation', { name: "Sections de l'administration" })
    .getByRole('link', { name: 'Mise à jour' })
    .click();
  await expect(page.getByRole('heading', { name: 'Mise à jour du site', level: 2 })).toBeVisible();
}

const fileInput = (page: Page) => page.getByLabel('Archive de mise à jour (.zip)');

test.describe('tab rendering (common server)', () => {
  test('shows the installed version, the channel, the check button and the upload field', async ({ page }) => {
    await loginAsAdmin(page);
    await openUpdateTab(page);
    await expect(page.getByTestId('update-current')).toHaveText(repoVersion());
    // Default channel: pre-releases while the installed version is itself a pre-release.
    await expect(page.getByLabel('Canal de mise à jour')).toHaveValue(
      repoVersion().includes('-') ? 'prerelease' : 'stable',
    );
    await expect(page.getByRole('button', { name: 'Vérifier les mises à jour' })).toBeEnabled();
    await expect(fileInput(page)).toBeVisible();
    await expect(page.getByText(/Taille maximale : .*upload_max_filesize/)).toBeVisible();
  });
});

test.describe('complete update (dedicated server, Chromium)', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ baseURL: updateSite.baseURL });

  let pkg: UpdatePackage;
  let same: UpdatePackage;

  test.beforeAll(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'full update run: Chromium only');
    pkg = buildUpdatePackage();
    same = buildUpdatePackage({ version: repoVersion(), migration: false });
  });

  test.afterAll(() => {
    pkg?.cleanup();
    same?.cleanup();
  });

  test('installs the site, then refuses an invalid zip and a zip of the same version', async ({ page }) => {
    test.setTimeout(120_000);
    await runInstaller(page, updateSite.baseURL, updateSite.dbName);
    await page.getByRole('link', { name: 'Se connecter' }).click();
    await loginAsAdmin(page);
    await openUpdateTab(page);
    await expect(page.getByTestId('update-current')).toHaveText(pkg.current);

    const fake = buildFakeZip();
    try {
      await fileInput(page).setInputFiles(fake.path);
      await expect(page.getByRole('alert')).toContainText("Ce fichier n'est pas une archive zip valide.");
    } finally {
      fake.cleanup();
    }

    await fileInput(page).setInputFiles(same.zip);
    await expect(page.getByRole('alert')).toContainText("n'est pas plus récente que la version installée");
    await expect(page.getByRole('heading', { name: 'Récapitulatif de la mise à jour' })).toHaveCount(0);
  });

  test('uploads the archive, shows the summary, installs it through update.php', async ({ page }) => {
    test.setTimeout(240_000);
    await loginAsAdmin(page);
    await openUpdateTab(page);

    const chunks: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().includes('/admin/update/uploads/')) {
        chunks.push(request.url());
      }
    });
    await fileInput(page).setInputFiles(pkg.zip);

    // Summary: unverified (GitHub is not queried), so the confirmation is required.
    const title = page.getByRole('heading', { name: 'Récapitulatif de la mise à jour' });
    await expect(title).toBeVisible({ timeout: 60_000 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    await expect(page.getByText(`Version ${pkg.current} vers ${pkg.version}.`)).toBeVisible();
    await expect(page.getByText("L'authenticité de cette archive n'a pas pu être vérifiée")).toBeVisible();
    await expect(page.getByText('9999_e2e_noop.sql', { exact: true })).toBeVisible();
    await expect(page.getByText('Le site sera en maintenance pendant la mise à jour')).toBeVisible();

    const install = page.getByRole('button', { name: 'Installer' });
    await expect(install).toBeDisabled();
    await page.getByLabel("Je confirme installer une archive dont l'authenticité n'a pas pu être vérifiée").check();
    await expect(install).toBeEnabled();
    await install.click();

    // update.php runs the steps one request at a time; its script chains them by itself (the
    // "Continue" button only comes back if the requests keep failing).
    await page.waitForURL(/update\.php/);
    await expect(page.getByText('Mise à jour terminée.')).toBeVisible({ timeout: 180_000 });

    // Result: new version served, site open, migration applied, database backup written.
    const version = await (await page.request.get('/api/v1/version')).json();
    expect(version.data.version).toBe(pkg.version);
    const health = await page.request.get('/api/v1/health');
    expect(health.status()).toBe(200);

    await page.goto('/admin/migrations');
    await expect(page.getByRole('heading', { name: 'Historique des migrations' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '9999', exact: true })).toBeVisible();

    const backups = join(sitePath(updateSite.port), 'storage', 'backups');
    expect(existsSync(backups)).toBe(true);
    expect(readdirSync(backups).some((name) => name.endsWith('.sql.gz'))).toBe(true);
  });
});
