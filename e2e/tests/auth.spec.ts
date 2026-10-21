import { expect, test, type Page } from '@playwright/test';
import { AdminApi, expectSignedIn, login, logout, submitLogin } from '../helpers/app';
import { resetRateLimits } from '../helpers/db';
import { main, unique, userPassword } from '../helpers/env';

/**
 * Accounts (projet.md 2.1, 6.4, 11.1; P1 criteria): open sign-up, sign-out, sign-in,
 * temporary block after 6 failures, "remember me".
 */
test.describe.configure({ mode: 'serial' });

const username = unique('joueur');
const email = `${username}@example.org`;

test.beforeAll(async () => {
  resetRateLimits(main.dbName);
  const api = await AdminApi.open(main.baseURL);
  await api.setRegistrationMode('open');
  await api.close();
});

async function register(page: Page): Promise<void> {
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Inscription' })).toBeVisible();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(userPassword);
  await page.locator('input[name="password_confirmation"]').fill(userPassword);
  const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/register'));
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  expect((await response).status()).toBe(201);
}

test('signs up (open registration), signs out and signs in again', async ({ page }) => {
  await register(page);
  // Signed in directly, on the dashboard.
  await expectSignedIn(page, username);
  await expect(page.getByRole('heading', { name: `Bonjour ${username}` })).toBeVisible();

  await logout(page);
  // Protected page while signed out => login page.
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login\?next=/);

  await login(page, email, userPassword, username);
  // Back to the page asked for before signing in.
  await expect(page).toHaveURL(/\/profile$/);
});

test('blocks sign-in temporarily after 6 wrong passwords (429)', async ({ page }) => {
  await page.goto('/login');
  const statuses: number[] = [];
  for (let attempt = 1; attempt <= 6; attempt++) {
    const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'));
    await submitLogin(page, username, `mauvais-mot-de-passe-${attempt}`);
    statuses.push((await response).status());
  }
  expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  await expect(page.getByRole('alert').filter({ hasText: 'Trop de tentatives' })).toBeVisible();

  // Even the right password is refused while the block lasts.
  const blocked = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'));
  await submitLogin(page, username, userPassword);
  expect((await blocked).status()).toBe(429);
  await expect(page.getByRole('button', { name: 'Déconnexion' })).toHaveCount(0);

  resetRateLimits(main.dbName); // the next tests sign in with this account
});

test('"remember me" keeps the user signed in after the browser session ends', async ({
  browser,
}) => {
  const first = await browser.newContext();
  const page = await first.newPage();
  await page.goto('/login');
  await submitLogin(page, email, userPassword, true);
  await expectSignedIn(page, username);

  const cookies = await first.cookies();
  const remember = cookies.find((c) => c.name === 'jdr_remember');
  expect(remember, 'jdr_remember cookie').toBeDefined();
  expect(remember!.expires).toBeGreaterThan(Date.now() / 1000 + 7 * 86400);
  expect(remember!.httpOnly).toBe(true);
  await first.close();

  // "Restart the browser": only persistent cookies survive (the session cookie jdr_sid is gone).
  const persistent = cookies.filter((c) => c.expires > 0);
  expect(persistent.some((c) => c.name === 'jdr_sid')).toBe(false);
  const second = await browser.newContext();
  await second.addCookies(persistent);
  const again = await second.newPage();
  await again.goto('/');
  await expectSignedIn(again, username);
  await expect(again.getByRole('heading', { name: `Bonjour ${username}` })).toBeVisible();

  // Without "remember me", a new browser session is signed out.
  const third = await browser.newContext();
  const plain = await third.newPage();
  await plain.goto('/login');
  await submitLogin(plain, email, userPassword, false);
  await expectSignedIn(plain, username);
  const plainCookies = (await third.cookies()).filter((c) => c.expires > 0);
  expect(plainCookies.some((c) => c.name === 'jdr_remember')).toBe(false);
  const fourth = await browser.newContext();
  await fourth.addCookies(plainCookies);
  const anonymous = await fourth.newPage();
  await anonymous.goto('/');
  await expect(anonymous).toHaveURL(/\/login$/);

  await Promise.all([second.close(), third.close(), fourth.close()]);
});
