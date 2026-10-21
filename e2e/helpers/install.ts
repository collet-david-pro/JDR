import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { admin, db } from './env';

/** Folder of the deliverable copy served on this port (written by dev/e2e-serve.sh). */
export function sitePath(port: number): string {
  const file = fileURLToPath(new URL(`../logs/site-${port}.path`, import.meta.url));
  return readFileSync(file, 'utf8').trim();
}

/**
 * Steps 1 to 5 of install.php through its forms (projet.md 19), on a blank database.
 * Works with and without JavaScript: only forms, links and redirects are used.
 * Ends on step 6 ("Installation terminée").
 */
export async function runInstaller(page: Page, baseURL: string, dbName: string): Promise<void> {
  // Step 1: requirements (no blocking item on the test server).
  await page.goto('/install.php');
  await expect(page.getByRole('heading', { name: 'Vérification du serveur' })).toBeVisible();
  await expect(page.locator('li[aria-current="step"]')).toContainText('Prérequis');
  await expect(page.locator('.notice.error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Step 2: database.
  await expect(page.getByRole('heading', { name: 'Base de données', level: 2 })).toBeVisible();
  await page.locator('input[name="host"]').fill(db.host);
  await page.locator('input[name="port"]').fill(db.port);
  await page.locator('input[name="name"]').fill(dbName);
  await page.locator('input[name="user"]').fill(db.user);
  await page.locator('input[name="pass"]').fill(db.pass);
  await page.locator('input[name="prefix"]').fill(db.prefix);
  await page.getByRole('button', { name: 'Tester et continuer' }).click();

  // Step 3: site. The base URL is detected from the request.
  await expect(page.getByRole('heading', { name: 'Réglages du site' })).toBeVisible();
  await expect(page.locator('input[name="base_url"]')).toHaveValue(baseURL);
  await page.locator('input[name="site_name"]').fill('JDR E2E');
  await page.locator('select[name="registration_mode"]').selectOption('open');
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Step 4: administrator.
  await expect(page.getByRole('heading', { name: 'Compte administrateur' })).toBeVisible();
  await page.locator('input[name="email"]').fill(admin.email);
  await page.locator('input[name="username"]').fill(admin.username);
  await page.locator('input[name="password"]').fill(admin.password);
  await page.locator('input[name="password_confirm"]').fill(admin.password);
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Step 5: summary, then the migrations run one per request (fetch loop or meta refresh).
  await expect(page.getByRole('heading', { name: 'Récapitulatif' })).toBeVisible();
  await expect(page.getByText('Nouvelle installation.')).toBeVisible();
  await page.getByRole('button', { name: "Lancer l'installation" }).click();

  // Step 6.
  await expect(page.getByRole('heading', { name: 'Installation terminée' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('li[aria-current="step"]')).toContainText('Terminé');
  // No .git folder in the copy: install.php deletes itself.
  await expect(page.getByText('Le fichier install.php a été supprimé.')).toBeVisible();
}
