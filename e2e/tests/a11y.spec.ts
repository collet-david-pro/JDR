import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin } from '../helpers/app';
import { resetRateLimits } from '../helpers/db';
import { createDisplay } from '../helpers/sessions';
import { main } from '../helpers/env';
import {
  createGame,
  createMap,
  createSession,
  enterGame,
  joinSession,
  openUser,
  startSession,
} from '../helpers/sessions';

/**
 * P10f: automated accessibility audit (axe-core, WCAG 2.2 AA, canvas excluded) of the main pages and
 * dialogs, plus a keyboard-only walkthrough (projet.md 22). Zero serious/critical violation, and none
 * at all for the rules we control.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(() => {
  resetRateLimits(main.dbName);
});

async function audit(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).exclude('canvas').analyze();
  const lines = result.violations.map(
    (v) => `${v.impact} ${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(lines, `axe: ${label}`).toEqual([]);
}

test('anonymous pages', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  await audit(page, 'login');
  await page.goto('/register');
  await expect(page.locator('form')).toBeVisible();
  await audit(page, 'register');
  await page.goto('/forgot');
  await expect(page.locator('form')).toBeVisible();
  await audit(page, 'forgot');
  await page.goto('/display');
  await expect(page.getByTestId('display-code')).toBeVisible();
  await audit(page, 'display pairing');
  await page.goto('/une-page-qui-nexiste-pas');
  await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible();
  await audit(page, '404');
});

test('administration, library, home, update.php', async ({ page }) => {
  test.setTimeout(120_000);
  await loginAsAdmin(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Nouvelle partie' })).toBeVisible();
  await audit(page, 'home');
  await page.getByRole('button', { name: 'Nouvelle partie' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await audit(page, 'create game dialog');
  await page.keyboard.press('Escape');
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Importer des images' })).toBeVisible();
  await audit(page, 'library');
  await page.goto('/profile');
  await expect(page.locator('main h1, main h2').first()).toBeVisible();
  await audit(page, 'profile');
  for (const slug of ['', 'users', 'invitations', 'settings', 'library', 'diagnostic', 'audit', 'migrations', 'update', 'backup', 'integrity']) {
    await page.goto(slug === '' ? '/admin' : `/admin/${slug}`);
    await expect(page.getByRole('navigation', { name: "Sections de l'administration" })).toBeVisible();
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    await audit(page, `admin/${slug}`);
  }
  await page.goto('/update.php');
  await expect(page.locator('h1').first()).toBeVisible();
  await audit(page, 'update.php');
});

test('install.php (step 1)', async ({ page }) => {
  // The update server (8093) is not installed until update.spec.ts runs.
  const res = await page.goto('http://127.0.0.1:8093/install.php');
  test.skip(res === null || !res.ok(), 'install.php already consumed on this server');
  await expect(page.getByRole('heading', { name: 'Vérification du serveur' })).toBeVisible();
  await audit(page, 'install.php');
});

test('games, sessions, GM console, player, palette, dialogs', async ({ browser }) => {
  test.setTimeout(180_000);
  const gm = await openUser(browser, 'a11y-mj', { hook: false });
  const player = await openUser(browser, 'a11y-joueur', { hook: false });
  try {
    const gameId = await createGame(gm, [{ name: player.name }]);
    const map = await createMap(gm, gameId, 14, 10);
    const session = await createSession(gm, gameId, map.id);
    await joinSession(player, session.code);
    const g = gm.page;

    for (const tab of ['maps', 'tokens', 'players', 'sessions', 'settings']) {
      await g.goto(`/games/${gameId}?tab=${tab}`);
      await expect(g.getByRole('tab', { selected: true })).toBeVisible();
      await audit(g, `game tab ${tab}`);
    }

    await g.goto(`/sessions/${session.id}`);
    await expect(g.getByTestId('session-state')).toHaveAttribute('data-state', 'lobby');
    await audit(g, 'GM console (lobby)');
    const display = await createDisplay(gm, session.id);

    await player.page.goto(`/sessions/${session.id}`);
    await expect(player.page.getByTestId('play-lobby')).toBeVisible();
    await audit(player.page, 'player lobby');

    await startSession(gm, session.id);
    await enterGame(player.page, session.id);
    await audit(player.page, 'player view');

    await g.reload();
    await expect(g.getByTestId('console-viewport')).toHaveAttribute('data-scene', 'ready', { timeout: 45_000 });
    await audit(g, 'GM console (running)');
    await g.keyboard.press(await paletteShortcut(g));
    await expect(g.getByTestId('command-palette')).toBeVisible();
    await audit(g, 'command palette');
    await g.keyboard.press('Escape');
    await g.getByTestId('session-end').click();
    await expect(g.getByRole('dialog')).toBeVisible();
    await audit(g, 'confirm dialog');
    await g.keyboard.press('Escape');

    const anon = await browser.newContext({ baseURL: main.baseURL, locale: 'fr-FR' });
    const screen = await anon.newPage();
    await screen.goto(`/display?c=${display.code}`);
    await expect(screen.getByTestId('display-page')).toBeVisible();
    await audit(screen, 'display screen');
    await anon.close();
  } finally {
    await gm.context?.close();
    await player.context?.close();
  }
});

/** Same detection as the app (detectPlatform). */
async function paletteShortcut(page: Page): Promise<string> {
  const mac = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent);
  });
  return `${mac ? 'Meta' : 'Control'}+k`;
}

