import { expect, test, type Locator, type Page } from '@playwright/test';
import { AdminApi, expectSignedIn, login, loginAsAdmin } from '../helpers/app';
import { resetRateLimits } from '../helpers/db';
import { main, unique, userPassword } from '../helpers/env';

/**
 * Administration (projet.md 2.1, 18.1 p.11-13; P1 criteria): suspension => immediate sign-out,
 * invitations and invite-only registration, diagnostic page and SSE test stream.
 */
test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  resetRateLimits(main.dbName);
});

test.afterAll(async () => {
  // Whatever happened, leave the site open to sign-ups for the next browser project.
  const api = await AdminApi.open(main.baseURL);
  await api.setRegistrationMode('open');
  await api.close();
});

/** Opens a tab of the admin console and waits for its content. */
async function openAdmin(page: Page, tab: string, ready: (page: Page) => Locator): Promise<void> {
  await page.getByRole('link', { name: 'Administration' }).click();
  await page
    .getByRole('navigation', { name: "Sections de l'administration" })
    .getByRole('link', { name: tab })
    .click();
  await expect(ready(page)).toBeVisible();
}

const heading = (name: string) => (page: Page) => page.getByRole('heading', { name, level: 2 });

test('suspending a signed-in user signs them out at their next action', async ({ page, browser }) => {
  const username = unique('cible');
  const email = `${username}@example.org`;

  // Admin creates the account (initial password) from the console.
  await loginAsAdmin(page);
  await openAdmin(page, 'Comptes', heading('Comptes'));
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name="email"]').fill(email);
  await dialog.locator('input[name="username"]').fill(username);
  await dialog.locator('input[name="password"]').fill(userPassword);
  await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row).toBeVisible();

  // The user signs in from another browser.
  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();
  await login(userPage, email, userPassword, username);

  // Admin suspends the account.
  await row.getByRole('button', { name: 'Suspendre' }).click();
  await expect(row.locator('.badge', { hasText: 'Suspendu' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Réactiver' })).toBeVisible();

  // Next action of the user: the API answers 401 and the SPA goes back to the login page.
  const denied = userPage.waitForResponse((r) => r.url().includes('/api/v1/') && r.status() === 401);
  await userPage.getByRole('link', { name: 'Profil' }).click();
  await denied;
  await expect(userPage).toHaveURL(/\/login(\?next=.*)?$/);
  await expect(userPage.getByRole('button', { name: 'Déconnexion' })).toHaveCount(0);

  // And cannot sign in again while suspended.
  const response = userPage.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'));
  await userPage.locator('input[name="identifier"]').fill(email);
  await userPage.locator('input[name="password"]').fill(userPassword);
  await userPage.getByRole('button', { name: 'Se connecter' }).click();
  expect((await response).status()).toBe(403);
  await expect(userPage.getByRole('alert').filter({ hasText: 'Ce compte est suspendu' })).toBeVisible();
  await userContext.close();
});

test('invite-only registration through an invitation link', async ({ page, browser }) => {
  await loginAsAdmin(page);

  // 1. Invitation (single use, 7 days).
  await openAdmin(page, 'Invitations', heading('Nouvelle invitation'));
  await page.locator('input[name="max_uses"]').fill('1');
  await page.locator('input[name="expires_in_days"]').fill('7');
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  const link = page.getByLabel('Lien', { exact: true });
  await expect(link).toHaveValue(/\/invite\/[A-Za-z0-9-]+$/);
  const url = await link.inputValue();
  expect(url.startsWith(main.baseURL)).toBe(true);

  // 2. Registration mode "on invitation".
  await openAdmin(page, 'Réglages', (p) => p.locator('select[name="registration_mode"]'));
  await page.locator('select[name="registration_mode"]').selectOption('invite');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/admin/settings') && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText('Réglages enregistrés.', { exact: true })).toBeVisible();

  // 3. A visitor: plain sign-up now asks for a code; the link fills it in.
  const visitor = await browser.newContext();
  const guest = await visitor.newPage();
  await guest.goto('/register');
  await expect(guest.getByText("L'inscription se fait sur invitation")).toBeVisible();
  await expect(guest.locator('input[name="invitation_code"]')).toHaveValue('');

  await guest.goto(url);
  await expect(guest.locator('input[name="invitation_code"]')).not.toHaveValue('');
  const username = unique('invite');
  await guest.locator('input[name="email"]').fill(`${username}@example.org`);
  await guest.locator('input[name="username"]').fill(username);
  await guest.locator('input[name="password"]').fill(userPassword);
  await guest.locator('input[name="password_confirmation"]').fill(userPassword);
  const registered = guest.waitForResponse((r) => r.url().endsWith('/api/v1/auth/register'));
  await guest.getByRole('button', { name: 'Créer mon compte' }).click();
  expect((await registered).status()).toBe(201);
  await expectSignedIn(guest, username);
  await visitor.close();

  // 4. The invitation is used up (1 / 1).
  await openAdmin(page, 'Invitations', heading('Nouvelle invitation'));
  await expect(page.getByRole('cell', { name: '1 / 1', exact: true }).first()).toBeVisible();
});

test('diagnostic page and SSE test stream', async ({ page }) => {
  await loginAsAdmin(page);
  await openAdmin(page, 'Diagnostic', heading('Diagnostic'));
  const checks = page.locator('ul.checks > li');
  await expect(checks.first()).toBeVisible();
  expect(await checks.count()).toBeGreaterThan(3);
  const errors = await checks.filter({ has: page.locator('.badge-error') }).allInnerTexts();
  expect(errors, 'diagnostic checks in error on a fresh install').toEqual([]);

  await page.getByRole('button', { name: 'Tester le flux temps réel' }).click();
  await expect(page.getByText('Les messages arrivent au fil de l\'eau')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Réception : \d+ ms, \d+ ms, \d+ ms$/)).toBeVisible();
});

test('diagnostic values are readable (no "[object Object]")', async ({ page }) => {
  await loginAsAdmin(page);
  await openAdmin(page, 'Diagnostic', heading('Diagnostic'));
  await expect(page.locator('ul.checks > li').first()).toBeVisible();
  await expect(page.locator('ul.checks')).not.toContainText('[object Object]', { timeout: 2_000 });
});
