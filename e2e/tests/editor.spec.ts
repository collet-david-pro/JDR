import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdminApi, login } from '../helpers/app';
import { resetRateLimits } from '../helpers/db';
import { main, unique, userPassword } from '../helpers/env';

/**
 * Map editor (projet.md 15), on a map created from the Maps tab: the page and its controls are found through
 * data-testid / aria attributes so that the scenario does not depend on the editor texts
 * (i18n/_pending/editor.json until merged into fr.json).
 *
 * WebGPU / WebGL 2 in headless browsers: when the engine reports "unsupported", the scenario
 * is skipped for that browser (the incompatibility page itself is then checked).
 */

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../tests/fixtures/uploads',
);

test.beforeAll(() => {
  resetRateLimits(main.dbName);
});

/** Console errors and uncaught exceptions of a page. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

async function createUser(username: string): Promise<void> {
  const api = await AdminApi.open(main.baseURL);
  await api.send('post', '/admin/users', {
    email: `${username.toLowerCase()}@example.test`,
    username,
    role: 'user',
    password: userPassword,
  });
  await api.close();
}

async function uploadTile(page: Page): Promise<void> {
  await page.goto('/library');
  await page.locator('section.upload').getByLabel('Type').selectOption('tile');
  await page.locator('input[type="file"]').setInputFiles(path.join(fixtures, 'valid_png_opaque.png'));
  await expect(page.locator('ul.queue li.item-done')).toHaveCount(1, { timeout: 20_000 });
}

/** Creates a map from the Maps tab of the game (the editor opens); false when no GPU. */
async function openNewMap(page: Page, gameId: string, width: number, height: number): Promise<boolean> {
  // Already on the game page (just created): no reload while its chunks are still loading.
  if (new URL(page.url()).pathname !== `/games/${gameId}`) await page.goto(`/games/${gameId}?tab=maps`);
  await page.getByTestId('map-new').click();
  const form = page.getByTestId('map-create-form');
  await expect(form).toBeVisible();
  await form.locator('input[name="name"]').fill(unique('Map '));
  await form.locator('input[name="width"]').fill(String(width));
  await form.locator('input[name="height"]').fill(String(height));
  await page.getByTestId('map-create').click();
  await expect(page).toHaveURL(new RegExp(`/games/${gameId}/maps/\\d+/edit$`));
  const viewport = page.getByTestId('editor-viewport');
  await expect(viewport).toHaveAttribute('data-state', /^(ready|unsupported|error)$/, {
    timeout: 30_000,
  });
  const state = await viewport.getAttribute('data-state');
  if (state === 'unsupported') {
    await expect(page.getByTestId('engine-unsupported')).toBeVisible();
    return false;
  }
  expect(state).toBe('ready');
  await expect(page.getByTestId('status-renderer')).toHaveAttribute('data-renderer', /webgpu|webgl/);
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', {
    timeout: 15_000,
  });
  return true;
}

async function addTileFromLibrary(page: Page): Promise<void> {
  await page.getByTestId('palette-add').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('button.tile').first()).toBeVisible({ timeout: 10_000 });
  await dialog.locator('button.tile').first().click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('palette-item-1')).toHaveAttribute('aria-pressed', 'true');
}

async function historyCount(page: Page): Promise<string | null> {
  return page.getByTestId('status-history').getAttribute('data-count');
}

/** Canvas pixels without the tool preview (pointer moved off the map). */
async function mapShot(page: Page): Promise<Buffer> {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(150);
  return page.getByTestId('editor-viewport').screenshot();
}

