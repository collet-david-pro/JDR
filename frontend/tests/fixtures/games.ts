import { vi } from 'vitest';
import { ApiClient } from '../../src/lib/api';
import type { Encounter, Game, Member, Token } from '../../src/lib/types';

export type FetchArgs = [input: string | URL | Request, init?: RequestInit];

export const ok = (data: unknown, meta: Record<string, unknown> = {}) => ({
  ok: true,
  data,
  meta,
});

export const fail = (code: string, fields: Record<string, string> = {}) => ({
  ok: false,
  error: { code, message: code, fields },
});

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'rq' },
  });

export const noContent = (): Response => new Response(null, { status: 204 });

/** ApiClient over a mocked fetch (no retries, no delays). */
export function mockApi(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  base = '/api/v1',
) {
  const fetchMock = vi.fn((input: FetchArgs[0], init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {})),
  );
  const api = new ApiClient({
    baseUrl: base,
    fetch: fetchMock as unknown as typeof fetch,
    csrfToken: 'tok',
    retries: 0,
    sleep: () => Promise.resolve(),
  });
  return { api, fetchMock };
}

export function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: '7',
    name: 'Campagne',
    description: null,
    cover_asset_id: null,
    cover_url: null,
    gm: { id: '1', username: 'Alice' },
    my_role: 'gm',
    settings: {
      fog_strict: true,
      players_blocked_by_walls: true,
      players_can_move_own_tokens: true,
      players_see_other_pcs: true,
      unit_label: 'ft',
      unit_per_cell: 5,
      default_cell_px: 70,
    },
    counts: { maps: 0, tokens: 1, members: 2 },
    archived_at: null,
    deleted_at: null,
    created_at: '2026-10-21T08:00:00Z',
    updated_at: '2026-10-21T08:00:00Z',
    ...overrides,
  };
}

export function makeMember(id: string, username: string, role: Member['role']): Member {
  return { user: { id, username }, role, joined_at: '2026-10-21T08:00:00Z' };
}

export function makeToken(overrides: Partial<Token> = {}): Token {
  return {
    id: '30',
    game_id: '7',
    name: 'Gobelin',
    asset_id: null,
    image: null,
    kind: 'monster',
    size_w: 1,
    size_h: 1,
    default_owner_user_id: null,
    vision: { enabled: true, range: 12, dark: 0 },
    light: null,
    ring_color: null,
    created_at: '2026-10-21T08:00:00Z',
    updated_at: '2026-10-21T08:00:00Z',
    ...overrides,
  };
}

export function makeEncounter(overrides: Partial<Encounter> = {}): Encounter {
  return {
    id: '50',
    game_id: '7',
    name: 'Embuscade',
    notes: null,
    tokens: [{ token_id: '30', dx: 0, dy: 0 }],
    created_at: '2026-10-21T08:00:00Z',
    updated_at: '2026-10-21T08:00:00Z',
    ...overrides,
  };
}
