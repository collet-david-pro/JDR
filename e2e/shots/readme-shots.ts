import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { AdminApi, loginAsAdmin } from '../helpers/app';
import { openScreen, pairByForm, patchSettings, waitScene } from '../helpers/displays';
import { main, userPassword } from '../helpers/env';
import {
  act,
  assign,
  createDisplay,
  placeOp,
  postOps,
  signIn,
  uid,
  waitInGame,
  type Actor,
  type MapRef,
} from '../helpers/sessions';

/**
 * Screenshots and animation of the README (P13-4b ter), light theme, with a demonstration
 * campaign built by the script itself: "La Crypte de Valombre", a hand-drawn crypt (rooms,
 * walls, doors, a secret door, torches, candles, a magic light, darkness), four players, a
 * session explored live, a projection screen, plus four generated maps and the three styles.
 * NOT part of the normal suite: the "readme-shots" project exists only when E2E_README_SHOTS=1.
 *
 * Regenerate (front built first, with the translations merged: cd frontend && npm run build):
 *   cd e2e && E2E_README_SHOTS=1 E2E_BROWSERS=chromium npx playwright test --project=readme-shots
 * (on a machine shared with other runs: lockf /tmp/jdr-build.lock ...)
 *
 * Images go to docs/img (override: README_SHOTS_DIR), as WebP: `cwebp` is required, and
 * `img2webp` for the animation (both from the libwebp tools). Composite images (hero, phones,
 * screen on the table) are laid out in a blank page from the real screenshots, with transparent
 * corners so that they read on the light and dark GitHub themes. The four generated maps are the
 * editor's own PNG export, reduced. Budget: 2.5 MB for docs/img (about 1.3 MB today).
 * Long sections are isolated: one that fails is reported at the end, the others still run.
 */
const outDir =
  process.env.README_SHOTS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/img');
const tmp = mkdtempSync(path.join(tmpdir(), 'jdr-readme-'));
mkdirSync(outDir, { recursive: true });

// --- Image helpers ---------------------------------------------------------------------------

function toWebp(png: string, name: string, quality: number): void {
  const out = path.join(outDir, `${name}.webp`);
  try {
    execFileSync('cwebp', ['-q', String(quality), '-m', '6', '-alpha_q', '90', '-quiet', png, '-o', out]);
  } catch {
    copyFileSync(png, path.join(outDir, `${name}.png`));
  }
}

/** Screenshot of the page (or of one element) kept as PNG in the temp folder. */
async function raw(target: Page | ReturnType<Page['locator']>, name: string, settle = 600): Promise<string> {
  const page = 'goto' in target ? target : target.page();
  await page.waitForTimeout(settle);
  const png = path.join(tmp, `${name}.png`);
  await target.screenshot({ path: png });
  return png;
}

async function shot(target: Page | ReturnType<Page['locator']>, name: string, quality = 78): Promise<string> {
  const png = await raw(target, name);
  toWebp(png, name, quality);
  return png;
}

const dataUrl = (png: string): string => `data:image/png;base64,${readFileSync(png).toString('base64')}`;