/** Presses Tab until `locator` has the focus (at most `max` presses). */
async function tabTo(page: Page, locator: ReturnType<Page['locator']>, max = 60, key = 'Tab'): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await locator.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press(key);
  }
  const at = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120));
  throw new Error(`focus never reached ${locator}; now on ${at}`);
}

/** The focused element draws a visible indicator (outline or box-shadow). */
async function expectFocusVisible(page: Page, label: string): Promise<void> {
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    const shadow = s.boxShadow !== 'none';
    return { match: el.matches(':focus-visible'), visible: outline || shadow };
  });
  expect(focused, `focus on ${label}`).not.toBeNull();
  expect(focused!.match, `:focus-visible on ${label}`).toBe(true);
  expect(focused!.visible, `focus indicator on ${label}`).toBe(true);
}

test('keyboard-only walkthrough: sign in, open a game, create a map, editor, palette, back', async ({ browser }) => {
  test.setTimeout(150_000);
  const user = await openUser(browser, 'a11y-clavier', { hook: false });
  const page = user.page;
  try {
    const gameId = await createGame(user, []);
    await page.goto('/');
    // Open the game from its link.
    const link = page.locator(`a[href$="/games/${gameId}"]`).first();
    await tabTo(page, link);
    await expectFocusVisible(page, 'game link');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/games/${gameId}$`));

    // Maps tab, new map, create.
    const mapsTab = page.getByRole('tab', { name: /Maps|Cartes/ });
    await tabTo(page, mapsTab);
    await expectFocusVisible(page, 'maps tab');
    await page.keyboard.press('Enter');
    const add = page.getByTestId('map-new');
    await tabTo(page, add);
    await expectFocusVisible(page, 'new map button');
    await page.keyboard.press('Enter');
    const name = page.getByTestId('map-create-form').locator('input').first();
    await tabTo(page, name);
    await expectFocusVisible(page, 'map name field');
    await page.keyboard.type('Crypte');
    const create = page.getByTestId('map-create');
    await tabTo(page, create);
    await expectFocusVisible(page, 'create map button');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('editor-viewport')).toHaveAttribute('data-state', /^(ready|unsupported|error)$/, {
      timeout: 30_000,
    });

    // Palette: open, focus is in the dialog, Escape closes and returns the focus.
    await page.keyboard.press(await paletteShortcut(page));
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('combobox')).toBeFocused();
    // Modal <dialog>: Tab cycles through the dialog (and the browser UI), never onto the page behind.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      const ok = await palette.evaluate((el) => {
        const active = document.activeElement;
        return el.closest('dialog')?.contains(active) === true || active === document.body;
      });
      expect(ok, 'focus never reaches the page behind').toBe(true);
    }
    await palette.getByRole('combobox').focus();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();

    // Back to the game through the keyboard.
    const back = page.locator("a.back");
    await tabTo(page, back, 60, 'Shift+Tab');
    await expectFocusVisible(page, 'back link');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/games/${gameId}`));
  } finally {
    await user.context?.close();
  }
});
