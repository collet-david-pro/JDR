import { expect, test, type Browser, type Page } from '@playwright/test';
import { AdminApi, login } from '../helpers/app';
import { resetRateLimits } from '../helpers/db';
import { main, unique, userPassword } from '../helpers/env';

/** Guided tours: the config turns them off everywhere; this file turns them back on. */
const toursOn = { cookies: [], origins: [] };

test.beforeAll(() => {
  resetRateLimits(main.dbName);
});

async function signedIn(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: main.baseURL, locale: 'fr-FR', storageState: toursOn });
  const page = await context.newPage();
  await login(page, username, userPassword);
  return page;
}

test('the home tour shows once per account, skips with Escape and comes back from the profile', async ({
  browser,
}) => {
  const username = unique('Visite');
  const api = await AdminApi.open(main.baseURL);
  await api.send('post', '/admin/users', {
    email: `${username.toLowerCase()}@example.test`,
    username,
    role: 'user',
    password: userPassword,
  });
  await api.close();

  // First visit: the tour starts on its own, the first step is centred.
  const page = await signedIn(browser, username);
  const tour = page.getByTestId('tour');
  await expect(tour).toBeVisible();
  await expect(tour).toHaveAttribute('data-tour-id', 'home');
  await expect(tour.getByRole('heading', { name: 'Bienvenue sur Clairvoie' })).toBeVisible();
  await expect(page.getByTestId('tour-progress')).toHaveText('Étape 1 sur 6');
  await expect(page.getByTestId('tour-next')).toBeFocused();

  // Next and previous; the step lights its section.
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-progress')).toHaveText('Étape 2 sur 6');
  await expect(tour.getByRole('heading', { name: 'Vos parties de MJ' })).toBeVisible();
  await page.getByTestId('tour-previous').click();
  await expect(page.getByTestId('tour-progress')).toHaveText('Étape 1 sur 6');

  // Escape skips it: closed, and not offered again, even on another device.
  await page.keyboard.press('Escape');
  await expect(tour).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Rejoindre une séance' })).toBeVisible();
  await page.waitForTimeout(400);
  await expect(tour).toBeHidden();
  const other = await signedIn(browser, username);
  await expect(other.getByRole('heading', { name: 'Rejoindre une séance' })).toBeVisible();
  await other.waitForTimeout(400);
  await expect(other.getByTestId('tour')).toBeHidden();
  await other.context().close();

  // Profile: every tour offered again; walking to the end closes it.
  await page.getByRole('link', { name: 'Profil' }).click();
  await page.getByTestId('profile-tours-reset').click();
  await expect(page.getByTestId('profile-tours-done')).toBeVisible();
  await page.getByRole('link', { name: 'Tableau de bord' }).click();
  await expect(tour).toBeVisible();
  for (let step = 1; step < 6; step += 1) await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-progress')).toHaveText('Étape 6 sur 6');
  await expect(page.getByTestId('tour-skip')).toHaveCount(0);
  await page.getByTestId('tour-next').click();
  await expect(tour).toBeHidden();
  await page.context().close();
});
