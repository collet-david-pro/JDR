import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAsAdmin } from '../helpers/app';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/uploads');

test('upload valid images, refuse a trapped file, show signed thumbnails', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Importer des images' })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles([
    path.join(fixtures, 'valid_png_transparent.png'),
    path.join(fixtures, 'valid_gif_animated.gif'),
    path.join(fixtures, 'trap_polyglot_png_php.png'),
  ]);

  const queue = page.locator('ul.queue');
  await expect(queue.locator('li.item-done')).toHaveCount(2, { timeout: 20_000 });
  await expect(queue.locator('li.item-error')).toHaveCount(1);
  await expect(queue.locator('li.item-error')).toContainText('trap_polyglot_png_php.png');

  const grid = page.locator('ul.grid');
  await expect(grid.locator('.tile')).toHaveCount(2, { timeout: 10_000 });
  await expect(grid.locator('.badge-anim')).toHaveCount(1);

  // Thumbnails are served through signed /files URLs and must actually decode.
  const thumbs = grid.locator('img');
  await expect(thumbs).toHaveCount(2);
  for (const img of await thumbs.all()) {
    await expect(img).toHaveJSProperty('complete', true);
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  }

  // A tampered signature is refused.
  const src = await thumbs.first().getAttribute('src');
  expect(src).toBeTruthy();
  const url = new URL(src as string, page.url());
  const sig = url.searchParams.get('s') ?? '';
  url.searchParams.set('s', (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1));
  const forged = url.toString();
  const res = await page.request.get(forged);
  expect(res.status()).toBe(403);
});