/** Lays out real screenshots in a blank page (no app involved) and saves the result. */
async function compose(
  browser: Browser,
  name: string,
  size: { width: number; height: number },
  html: string,
  quality = 80,
): Promise<void> {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
      html, body { margin: 0; background: transparent; }
      body { font: 600 15px/1.3 -apple-system, "Segoe UI", Roboto, sans-serif; }
      .card { position: absolute; inset: 0; border-radius: 28px; overflow: hidden;
        background: radial-gradient(120% 90% at 85% 15%, #4b3a7a 0%, rgba(75,58,122,0) 55%),
          radial-gradient(90% 80% at 10% 100%, #7a4a22 0%, rgba(122,74,34,0) 60%),
          linear-gradient(135deg, #191427 0%, #231c3d 55%, #1c1626 100%); }
      .window { position: absolute; border-radius: 12px; overflow: hidden; background: #fff;
        box-shadow: 0 30px 60px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.08); }
      .window .bar { height: 30px; background: #eceef2; display: flex; align-items: center; gap: 7px; padding: 0 12px; }
      .window .bar i { width: 11px; height: 11px; border-radius: 50%; background: #d8dbe2; display: block; }
      .window .bar i:nth-child(1) { background: #ff6159; } .window .bar i:nth-child(2) { background: #ffbd2e; }
      .window .bar i:nth-child(3) { background: #28c941; }
      .window .bar span { margin-left: 14px; flex: 1; height: 18px; border-radius: 6px; background: #fff;
        color: #6b7280; font: 500 11px/18px -apple-system, "Segoe UI", sans-serif; padding-left: 10px; }
      .window img, .device img { display: block; width: 100%; }
      .device { position: absolute; background: #0d0d12; padding: 12px; border-radius: 44px;
        box-shadow: 0 30px 60px rgba(0,0,0,.55), inset 0 0 0 2px #2b2b35; }
      .device img { border-radius: 32px; }
      .tablet { border-radius: 30px; padding: 22px; }
      .tablet img { border-radius: 10px; }
      .label { position: absolute; color: #f4efe6; letter-spacing: .02em; text-shadow: 0 2px 6px rgba(0,0,0,.5);
        background: rgba(15,12,25,.55); border: 1px solid rgba(255,255,255,.14); padding: 6px 12px; border-radius: 999px; }
    </style></head><body>${html}</body></html>`,
  );
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  const png = path.join(tmp, `${name}.png`);
  await page.screenshot({ path: png, omitBackground: true });
  toWebp(png, name, quality);
  await context.close();
}

/** Animated WebP from PNG frames (durations in ms). */
function animate(name: string, frames: Array<{ png: string; ms: number }>, quality = 60): void {
  const args: string[] = ['-loop', '0', '-min_size'];
  for (const f of frames) args.push('-lossy', '-q', String(quality), '-m', '6', '-d', String(f.ms), f.png);
  args.push('-o', path.join(outDir, `${name}.webp`));
  execFileSync('img2webp', args, { stdio: 'ignore' });
}

// --- Demonstration data ----------------------------------------------------------------------

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

interface ActorOptions {
  width?: number;
  height?: number;
  mobile?: boolean;
}

async function actor(browser: Browser, name: string, o: ActorOptions = {}): Promise<Actor> {
  const context = await browser.newContext({
    baseURL: main.baseURL,
    locale: 'fr-FR',
    colorScheme: 'light',
    viewport: { width: o.width ?? 1280, height: o.height ?? 760 },
    deviceScaleFactor: o.mobile ? 2 : 1,
    isMobile: o.mobile ?? false,
    hasTouch: o.mobile ?? false,
  });
  const page = await context.newPage();
  return signIn(page, name, context);
}

async function ok<T = any>(res: Awaited<ReturnType<Actor['request']['get']>>): Promise<T> {
  expect(res.ok(), `${res.url()} -> ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? (undefined as T) : ((await res.json()).data as T);
}

/** Deterministic pseudo-random numbers (tile rotations): the same pictures on every run. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- The crypt: hand-drawn rooms, walls, doors, lights ------------------------------------------

type Rect = [number, number, number, number]; // x0, y0, x1, y1 (cells, inclusive)

const CRYPT = { width: 34, height: 21 };
const ROOMS: Array<{ id: string; rect: Rect; floor: string }> = [
  { id: 'hall', rect: [2, 7, 9, 14], floor: 'floor.flagstone' },
  { id: 'corridor', rect: [10, 10, 14, 11], floor: 'floor.stone' },
  { id: 'crypt', rect: [15, 4, 23, 17], floor: 'floor.stone' },
  { id: 'arch', rect: [24, 15, 24, 16], floor: 'floor.stone' },
  { id: 'lair', rect: [25, 12, 32, 19], floor: 'floor.cave' },
  { id: 'passage', rect: [24, 6, 24, 7], floor: 'floor.stone' },
  { id: 'chapel', rect: [25, 3, 31, 9], floor: 'floor.cobble' },
  { id: 'niche', rect: [5, 6, 6, 6], floor: 'floor.flagstone' },
  { id: 'treasure', rect: [3, 2, 8, 5], floor: 'floor.flagstone' },
];
/** Room pairs joined without a wall (arches). */
const OPEN = [
  ['crypt', 'arch'],
  ['arch', 'lair'],
  ['crypt', 'passage'],
  ['niche', 'treasure'],
];
/** Doors: an edge of the grid (vertical when a[0] === b[0]). */
const DOORS = {
  hall: { a: [10, 10], b: [10, 12], secret: false, locked: false },
  crypt: { a: [15, 10], b: [15, 12], secret: false, locked: false },
  chapel: { a: [25, 6], b: [25, 8], secret: false, locked: true },
  niche: { a: [5, 7], b: [7, 7], secret: true, locked: false },
} as const;
const DECOR: Array<[number, number, string]> = [
  [3, 8, 'decor.stairs_up'],
  [8, 8, 'decor.barrel'],
  [8, 9, 'decor.crate'],
  [2, 14, 'decor.rubble'],
  [5, 11, 'decor.rug'],
  [17, 7, 'decor.sarcophagus'],
  [17, 10, 'decor.sarcophagus'],
  [17, 13, 'decor.sarcophagus'],
  [21, 7, 'decor.sarcophagus'],
  [21, 10, 'decor.sarcophagus'],
  [21, 13, 'decor.sarcophagus'],
  [19, 5, 'decor.altar'],
  [15, 17, 'decor.web'],
  [23, 4, 'decor.web'],
  [22, 16, 'decor.rubble'],
  [26, 13, 'decor.web'],
  [32, 19, 'decor.web'],
  [25, 19, 'decor.web'],
  [29, 14, 'decor.rock'],
  [27, 18, 'decor.mushroom'],
  [31, 13, 'decor.mushroom'],
  [31, 17, 'decor.chest'],
  [28, 17, 'decor.rubble'],
  [28, 4, 'decor.altar'],
  [26, 8, 'decor.table'],
  [30, 8, 'decor.barrel'],
  [4, 3, 'decor.chest'],
  [7, 3, 'decor.chest'],
];
interface LightSpec {
  at: [number, number];
  radius: number;
  dim: number;
  color: string;
  intensity: number;
  flicker: { type: 'none' | 'torch' | 'pulse'; amp: number; speed: number };
}
const torch = (x: number, y: number): LightSpec => ({
  at: [x, y],
  radius: 2,
  dim: 5.5,
  color: '#ffb35c',
  intensity: 0.9,
  flicker: { type: 'torch', amp: 0.25, speed: 2 },
});
const candle = (x: number, y: number): LightSpec => ({
  at: [x, y],
  radius: 1,
  dim: 2.5,
  color: '#ffc46b',
  intensity: 0.75,
  flicker: { type: 'torch', amp: 0.3, speed: 3 },
});
const LIGHTS: LightSpec[] = [
  torch(2.4, 8.6),
  torch(9.6, 13.4),
  candle(18.2, 7.5),
  candle(18.2, 10.5),
  candle(18.2, 13.5),
  candle(20.8, 7.5),
  candle(20.8, 10.5),
  candle(20.8, 13.5),
  { at: [19.5, 5.6], radius: 2.5, dim: 6, color: '#8fb8ff', intensity: 0.85, flicker: { type: 'pulse', amp: 0.3, speed: 0.5 } },
  { at: [28.5, 6], radius: 3, dim: 7, color: '#ff6a3a', intensity: 1, flicker: { type: 'torch', amp: 0.35, speed: 2.5 } },
  { at: [27.5, 18.5], radius: 1, dim: 3, color: '#7dffb0', intensity: 0.7, flicker: { type: 'pulse', amp: 0.2, speed: 0.4 } },
  { at: [31.5, 13.5], radius: 1, dim: 3, color: '#7dffb0', intensity: 0.7, flicker: { type: 'pulse', amp: 0.2, speed: 0.4 } },
];

function regionGrid(): string[][] {
  const g: string[][] = [];
  for (let y = 0; y < CRYPT.height; y++) g.push(new Array<string>(CRYPT.width).fill(''));
  for (const r of ROOMS) {
    const [x0, y0, x1, y1] = r.rect;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y]![x] = r.id;
  }
  return g;
}

/** Wall segments: edges between two different rooms (or a room and the void), minus doors and arches. */
function wallSegments(): Array<[[number, number], [number, number]]> {
  const g = regionGrid();
  const at = (x: number, y: number): string => g[y]?.[x] ?? '';
  const open = (a: string, b: string): boolean => OPEN.some(([p, q]) => (p === a && q === b) || (p === b && q === a));
  const isDoor = (vertical: boolean, line: number, from: number): boolean =>
    Object.values(DOORS).some((d) => {
      const v = d.a[0] === d.b[0];
      if (v !== vertical) return false;
      if (v) return d.a[0] === line && from >= Math.min(d.a[1], d.b[1]) && from < Math.max(d.a[1], d.b[1]);
      return d.a[1] === line && from >= Math.min(d.a[0], d.b[0]) && from < Math.max(d.a[0], d.b[0]);
    });
  const vertical = new Map<number, number[]>();
  const horizontal = new Map<number, number[]>();
  for (let y = -1; y <= CRYPT.height; y++) {
    for (let x = -1; x <= CRYPT.width; x++) {
      const here = at(x, y);
      const right = at(x + 1, y);
      const below = at(x, y + 1);
      if (here !== right && !open(here, right) && !isDoor(true, x + 1, y) && y >= 0 && y < CRYPT.height) {
        vertical.set(x + 1, [...(vertical.get(x + 1) ?? []), y]);
      }
      if (here !== below && !open(here, below) && !isDoor(false, y + 1, x) && x >= 0 && x < CRYPT.width) {
        horizontal.set(y + 1, [...(horizontal.get(y + 1) ?? []), x]);
      }
    }
  }
  const out: Array<[[number, number], [number, number]]> = [];
  const merge = (lines: Map<number, number[]>, make: (line: number, a: number, b: number) => void): void => {
    for (const [line, units] of lines) {
      const sorted = [...new Set(units)].sort((p, q) => p - q);
      let start = sorted[0]!;
      let prev = start;
      for (const u of sorted.slice(1)) {
        if (u !== prev + 1) {
          make(line, start, prev + 1);
          start = u;
        }
        prev = u;
      }
      make(line, start, prev + 1);
    }
  };
  merge(vertical, (x, a, b) => out.push([[x, a], [x, b]]));
  merge(horizontal, (y, a, b) => out.push([[a, y], [b, y]]));
  return out;
}

interface Crypt extends MapRef {
  doors: Record<keyof typeof DOORS, string>;
  tokens: Record<string, string>;
}

async function buildCrypt(gm: Actor, gameId: string, defs: Record<string, string>): Promise<Crypt> {
  const created = await ok(
    await gm.request.post(`/api/v1/games/${gameId}/maps`, {
      headers: gm.headers,
      data: { name: 'La Crypte de Valombre', width: CRYPT.width, height: CRYPT.height, folder: 'Acte 1' },
    }),
  );
  const detail = await ok(await gm.request.get(`/api/v1/maps/${created.id}`));
  const map: MapRef = { id: String(created.id), floor: String(detail.floors[0].id) };
  const pack = await ok(await gm.request.get('/api/v1/procgen/pack'));
  const keys = [...new Set([...ROOMS.map((r) => r.floor), ...DECOR.map((d) => d[2])])];
  const index = new Map(keys.map((k, i) => [k, i + 1]));
  const rnd = prng(7);
  const ground: number[][] = [];
  for (const r of ROOMS) {
    const [x0, y0, x1, y1] = r.rect;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) ground.push([x, y, index.get(r.floor)!, 0, Math.floor(rnd() * 16)]);
    }
  }
  const decor = DECOR.map(([x, y, k]) => [x, y, index.get(k)!, 0, k === 'decor.sarcophagus' || k === 'decor.altar' ? 0 : Math.floor(rnd() * 4)]);
  await postOps(gm, map, [
    ...keys.map((k) => ({ type: 'palette.add', index: index.get(k), asset_id: pack.assets[k].asset_id, autotile: null })),
    { type: 'tiles.set', floor: map.floor, layer: 'ground', cells: ground },
    { type: 'tiles.set', floor: map.floor, layer: 'decor', cells: decor },
    { type: 'map.meta', theme: 'dark', ambient: { darkness: 0.9, tint: '#1b2340' } },
  ]);

  const base = (layer: string) => ({ floor: map.floor, layer, visibility: 'all', locked: false, sort_order: 0, rev: 1 });
  const walls = wallSegments().map((points) => ({
    type: 'object.add',
    object: {
      uid: uid(),
      ...base('walls'),
      type: 'wall',
      geometry: { points, closed: false },
      props: { kind: 'stone', thickness: 0.25, blocks_vision: true, blocks_light: true, blocks_move: true, texture_asset: null, height: null },
    },
  }));
  const doors = {} as Record<keyof typeof DOORS, string>;
  const doorOps = (Object.keys(DOORS) as Array<keyof typeof DOORS>).map((k) => {
    const d = DOORS[k];
    doors[k] = uid();
    return {
      type: 'object.add',
      object: {
        uid: doors[k],
        ...base('walls'),
        type: 'door',
        geometry: { a: d.a, b: d.b },
        props: { state: 'closed', locked: d.locked, secret: d.secret, asset_open: null, asset_closed: null, swing: 'a' },
      },
    };
  });
  const lights = LIGHTS.map((l) => ({
    type: 'object.add',
    object: {
      uid: uid(),
      ...base('lighting'),
      type: 'light',
      geometry: { x: l.at[0], y: l.at[1] },
      props: {
        radius: l.radius,
        dim_radius: l.dim,
        color: l.color,
        intensity: l.intensity,
        flicker: l.flicker,
        cone: null,
        enabled: true,
        follows_token: null,
      },
    },
  }));
  await postOps(gm, map, [...walls, ...doorOps, ...lights]);

  const placed: Array<[string, number, number, boolean]> = [
    ['Guerrier', 7.5, 10.5, false],
    ['Clerc', 6.5, 9.5, false],
    ['Magicienne', 6.5, 11.5, false],
    ['Voleur', 7.5, 12.5, false],
    ['Rat géant', 13.5, 11.5, false],
    ['Squelette', 19.5, 9.5, false],
    ['Squelette', 19.5, 12.5, false],
    ['Spectre', 19.5, 15.5, true],
    ['Araignée géante', 29.5, 16.5, false],
    ['Cultiste', 27.5, 5.5, false],
    ['Cultiste', 29.5, 7.5, false],
  ];
  const tokens: Record<string, string> = {};
  await postOps(
    gm,
    map,
    placed.map(([name, x, y, hidden], i) => {
      const id = uid();
      tokens[i < 4 ? name : `${name}#${i}`] = id;
      return placeOp(map.floor, id, defs[name]!, [x, y], hidden);
    }),
  );
  return { ...map, doors, tokens };
}

// --- The run ---------------------------------------------------------------------------------

const failures: string[] = [];

async function section(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    failures.push(`${name}: ${String(e).split('\n')[0]}`);
    console.log(`[readme-shots] ${name} failed: ${String(e)}`);
  }
}

/** Ground cells of a map (tile blocks), as "x,y" (same reader as help-shots.ts). */
async function groundCells(page: Page, mapId: string): Promise<number> {
  const res = await page.request.get(`/api/v1/maps/${mapId}/chunks`);
  const bytes = Buffer.from(await res.body());
  let count = 0;
  let o = 0;
  while (o < bytes.length) {
    const layer = bytes.readUInt8(o + 4);
    const len = bytes.readUInt32LE(o + 5);
    if (layer === 0) {
      const raw = inflateRawSync(bytes.subarray(o + 9, o + 9 + len));
      for (let i = 0; i < 1024; i++) if (raw.readUInt16LE(8 + i * 4) !== 0) count++;
    }
    o += 9 + len;
  }
  return count;
}

/** Same detection as the app: Chromium hides the host platform in its profile. */
async function paletteKey(page: Page): Promise<string> {
  const mac = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent);
  });
  return mac ? 'Meta' : 'Control';
}

async function uploadCover(who: Actor, png: string, name: string): Promise<string> {
  const res = await who.request.post('/api/v1/assets', {
    headers: { 'X-CSRF-Token': who.csrf, Accept: 'application/json' },
    multipart: {
      file: { name: 'couverture.png', mimeType: 'image/png', buffer: readFileSync(png) },
      kind: 'background',
      name,
    },
  });
  const data = await ok(res);
  return String(data.id);
}

test('readme screenshots', async ({ browser }) => {
  test.setTimeout(900_000);

  // Accounts: the game master and four players.
  for (const name of ['Camille', 'Hugo', 'Manon', 'Lucas', 'Jade']) await createAccount(name);
  const gm = await actor(browser, 'Camille', { width: 1440, height: 860 });
  const hugo = await actor(browser, 'Hugo', { width: 960, height: 540 });
  const manon = await actor(browser, 'Manon', { width: 390, height: 844, mobile: true });
  const lucas = await actor(browser, 'Lucas');
  const jade = await actor(browser, 'Jade');
  const page = gm.page;

  // The campaign.
  const game = await ok(
    await gm.request.post('/api/v1/games', {
      headers: gm.headers,
      data: {
        name: 'La Crypte de Valombre',
        description: "Horreur gothique : quatre aventuriers descendent sous l'abbaye en ruine de Valombre.",
      },
    }),
  );
  const gameId = String(game.id);
  for (const p of [hugo, manon, lucas, jade]) {
    await ok(await gm.request.post(`/api/v1/games/${gameId}/members`, { headers: gm.headers, data: { identifier: p.name, role: 'player' } }));
  }
  const general = await ok(await gm.request.get('/api/v1/assets?scope=general&kind=token&limit=100'));
  const assetOf = new Map<string, string>((general as Array<{ id: string; name: string }>).map((a) => [a.name, String(a.id)]));
  const owners: Record<string, Actor> = { Guerrier: hugo, Magicienne: manon, Voleur: lucas, Clerc: jade };
  const rings: Record<string, string> = { Guerrier: '#2b6cb0', Magicienne: '#805ad5', Voleur: '#2f855a', Clerc: '#d69e2e' };
  const defs: Record<string, string> = {};
  for (const name of ['Guerrier', 'Magicienne', 'Voleur', 'Clerc', 'Rat géant', 'Squelette', 'Spectre', 'Araignée géante', 'Cultiste']) {
    const pc = name in owners;
    const res = await ok(
      await gm.request.post(`/api/v1/games/${gameId}/tokens`, {
        headers: gm.headers,
        data: {
          name,
          asset_id: assetOf.get(name) ?? null,
          kind: pc ? 'pc' : 'npc',
          size_w: 1,
          size_h: 1,
          default_owner_user_id: pc ? owners[name]!.id : null,
          vision: { enabled: true, range: pc ? 12 : 6, dark: name === 'Voleur' ? 4 : 0 },
          light:
            name === 'Clerc'
              ? { radius: 2.5, dim_radius: 5.5, color: '#ffd38a', intensity: 0.85, flicker: true }
              : name === 'Guerrier'
                ? { radius: 1.5, dim_radius: 4, color: '#ffb35c', intensity: 0.8, flicker: true }
                : null,
          ring_color: pc ? rings[name] : '#c53030',
        },
      }),
    );
    defs[name] = String(res.id);
  }
  const crypt = await buildCrypt(gm, gameId, defs);
  const cellPx = Number((await ok(await gm.request.get(`/api/v1/maps/${crypt.id}`))).grid?.cell_px ?? 70);

  // --- Editor: the crypt, lit, the magic light selected -------------------------------------------
  await section('editor', async () => {
    await page.setViewportSize({ width: 1440, height: 860 });
    await page.goto(`/games/${gameId}/maps/${crypt.id}/edit`);
    await expect(page.getByTestId('editor-viewport')).toHaveAttribute('data-state', 'ready', { timeout: 40_000 });
    await page.getByTestId('view-shadows').check();
    await page.getByTestId('view-fog').uncheck();
    await page.getByTestId('editor-grid').uncheck();
    const list = page.getByTestId('scene-object-list');
    await list.locator('summary').click();
    await list.getByTestId('scene-item-light').nth(8).click();
    await list.locator('summary').click();
    const box = (await page.getByTestId('editor-viewport').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(300);
    await page.mouse.wheel(0, -100);
    await page.mouse.move(box.x + 5, box.y + box.height - 5);
    await page.waitForTimeout(1500);
    await shot(page, 'editeur');
  });

  // --- Session: lobby, exploration, read-aloud ---------------------------------------------------
  const session = await ok(
    await gm.request.post(`/api/v1/games/${gameId}/sessions`, {
      headers: gm.headers,
      data: { name: "Séance 3 : sous l'abbaye", map_id: crypt.id },
    }),
  );
  const sid = String(session.id);
  for (const p of [hugo, manon, lucas, jade]) {
    await ok(await p.request.post('/api/v1/sessions/join', { headers: p.headers, data: { code: session.code } }));
  }
  for (const [name, p] of Object.entries(owners)) await assign(gm, sid, defs[name]!, p.id);

  await section('lobby', async () => {
    for (const p of [hugo, jade, manon]) {
      await ok(await p.request.post(`/api/v1/sessions/${sid}/ready`, { headers: p.headers, data: { ready: true } }));
    }
    await manon.page.goto(`/sessions/${sid}`);
    await expect(manon.page.getByTestId('play-lobby')).toBeVisible({ timeout: 30_000 });
    await page.goto(`/sessions/${sid}`);
    await expect(page.getByTestId('session-console')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    await shot(page, 'console-salle-attente');
  });

  await ok(await gm.request.post(`/api/v1/sessions/${sid}/start`, { headers: gm.headers, data: {} }));
  const camera = async (x: number, y: number, cells: number, width: number): Promise<void> => {
    await act(gm, sid, [{ type: 'camera.set', x, y, zoom: width / (cells * cellPx), floor_id: crypt.floor, follow: true }]);
  };
  const move = async (moves: Array<[string, number, number]>): Promise<void> => {
    await act(
      gm,
      sid,
      moves.map(([who, x, y]) => ({ type: 'token.move', uid: crypt.tokens[who], x, y })),
    );
  };

  await section('exploration', async () => {
    await camera(8.5, 11, 20, 960);
    await hugo.page.goto(`/sessions/${sid}`);
    await waitInGame(hugo.page);
    await hugo.page.waitForTimeout(2500);
    const frames: Array<{ png: string; ms: number }> = [];
    let n = 0;
    const frame = async (ms: number, settle = 700): Promise<void> => {
      frames.push({ png: await raw(hugo.page, `frame-${String(n++).padStart(2, '0')}`, settle), ms });
    };
    await frame(1500);
    await act(gm, sid, [{ type: 'door.toggle', uid: crypt.doors.hall, state: 'open' }]);
    await frame(1000, 900);
    // Guerrier x, y, Clerc x, y, camera x.
    const steps: Array<[number, number, number, number, number]> = [
      [8.5, 10.5, 7.5, 10.5, 9],
      [9.5, 10.5, 8.5, 10.5, 9.5],
      [10.5, 10.5, 9.5, 10.5, 10],
      [11.5, 10.5, 10.5, 10.5, 10.5],
      [12.5, 10.5, 11.5, 10.5, 11],
    ];
    for (const [gx, gy, cx, cy, camX] of steps) {
      await move([
        ['Guerrier', gx, gy],
        ['Clerc', cx, cy],
      ]);
      await camera(camX, 11, 20, 960);
      await frame(420, 650);
    }
    await frame(900, 300);
    await act(gm, sid, [{ type: 'door.toggle', uid: crypt.doors.crypt, state: 'open' }]);
    await frame(800, 900);
    await move([['Rat géant#4', 17.5, 15.5]]);
    await frame(500, 600);
    await move([
      ['Rat géant#4', 18.5, 16.5],
      ['Guerrier', 14.5, 10.5],
      ['Clerc', 13.5, 10.5],
      ['Magicienne', 12.5, 10.5],
      ['Voleur', 11.5, 11.5],
    ]);
    await camera(13, 11, 20, 960);
    await frame(700, 800);
    await move([
      ['Guerrier', 16.5, 10.5],
      ['Clerc', 15.5, 11.5],
      ['Magicienne', 14.5, 10.5],
      ['Voleur', 13.5, 11.5],
    ]);
    await camera(15, 11, 20, 960);
    await frame(3000, 1000);
    animate('porte-vision', frames, 62);
  });

  let mobilePng = '';
  let readPng = '';
  await section('player-mobile', async () => {
    await camera(16, 10.8, 9, 390);
    await waitInGame(manon.page);
    await manon.page.waitForTimeout(2000);
    mobilePng = await raw(manon.page, 'joueur-mobile');
    await act(gm, sid, [
      {
        type: 'note.show',
        title: 'Les gisants',
        body: "Six sarcophages de pierre noire. Sur chaque couvercle, un chevalier sculpté serre son épée contre sa poitrine. L'un des couvercles a glissé : il en monte une odeur de cire froide.",
      },
    ]);
    await expect(manon.page.getByTestId('play-readaloud')).toBeVisible({ timeout: 15_000 });
    readPng = await raw(manon.page, 'lecture-mobile');
    await manon.page.getByTestId('play-readaloud').getByRole('button').last().click().catch(() => undefined);
  });

  let consolePng = '';
  await section('console', async () => {
    await camera(15, 11, 20, 960);
    await page.goto(`/sessions/${sid}`);
    await expect(page.getByTestId('session-console')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    consolePng = await raw(page, 'console-mj', 1000);
    await page.getByRole('tab', { name: 'Révéler' }).click();
    await shot(page, 'console-reveler');
    await page.getByRole('tab', { name: 'Joueurs' }).click();
    await page.getByTestId('session-console').click({ position: { x: 300, y: 20 } }).catch(() => undefined);
    await page.keyboard.press(`${await paletteKey(page)}+k`);
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await page.getByTestId('palette-input').fill('rév');
    await shot(page, 'palette');
    await page.keyboard.press('Escape');
  });

  let screenPng = '';
  await section('display', async () => {
    const d = await createDisplay(gm, sid, 'Table du salon');
    const screen = await openScreen(browser, { viewport: { width: 1280, height: 800 } });
    await pairByForm(screen.page, d.code);
    await waitScene(screen.page);
    await patchSettings(gm, d.id, { view_lock: { x: 14, y: 11, zoom: 1280 / (24 * cellPx), floor_id: crypt.floor } });
    await screen.page.waitForTimeout(3000);
    screenPng = await raw(screen.page, 'ecran-brut', 300);
    await page.getByTestId('panel-tab-displays').click();
    await expect(page.getByTestId('displays-panel')).toBeVisible();
    await shot(page, 'console-ecrans');
    await screen.context.close();
  });

  // --- Composite images -------------------------------------------------------------------------
  await section('compose', async () => {
    if (consolePng !== '' && mobilePng !== '') {
      await compose(
        browser,
        'hero',
        { width: 1600, height: 900 },
        `<div class="card">
          <div class="window" style="left: 48px; top: 48px; width: 1150px;">
            <div class="bar"><i></i><i></i><i></i><span>Console du MJ</span></div>
            <img src="${dataUrl(consolePng)}">
          </div>
          <div class="device" style="right: 70px; top: 120px; width: 300px;"><img src="${dataUrl(mobilePng)}"></div>
          <div class="label" style="left: 72px; bottom: 34px;">Le MJ voit tout et dirige la séance</div>
          <div class="label" style="right: 70px; bottom: 34px;">Le joueur ne voit que ce que son personnage voit</div>
        </div>`,
      );
    }
    if (mobilePng !== '' && readPng !== '') {
      await compose(
        browser,
        'mobile',
        { width: 900, height: 860 },
        `<div class="card">
          <div class="device" style="left: 70px; top: 40px; width: 330px;"><img src="${dataUrl(mobilePng)}"></div>
          <div class="device" style="right: 70px; top: 40px; width: 330px;"><img src="${dataUrl(readPng)}"></div>
        </div>`,
      );
    }
    if (screenPng !== '') {
      await compose(
        browser,
        'ecran-table',
        { width: 1400, height: 880 },
        `<div class="card" style="background: radial-gradient(120% 100% at 50% 0%, #6b4a2b 0%, #3a2616 60%, #24170d 100%);">
          <div class="device tablet" style="left: 110px; top: 50px; width: 1136px;"><img src="${dataUrl(screenPng)}"></div>
          <div class="label" style="left: 110px; bottom: 28px;">Écran posé sur la table : la vue de table, à l'échelle des figurines</div>
        </div>`,
      );
    }
  });

  // --- Generators: four maps in a second campaign -----------------------------------------------
  const north = await ok(
    await gm.request.post('/api/v1/games', {
      headers: gm.headers,
      data: { name: 'Les Terres du Nord', description: 'Campagne de voyage : forêts, cavernes et villages perdus.' },
    }),
  );
  const generated: Record<string, string> = {};
  // Exports go through a download (no save dialog).
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  // file name, generator, preset, seed, size (cells), map name.
  const generators: Array<[string, string, string, string, number, string]> = [
    ['generation-donjon', 'dungeon', 'large_dungeon', 'valombre', 60, 'Le Donjon des Ombres'],
    ['generation-grotte', 'cave', 'great_cavern', 'grotte-du-nord', 60, 'La Grotte du Nord'],
    ['generation-exterieur', 'outdoor', 'forest_river', 'terres-du-nord', 72, 'La Forêt des Brumes'],
    ['generation-village', 'village', 'village', 'brumeval', 64, 'Le Village de Brumeval'],
  ];
  for (const [name, generator, preset, seed, size, title] of generators) {
    await section(name, async () => {
      const map = await ok(
        await gm.request.post(`/api/v1/games/${north.id}/maps`, {
          headers: gm.headers,
          data: { name: title, width: size, height: size },
        }),
      );
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.goto(`/games/${north.id}/maps/${map.id}/edit`);
      await expect(page.getByTestId('editor-viewport')).toHaveAttribute('data-state', 'ready', { timeout: 40_000 });
      await page.getByTestId('editor-generate').click();
      await expect(page.getByTestId('generate-panel')).toBeVisible();
      await page.getByTestId('gen-generator').selectOption(generator);
      await page.getByTestId('gen-preset').selectOption(preset);
      await page.getByTestId('gen-seed').fill(seed);
      await page.getByTestId('gen-target-map').check().catch(() => undefined);
      await expect(page.getByTestId('gen-preview')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
      await page.getByTestId('gen-apply').click();
      await expect.poll(() => groundCells(page, String(map.id)), { timeout: 60_000 }).toBeGreaterThan(100);
      await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
      await page.getByTestId('generate-close').click();
      // The picture is the map's own PNG export (no editor overlay), reduced by cwebp.
      await page.getByTestId('editor-export').click();
      await page.getByTestId('export-png').click();
      await expect(page.getByTestId('export-png-form')).toBeVisible();
      await page.getByTestId('export-mode').selectOption('cell');
      await page.getByTestId('export-cell-px').fill(String(Math.round(1400 / size)));
      const download = page.waitForEvent('download', { timeout: 120_000 });
      await page.getByTestId('export-start').click();
      const png = path.join(tmp, `${name}.png`);
      await (await download).saveAs(png);
      execFileSync('cwebp', ['-q', '74', '-m', '6', '-resize', '700', '0', '-quiet', png, '-o', path.join(outDir, `${name}.webp`)]);
      await page.keyboard.press('Escape');
      generated[generator] = png;
    });
  }

  // --- Dashboard: covers, then the three interface styles ---------------------------------------
  await section('dashboard', async () => {
    if (screenPng !== '') {
      await ok(await gm.request.patch(`/api/v1/games/${gameId}`, { headers: gm.headers, data: { cover_asset_id: await uploadCover(gm, screenPng, 'Couverture Valombre') } }));
    }
    if (generated['outdoor']) {
      await ok(await gm.request.patch(`/api/v1/games/${north.id}`, { headers: gm.headers, data: { cover_asset_id: await uploadCover(gm, generated['outdoor'], 'Couverture Nord') } }));
    }
    const village = await ok(
      await hugo.request.post('/api/v1/games', {
        headers: hugo.headers,
        data: { name: 'Le Village de Brumeval', description: 'Enquête dans un village noyé de brume.' },
      }),
    );
    await ok(await hugo.request.post(`/api/v1/games/${village.id}/members`, { headers: hugo.headers, data: { identifier: 'Camille', role: 'player' } }));
    if (generated['village']) {
      await ok(await hugo.request.patch(`/api/v1/games/${village.id}`, { headers: hugo.headers, data: { cover_asset_id: await uploadCover(hugo, generated['village'], 'Couverture Brumeval') } }));
    }
    await page.setViewportSize({ width: 1200, height: 672 });
    const styles: Array<[string, string, string]> = [
      ['theme-moderne', 'light', 'modern'],
      ['theme-fantasy', 'dark', 'fantasy'],
      ['theme-scifi', 'dark', 'scifi'],
    ];
    for (const [name, scheme, style] of styles) {
      await ok(await gm.request.put('/api/v1/me/prefs/theme_scheme', { headers: gm.headers, data: { value: scheme } }));
      await ok(await gm.request.put('/api/v1/me/prefs/theme_style', { headers: gm.headers, data: { value: style } }));
      await page.goto('/');
      await expect(page.getByRole('link', { name: /Valombre/ }).first()).toBeVisible();
      await page.waitForTimeout(1500);
      await shot(page, name, 76);
    }
    await ok(await gm.request.put('/api/v1/me/prefs/theme_scheme', { headers: gm.headers, data: { value: 'light' } }));
    await ok(await gm.request.put('/api/v1/me/prefs/theme_style', { headers: gm.headers, data: { value: 'modern' } }));
    await page.goto(`/games/${north.id}?tab=maps`);
    await page.waitForTimeout(2500);
    await shot(page, 'partie-maps', 76);
    await page.setViewportSize({ width: 1200, height: 700 });
    await page.goto(`/games/${gameId}?tab=tokens`);
    await page.waitForTimeout(2500);
    await shot(page, 'partie-tokens', 76);
  });

  // --- Administration ---------------------------------------------------------------------------
  await section('admin', async () => {
    const context = await browser.newContext({
      baseURL: main.baseURL,
      locale: 'fr-FR',
      colorScheme: 'light',
      viewport: { width: 1440, height: 640 },
    });
    const admin = await context.newPage();
    await loginAsAdmin(admin);
    for (const [slug, name, height] of [
      ['', 'admin-tableau-de-bord', 470],
      ['backup', 'admin-sauvegarde', 640],
    ] as const) {
      await admin.setViewportSize({ width: 1440, height });
      await admin.goto(slug === '' ? '/admin' : `/admin/${slug}`);
      await admin.waitForTimeout(1500);
      await shot(admin, name, 76);
    }
    await context.close();
  });

  console.log(`[readme-shots] output: ${outDir}; failures: ${failures.length}`);
  expect(failures, failures.join('\n')).toEqual([]);
});
