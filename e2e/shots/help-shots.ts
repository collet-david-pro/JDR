import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { AdminApi, loginAsAdmin } from '../helpers/app';
import { main, userPassword } from '../helpers/env';
import {
  assign,
  createDisplay,
  createGame,
  createMap,
  createSession,
  joinSession,
  placeOp,
  postOps,
  signIn,
  startSession,
  uid,
  waitInGame,
  type Actor,
} from '../helpers/sessions';

/**
 * Screenshots of the built-in help (P13-2), light theme, with demonstration data created by the
 * script itself. NOT part of the normal suite: the "help-shots" project exists only when
 * E2E_HELP_SHOTS=1.
 *
 * Regenerate (front built first, with the translations merged: cd frontend && npm run build):
 *   cd e2e && E2E_HELP_SHOTS=1 E2E_BROWSERS=chromium npx playwright test --project=help-shots
 * (on a machine shared with other runs: lockf /tmp/jdr-build.lock ...)
 *
 * Images go to frontend/src/help/img (override: HELP_SHOTS_DIR). They are converted to WebP with
 * `cwebp` when it is installed, and kept as PNG otherwise; the help finds them by file stem.
 * The same images feed the README (step 4b). Total budget: about 1.5 MB.
 */
const outDir =
  process.env.HELP_SHOTS_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/src/help/img');
const tmp = mkdtempSync(path.join(tmpdir(), 'jdr-shots-'));
mkdirSync(outDir, { recursive: true });

let hasCwebp = true;
try {
  execFileSync('cwebp', ['-version'], { stdio: 'ignore' });
} catch {
  hasCwebp = false;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(600);
  const png = path.join(tmp, `${name}.png`);
  await page.screenshot({ path: png });
  if (hasCwebp) {
    execFileSync('cwebp', ['-q', '80', '-m', '6', '-quiet', png, '-o', path.join(outDir, `${name}.webp`)]);
  } else {
    copyFileSync(png, path.join(outDir, `${name}.png`));
  }
}

