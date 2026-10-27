import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { AdminApi, login } from './app';
import { main, unique, userPassword } from './env';

/**
 * Shared set-up of the session specs (P6): users, game, map with walls / doors / lights / tokens,
 * session, players in game. Everything goes through the REST API (the behaviours under test are
 * driven by the specs themselves).
 */

export interface Me {
  csrf: string;
  id: string;
  name: string;
}

/** A signed-in user: page (cookies), CSRF headers, id. */
export interface Actor extends Me {
  page: Page;
  context: BrowserContext | null;
  headers: Record<string, string>;
  request: APIRequestContext;
}

export const uid = (): string => randomUUID().replace(/-/g, '').slice(0, 21);

export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource|NetworkError|net::ERR/i.test(msg.text())) {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

export async function createUser(prefix: string): Promise<string> {
  const name = unique(prefix);
  const api = await AdminApi.open(main.baseURL);
  await api.send('post', '/admin/users', {
    email: `${name.toLowerCase()}@example.test`,
    username: name,
    role: 'user',
    password: userPassword,
  });
  await api.close();
  return name;
}

/** Creates a user and signs her in on `page` (already in a context with the wanted baseURL). */
export async function signIn(page: Page, name: string, context: BrowserContext | null = null): Promise<Actor> {
  await login(page, name, userPassword);
  const res = await page.request.get('/api/v1/auth/me');
  expect(res.ok()).toBeTruthy();
  const data = (await res.json()).data;
  return {
    csrf: data.csrf as string,
    id: String(data.user.id),
    name,
    page,
    context,
    headers: { 'X-CSRF-Token': data.csrf as string, Accept: 'application/json' },
    request: page.request,
  };
}

export interface OpenOptions {
  baseURL?: string;
  /** localStorage['jdr.test'] = '1': enables window.__jdrTest in the app. */
  hook?: boolean;
  /** Existing user name; created when omitted. */
  name?: string;
}

/** New browser context + signed-in user (the caller closes the context). */
export async function openUser(browser: Browser, prefix: string, o: OpenOptions = {}): Promise<Actor> {
  const name = o.name ?? (await createUser(prefix));
  const context = await browser.newContext({ baseURL: o.baseURL ?? main.baseURL, locale: 'fr-FR' });
  if (o.hook !== false) {
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('jdr.test', '1');
      } catch {
        /* no storage */
      }
    });
  }
  const page = await context.newPage();
  return signIn(page, name, context);
}