test('GM paints on a map: palette, brush, undo/redo, layers, fill limit', async ({
  page,
  browserName,
}) => {
  const errors = watchErrors(page);
  // A dedicated GM (the tile goes to their own library, not the admin's).
  const gm = unique('Cartographe');
  await createUser(gm);
  await login(page, gm, userPassword);
  await uploadTile(page);

  // New game from the dashboard ⇒ Maps tab ⇒ new map ⇒ editor.
  await page.goto('/');
  await page.getByRole('button', { name: 'Nouvelle partie' }).click();
  await page.locator('input[name="name"]').fill(unique('Carte '));
  await page.getByRole('button', { name: 'Créer la partie' }).click();
  await expect(page).toHaveURL(/\/games\/\d+/);
  const game = { id: new URL(page.url()).pathname.split('/').pop() as string };
  const ready = await openNewMap(page, game.id, 60, 40);
  test.skip(!ready, `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`);

  await addTileFromLibrary(page);
  await expect(page.getByTestId('tool-brush')).toHaveAttribute('aria-pressed', 'true');

  // Paint a stroke in the middle of the map.
  const box = (await page.getByTestId('editor-viewport').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const before = await mapShot(page);
  await page.mouse.move(cx, cy);
  await expect(page.getByTestId('status-cell')).not.toHaveText(/—/);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy, { steps: 6 });
  await page.mouse.move(cx + 120, cy + 60, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => historyCount(page)).toBe('1');
  await expect.poll(async () => (await mapShot(page)).equals(before)).toBe(false);
  const painted = await mapShot(page);
  // Optional captures for the phase report: E2E_SHOTS=/some/dir.
  const shots = process.env.E2E_SHOTS;
  if (shots !== undefined) {
    await page.screenshot({ path: path.join(shots, `editor-${browserName}.png`) });
  }

  // Undo / redo (buttons and keyboard).
  await page.getByTestId('editor-undo').click();
  await expect.poll(() => historyCount(page)).toBe('0');
  await expect(page.getByTestId('editor-redo')).toBeEnabled();
  await expect.poll(async () => (await mapShot(page)).equals(painted)).toBe(false);
  await page.getByTestId('editor-redo').click();
  await expect.poll(() => historyCount(page)).toBe('1');
  // Same platform detection as the page (src/editor/shortcuts.ts): Cmd on Apple, Ctrl elsewhere.
  const mod = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const s = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
    return /mac|iphone|ipad|ipod/i.test(s) ? 'Meta' : 'Control';
  });
  await page.getByTestId('editor-viewport').focus();
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(() => historyCount(page)).toBe('0');
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect.poll(() => historyCount(page)).toBe('1');

  // Active layer with the keyboard (2 = terrain), then hide the ground layer.
  await page.keyboard.press('2');
  await expect(page.getByTestId('layer-activate-terrain')).toHaveAttribute('aria-pressed', 'true');
  const visible = page.getByTestId('layer-visible-ground');
  await expect(visible).toHaveAttribute('aria-pressed', 'true');
  await visible.click();
  await expect(visible).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => historyCount(page)).toBe('2');
  await expect.poll(async () => (await mapShot(page)).equals(painted)).toBe(false);

  // Shortcuts are ignored while typing in a field; ? opens the help.
  await page.getByTestId('editor-viewport').focus();
  await page.keyboard.press('?');
  await expect(page.getByTestId('editor-help-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('editor-help-dialog')).toBeHidden();

  // Fill limited to 50 000 cells: refused on an empty 250 × 250 map, with an announcement.
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', {
    timeout: 15_000,
  });
  expect(await openNewMap(page, game.id, 250, 250)).toBe(true);
  await addTileFromLibrary(page);
  await page.getByTestId('tool-fill').click();
  const box2 = (await page.getByTestId('editor-viewport').boundingBox())!;
  await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await expect(page.getByTestId('editor-notice')).not.toHaveText('');
  expect(await historyCount(page)).toBe('0');

  expect(errors).toEqual([]);
});

test('a player cannot open the editor of a game', async ({ page }) => {
  const player = unique('Joueur');
  await createUser(player);
  const api = await AdminApi.open(main.baseURL);
  const game = (await api.send('post', '/games', { name: unique('Secret ') })).data;
  await api.send('post', `/games/${game.id}/members`, { identifier: player });
  const map = (await api.send('post', `/games/${game.id}/maps`, { name: 'Secret', width: 10, height: 10 })).data;
  await api.close();

  await login(page, player, userPassword);
  await page.goto(`/games/${game.id}/maps/${map.id}/edit`);
  await expect(page.getByRole('heading', { name: 'Accès refusé' })).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveCount(0);
});
