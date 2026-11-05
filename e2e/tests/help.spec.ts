import { expect, test } from '@playwright/test';
import { resetRateLimits } from '../helpers/db';
import { main } from '../helpers/env';
import { createUser, signIn } from '../helpers/sessions';

/**
 * P13-2: the built-in help /aide is public (no account), searchable, reachable by section anchor
 * (`/aide?s=<id>` or `/aide#<id>`), lists the keyboard shortcuts, and the "?" links of the
 * screens open the right section. UI labels live in i18n/_pending until merged: controls are
 * found through data-testid, the content through its own text (Markdown files).
 */
test.beforeAll(() => {
  resetRateLimits(main.dbName);
});

test('anonymous visitor reads the help, searches it and follows an anchor', async ({ page }) => {
  await page.goto('/aide');
  await expect(page.getByTestId('help-page')).toBeVisible();
  await expect(page).toHaveURL(/\/aide$/); // not redirected to the login page
  await expect(page.getByRole('heading', { level: 2, name: /^Joueur/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: /Créer une map/ })).toBeAttached();
  await expect(page.getByTestId('footer-help')).toBeVisible();

  // Search: no accent, any case.
  await page.getByTestId('help-search').fill('BROUILLARD');
  await expect(page.getByTestId('help-results')).toBeVisible();
  await expect(page.getByTestId('help-results').getByRole('link').first()).toBeVisible();
  await page.getByTestId('help-search').fill('ecran de pause');
  await expect(page.getByTestId('help-results')).toContainText(/pause/i);
  await page.getByTestId('help-search').fill('zzzintrouvablezzz');
  await expect(page.getByTestId('help-results')).toBeVisible();
  await expect(page.getByTestId('help-results').getByRole('link')).toHaveCount(0);
  await page.getByTestId('help-search').fill('');
  await expect(page.getByTestId('help-results')).toHaveCount(0);

  // Shortcuts come from the real binding table.
  const table = page.getByTestId('help-shortcuts');
  await expect(table).toBeAttached();
  await expect(table.getByRole('row').nth(2)).toBeVisible();
});

test('a section anchor scrolls to its section (query and fragment forms)', async ({ page }) => {
  for (const url of ['/aide?s=mj-creer-une-map', '/aide#mj-creer-une-map']) {
    await page.goto(url);
    const section = page.locator('#mj-creer-une-map');
    await expect(section).toBeInViewport({ timeout: 10_000 });
    await expect(section.getByRole('heading', { level: 3 })).toBeFocused();
  }
});

test('a "?" link of a screen opens the matching help section', async ({ page, context }) => {
  const name = await createUser('Aide');
  await signIn(page, name);
  await page.goto('/');
  const link = page.getByTestId('help-link').first();
  await expect(link).toBeVisible();
  const anchor = await link.getAttribute('data-help-anchor');
  expect(anchor).toBeTruthy();
  const [popup] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await popup.waitForLoadState();
  await expect(popup.getByTestId('help-page')).toBeVisible();
  await expect(popup.locator(`#${anchor}`)).toBeInViewport({ timeout: 10_000 });
  // The header link is there for signed-in users too.
  await expect(page.getByTestId('nav-help')).toBeVisible();
});