async function ok<T = any>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(res.ok(), `${res.url()} -> ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).data as T;
}

export async function createGame(gm: Actor, members: Array<{ name: string; role?: string }>): Promise<string> {
  const game = await ok(await gm.request.post('/api/v1/games', { headers: gm.headers, data: { name: unique('Donjon ') } }));
  for (const m of members) {
    await ok(
      await gm.request.post(`/api/v1/games/${game.id}/members`, {
        headers: gm.headers,
        data: { identifier: m.name, role: m.role ?? 'player' },
      }),
    );
  }
  return game.id as string;
}

export interface MapRef {
  id: string;
  floor: string;
}

export async function createMap(gm: Actor, gameId: string, width = 14, height = 10): Promise<MapRef> {
  const created = await ok(
    await gm.request.post(`/api/v1/games/${gameId}/maps`, { headers: gm.headers, data: { name: 'Salle', width, height } }),
  );
  const detail = await ok(await gm.request.get(`/api/v1/maps/${created.id}`));
  return { id: created.id as string, floor: String(detail.floors[0].id) };
}

export async function createTokenDef(
  gm: Actor,
  gameId: string,
  name: string,
  range = 10,
  kind: 'pc' | 'npc' = 'pc',
): Promise<string> {
  const token = await ok(
    await gm.request.post(`/api/v1/games/${gameId}/tokens`, {
      headers: gm.headers,
      data: {
        name,
        asset_id: null,
        kind,
        size_w: 1,
        size_h: 1,
        default_owner_user_id: null,
        vision: { enabled: true, range, dark: 0 },
        light: null,
        ring_color: null,
      },
    }),
  );
  return token.id as string;
}

/** Applies map ops with the current revision. */
export async function postOps(gm: Actor, map: MapRef, ops: unknown[]): Promise<void> {
  const detail = await ok(await gm.request.get(`/api/v1/maps/${map.id}`));
  await ok(
    await gm.request.post(`/api/v1/maps/${map.id}/ops`, {
      headers: gm.headers,
      data: { base_revision: detail.revision, client_op_id: uid(), ops },
    }),
  );
}

export function wallOp(floor: string, points: Array<[number, number]>, id = uid()): unknown {
  return {
    type: 'object.add',
    object: {
      uid: id,
      floor,
      layer: 'walls',
      visibility: 'all',
      locked: false,
      sort_order: 0,
      rev: 1,
      type: 'wall',
      geometry: { points, closed: false },
      props: {
        kind: 'stone',
        thickness: 0.2,
        blocks_vision: true,
        blocks_light: true,
        blocks_move: true,
        texture_asset: null,
        height: null,
      },
    },
  };
}

export function doorOp(
  floor: string,
  id: string,
  a: [number, number],
  b: [number, number],
  o: { secret?: boolean; state?: 'open' | 'closed' } = {},
): unknown {
  return {
    type: 'object.add',
    object: {
      uid: id,
      floor,
      layer: 'walls',
      visibility: 'all',
      locked: false,
      sort_order: 0,
      rev: 1,
      type: 'door',
      geometry: { a, b },
      props: {
        state: o.state ?? 'closed',
        locked: false,
        secret: o.secret ?? false,
        asset_open: null,
        asset_closed: null,
        swing: 'a',
      },
    },
  };
}

export function lightOp(
  floor: string,
  id: string,
  at: [number, number],
  o: { follows?: string | null; visibility?: 'all' | 'gm' } = {},
): unknown {
  return {
    type: 'object.add',
    object: {
      uid: id,
      floor,
      layer: 'lighting',
      visibility: o.visibility ?? 'all',
      locked: false,
      sort_order: 0,
      rev: 1,
      type: 'light',
      geometry: { x: at[0], y: at[1] },
      props: {
        radius: 4,
        dim_radius: 8,
        color: '#ffcc88',
        intensity: 1,
        flicker: { type: 'none', amp: 0, speed: 1 },
        cone: null,
        enabled: true,
        follows_token: o.follows ?? null,
      },
    },
  };
}

export function placeOp(
  floor: string,
  id: string,
  tokenId: string,
  at: [number, number],
  hidden = false,
): unknown {
  return {
    type: 'maptoken.add',
    token: { uid: id, floor, token_id: tokenId, x: at[0], y: at[1], rotation: 0, scale: 1, hidden, light_override: null, rev: 1 },
  };
}

export interface SessionRef {
  id: string;
  code: string;
}

export async function createSession(gm: Actor, gameId: string, mapId: string): Promise<SessionRef> {
  const s = await ok(
    await gm.request.post(`/api/v1/games/${gameId}/sessions`, { headers: gm.headers, data: { name: 'Séance test', map_id: mapId } }),
  );
  return { id: s.id as string, code: s.code as string };
}

export async function joinSession(player: Actor, code: string): Promise<void> {
  await ok(await player.request.post('/api/v1/sessions/join', { headers: player.headers, data: { code } }));
}

export async function assign(gm: Actor, sessionId: string, tokenId: string, userId: string): Promise<void> {
  await ok(
    await gm.request.put(`/api/v1/sessions/${sessionId}/assignments/${tokenId}`, { headers: gm.headers, data: { user_id: userId } }),
  );
}

export async function transition(
  who: Actor,
  sessionId: string,
  action: 'start' | 'pause' | 'resume' | 'end',
): Promise<number> {
  const res = await who.request.post(`/api/v1/sessions/${sessionId}/${action}`, { headers: who.headers, data: {} });
  return res.status();
}

export async function startSession(gm: Actor, sessionId: string): Promise<void> {
  expect(await transition(gm, sessionId, 'start')).toBe(200);
}

/** Session actions; returns { results, last_event_id }. */
export async function act(
  who: Actor,
  sessionId: string,
  actions: unknown[],
): Promise<{ results: Array<Record<string, any>>; last_event_id: string }> {
  return ok(await who.request.post(`/api/v1/sessions/${sessionId}/actions`, { headers: who.headers, data: { actions } }));
}

export async function snapshot(who: Actor, sessionId: string): Promise<any> {
  return ok(await who.request.get(`/api/v1/sessions/${sessionId}/snapshot`));
}

/** The player is in the game view (lobby passed, session running). */
export async function waitInGame(page: Page): Promise<void> {
  await expect(page.getByTestId('play-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('network-indicator')).toHaveAttribute('data-state', 'online', { timeout: 30_000 });
}

/** Opens /sessions/{id} for the player and waits for the game view. */
export async function enterGame(page: Page, sessionId: string): Promise<void> {
  await page.goto(`/sessions/${sessionId}`);
  await waitInGame(page);
}

/** Last event id applied by the page's session (window.__jdrTest hook; 0 before the first event). */
export async function appliedId(page: Page): Promise<bigint> {
  const v = await page.evaluate(() => (window as any).__jdrTest?.lastEventId ?? '0');
  return BigInt(v === '' ? '0' : v);
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface DisplayRef {
  id: string;
  code: string;
}

/** P7: creates a projection screen on a session (the GM); returns its id and pairing code. */
export async function createDisplay(gm: Actor, sessionId: string, name = 'Écran salon'): Promise<DisplayRef> {
  const d = await ok(
    await gm.request.post(`/api/v1/sessions/${sessionId}/displays`, { headers: gm.headers, data: { name } }),
  );
  return { id: d.id as string, code: String(d.pairing.code) };
}

/** P7: revokes a projection screen. */
export async function deleteDisplay(gm: Actor, displayId: string): Promise<void> {
  const res = await gm.request.delete(`/api/v1/displays/${displayId}`, { headers: gm.headers });
  expect(res.ok(), `DELETE display -> ${res.status()}`).toBeTruthy();
}