async function actor(browser: Browser, name: string, width = 1280, height = 760): Promise<Actor> {
  const context = await browser.newContext({
    baseURL: main.baseURL,
    locale: 'fr-FR',
    colorScheme: 'light',
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  return signIn(page, name, context);
}

async function createAccount(username: string): Promise<void> {
  const api = await AdminApi.open(main.baseURL);
  await api.send('post', '/admin/users', {
    email: `${username.toLowerCase()}@example.test`,
    username,
    role: 'user',
    password: userPassword,
  });
  await api.close();
}

/** Ground cells of a map (tile blocks), as "x,y". */
async function groundCells(page: Page, mapId: string): Promise<Set<string>> {
  const res = await page.request.get(`/api/v1/maps/${mapId}/chunks`);
  const bytes = Buffer.from(await res.body());
  const out = new Set<string>();
  let o = 0;
  while (o < bytes.length) {
    const cx = bytes.readUInt16LE(o);
    const cy = bytes.readUInt16LE(o + 2);
    const layer = bytes.readUInt8(o + 4);
    const len = bytes.readUInt32LE(o + 5);
    if (layer === 0) {
      const raw = inflateRawSync(bytes.subarray(o + 9, o + 9 + len));
      for (let i = 0; i < 1024; i++) {
        if (raw.readUInt16LE(8 + i * 4) !== 0) out.add(`${cx * 32 + (i % 32)},${cy * 32 + Math.floor(i / 32)}`);
      }
    }
    o += 9 + len;
  }
  return out;
}

test('help screenshots', async ({ browser }) => {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  // --- Anonymous pages -------------------------------------------------------------------
  {
    const context = await browser.newContext({
      baseURL: main.baseURL,
      locale: 'fr-FR',
      colorScheme: 'light',
      viewport: { width: 1100, height: 600 },
    });
    const page = await context.newPage();
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, 'connexion');
    await page.setViewportSize({ width: 1000, height: 560 });
    await page.goto('/display');
    await expect(page.getByTestId('display-pair-form')).toBeVisible();
    await shot(page, 'ecran-appairage');
    await context.close();
  }

  // --- Demonstration data ------------------------------------------------------------------
  for (const name of ['Elodie', 'Bastien', 'Maelys', 'Thibault']) await createAccount(name);
  const gm = await actor(browser, 'Elodie');
  const bastien = await actor(browser, 'Bastien', 1280, 760);
  const maelys = await actor(browser, 'Maelys', 1280, 760);
  const other = await actor(browser, 'Thibault', 800, 600);

  const gameId = await createGame(gm, [{ name: 'Bastien' }, { name: 'Maelys' }]);
  await gm.request.patch(`/api/v1/games/${gameId}`, { headers: gm.headers, data: { name: 'La Crypte oubliée' } });
  await createGame(other, [{ name: 'Elodie' }]);

  // Tokens with the images of the base pack.
  const assets = await (await gm.request.get('/api/v1/assets?scope=general&kind=token&limit=100')).json();
  const byName = new Map<string, string>(
    (assets.data as Array<{ id: string; name: string }>).map((a) => [a.name, String(a.id)]),
  );
  async function token(name: string, kind: 'pc' | 'npc', owner: string | null, ring: string | null): Promise<string> {
    const res = await gm.request.post(`/api/v1/games/${gameId}/tokens`, {
      headers: gm.headers,
      data: {
        name,
        asset_id: byName.get(name) ?? null,
        kind,
        size_w: 1,
        size_h: 1,
        default_owner_user_id: owner,
        vision: { enabled: true, range: kind === 'pc' ? 8 : 6, dark: 0 },
        light: null,
        ring_color: ring,
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const id = String((await res.json()).data.id);
    return id;
  }
  const guerrier = await token('Guerrier', 'pc', bastien.id, '#2b6cb0');
  const magicienne = await token('Magicienne', 'pc', maelys.id, '#805ad5');
  await token('Voleur', 'pc', null, '#2f855a');
  const monsters = [] as string[];
  for (const n of ['Gobelin', 'Squelette', 'Loup']) if (byName.has(n)) monsters.push(await token(n, 'npc', null, '#c53030'));

  // Maps: the first one is generated through the editor.
  const crypte = await createMap(gm, gameId, 60, 60);
  await gm.request.patch(`/api/v1/maps/${crypte.id}`, { headers: gm.headers, data: { name: 'La Crypte' } }).catch(() => undefined);
  await createMap(gm, gameId, 30, 30);
  await createMap(gm, gameId, 40, 30);

  // --- Editor: generation panel, then the generated dungeon --------------------------------
  const page = gm.page;
  await page.setViewportSize({ width: 1360, height: 800 });
  await page.goto(`/games/${gameId}/maps/${crypte.id}/edit`);
  const viewport = page.getByTestId('editor-viewport');
  await expect(viewport).toHaveAttribute('data-state', 'ready', { timeout: 40_000 });
  await page.getByTestId('editor-generate').click();
  await expect(page.getByTestId('generate-panel')).toBeVisible();
  await page.getByTestId('gen-seed').fill('or-07');
  await expect(page.getByTestId('gen-preview')).toHaveAttribute('data-state', 'ready', { timeout: 40_000 });
  await shot(page, 'editeur-generer');
  await page.getByTestId('gen-apply').click();
  await expect.poll(async () => (await groundCells(page, crypte.id)).size, { timeout: 40_000 }).toBeGreaterThan(100);
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
  await page.getByTestId('generate-close').click();
  await page.mouse.click(700, 450);
  await page.keyboard.press(`${mod}+1`);
  await page.keyboard.press('Escape');
  await shot(page, 'editeur');

  // --- Tokens on the map, session ----------------------------------------------------------
  const cells = await groundCells(page, crypte.id);
  let start: [number, number] | null = null;
  let best = Infinity;
  for (const c of cells) {
    const [x, y] = c.split(',').map(Number) as [number, number];
    const ok = [0, 1, 2, 3].every((dx) => [0, 1].every((dy) => cells.has(`${x + dx},${y + dy}`)));
    const d = Math.hypot(x - 30, y - 30);
    if (ok && d < best) {
      best = d;
      start = [x, y];
    }
  }
  expect(start).not.toBeNull();
  const [sx, sy] = start as [number, number];
  const detail = await (await page.request.get(`/api/v1/maps/${crypte.id}`)).json();
  const floor = String(detail.data.floors[0].id);
  const ops = [guerrier, magicienne, ...monsters].map((id, i) =>
    placeOp(floor, uid(), id, [sx + (i % 4) + 0.5, sy + Math.floor(i / 4) + 0.5]),
  );
  await postOps(gm, { id: crypte.id, floor }, ops);

  const session = await createSession(gm, gameId, crypte.id);
  await joinSession(bastien, session.code);
  await joinSession(maelys, session.code);
  await assign(gm, session.id, guerrier, bastien.id);
  await assign(gm, session.id, magicienne, maelys.id);
  await startSession(gm, session.id);

  await page.goto(`/sessions/${session.id}`);
  await expect(page.getByTestId('session-console')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await shot(page, 'seance-console-mj');

  await bastien.page.goto(`/sessions/${session.id}`);
  await waitInGame(bastien.page);
  await bastien.page.waitForTimeout(3000);
  await shot(bastien.page, 'seance-vue-joueur');

  await createDisplay(gm, session.id, 'Table');
  await page.getByTestId('panel-tab-displays').click();
  await expect(page.getByTestId('displays-panel')).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, 'console-ecrans');

  // --- Dashboard, game tabs, library, profile ---------------------------------------------
  await page.setViewportSize({ width: 1180, height: 700 });
  await page.goto('/');
  await expect(page.getByRole('link', { name: /La Crypte/ }).first()).toBeVisible();
  await shot(page, 'tableau-de-bord');
  await page.goto(`/games/${gameId}?tab=maps`);
  await expect(page.getByRole('tab', { selected: true })).toBeVisible();
  await shot(page, 'partie-maps');
  await page.goto(`/games/${gameId}?tab=tokens`);
  await page.waitForTimeout(1500);
  await shot(page, 'partie-tokens');
  await page.goto('/library');
  await page.getByLabel('Bibliothèque', { exact: true }).selectOption('general');
  await page.waitForTimeout(2500);
  await shot(page, 'bibliotheque');
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, 'profil');

  // --- Administration ------------------------------------------------------------------------
  const adminContext = await browser.newContext({
    baseURL: main.baseURL,
    locale: 'fr-FR',
    colorScheme: 'light',
    viewport: { width: 1180, height: 720 },
  });
  const admin = await adminContext.newPage();
  await loginAsAdmin(admin);
  for (const [slug, name] of [
    ['', 'admin-tableau-de-bord'],
    ['users', 'admin-comptes'],
    ['settings', 'admin-reglages'],
    ['update', 'admin-mise-a-jour'],
  ] as const) {
    await admin.goto(slug === '' ? '/admin' : `/admin/${slug}`);
    await admin.waitForTimeout(1500);
    await shot(admin, name);
  }
  await adminContext.close();
});
