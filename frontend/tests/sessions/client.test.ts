import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../../src/lib/api';
import {
  SessionsClient,
  SESSION_ERROR_CODES,
  classifySessionError,
  formatSessionCode,
  isSessionError,
  isValidSessionCode,
  normalizeSessionCode,
} from '../../src/lib/sessions';
import { session, snapshot } from './fixtures';

function setup(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; method: string; body: unknown; headers: Headers }[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: new Headers(init?.headers),
    });
    return answer(url, init ?? {});
  });
  const api = new ApiClient({
    baseUrl: '/api/v1',
    fetch: fetchMock as unknown as typeof fetch,
    csrfToken: 'csrf',
    sleep: () => Promise.resolve(),
  });
  return { client: new SessionsClient(api), calls };
}

const ok = (data: unknown, meta: unknown = {}, status = 200) =>
  new Response(JSON.stringify({ ok: true, data, meta }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const noContent = () => new Response(null, { status: 204 });
const fail = (
  status: number,
  code: string,
  fields: Record<string, string> = {},
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify({ ok: false, error: { code, message: code, fields } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

describe('session code', () => {
  it('normalises what the user types and formats it for display', () => {
    expect(normalizeSessionCode(' k7f2-qm9x ')).toBe('K7F2QM9X');
    expect(normalizeSessionCode('K7F2 QM9X')).toBe('K7F2QM9X');
    expect(formatSessionCode('K7F2QM9X')).toBe('K7F2-QM9X');
    expect(formatSessionCode('k7f2qm')).toBe('K7F2-QM');
    expect(formatSessionCode('k7f')).toBe('K7F');
    expect(formatSessionCode('K7F2QM9XZZ')).toBe('K7F2-QM9X');
  });

  it('validates the alphabet and the length (no 0, 1, I, O)', () => {
    expect(isValidSessionCode('K7F2-QM9X')).toBe(true);
    expect(isValidSessionCode('K7F2-QM9')).toBe(false);
    expect(isValidSessionCode('K7F2-QM90')).toBe(false);
    expect(isValidSessionCode('K7F2-QMIX')).toBe(false);
  });
});

describe('session errors', () => {
  const err = (
    status: number,
    code: string,
    fields: Record<string, string> = {},
    retryAfter: number | null = null,
  ) => new ApiError({ code, message: code, status, fields, retryAfter });

  it('names the session cases', () => {
    for (const code of SESSION_ERROR_CODES.filter((c) => c !== 'rate_limited')) {
      expect(classifySessionError(err(409, code))?.code).toBe(code);
      expect(isSessionError(err(409, code), code)).toBe(true);
    }
    expect(classifySessionError(err(409, 'session_exists', { session_id: '12' }))).toMatchObject({
      sessionId: '12',
    });
    expect(classifySessionError(err(429, 'rate_limited', {}, 30))).toMatchObject({
      code: 'rate_limited',
      retryAfter: 30,
    });
    expect(classifySessionError(err(429, 'whatever'))?.code).toBe('rate_limited');
  });

  it('other errors are not session errors', () => {
    expect(classifySessionError(err(404, 'not_found'))).toBeNull();
    expect(classifySessionError(new Error('x'))).toBeNull();
    expect(isSessionError(null, 'kicked')).toBe(false);
  });
});

describe('SessionsClient', () => {
  it('create / get / update', async () => {
    const { client, calls } = setup(() => ok(session('gm')));
    await client.create('3', { name: 'S', map_id: '34' }, { clientOpId: 'op-1' });
    await client.get('12');
    await client.update('12', { name: 'N', pause_screen: { asset_id: null, text: 'Pause' } });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/v1/games/3/sessions',
      'GET /api/v1/sessions/12',
      'PATCH /api/v1/sessions/12',
    ]);
    expect(calls[0]!.body).toEqual({ name: 'S', map_id: '34', client_op_id: 'op-1' });
    expect(calls[0]!.headers.get('X-CSRF-Token')).toBe('csrf');
    expect(calls[2]!.body).toEqual({ name: 'N', pause_screen: { asset_id: null, text: 'Pause' } });
  });

  it('list gives the next cursor', async () => {
    const { client, calls } = setup(() => ok([session('gm')], { next_cursor: 'abc' }));
    const page = await client.list('3', { cursor: 'x', limit: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe('abc');
    expect(calls[0]!.url).toBe('/api/v1/games/3/sessions?cursor=x&limit=20');
    const { client: c2 } = setup(() => ok([]));
    expect(await c2.list('3')).toEqual({ items: [], nextCursor: null });
  });

  it('join sends the normalised code', async () => {
    const { client, calls } = setup(() => ok({ session_id: '12', game_id: '3' }));
    expect(await client.join('k7f2-qm9x')).toEqual({ session_id: '12', game_id: '3' });
    expect(calls[0]!.body).toEqual({ code: 'K7F2QM9X' });
  });

  it('transitions, code, kick, assignment, ready, change-map, leave', async () => {
    const { client, calls } = setup((url) =>
      url.endsWith('regenerate-code')
        ? ok({ code: 'AAAABBBB' })
        : url.includes('assignments')
          ? ok({ token_id: '21', user_id: null })
          : url.endsWith('/kick') || url.endsWith('/ready') || url.endsWith('/leave')
            ? noContent()
            : ok(session('gm')),
    );
    await client.start('12');
    await client.pause('12');
    await client.resume('12');
    await client.end('12', { clientOpId: 'e' });
    expect(await client.regenerateCode('12')).toBe('AAAABBBB');
    await client.kick('12', '7');
    expect(await client.assign('12', '21', null)).toEqual({ token_id: '21', user_id: null });
    await client.ready('12', true);
    await client.changeMap('12', '35', '40');
    await client.changeMap('12', '35');
    await client.leave('12');
    expect(calls.map((c) => `${c.method} ${c.url.replace('/api/v1', '')}`)).toEqual([
      'POST /sessions/12/start',
      'POST /sessions/12/pause',
      'POST /sessions/12/resume',
      'POST /sessions/12/end',
      'POST /sessions/12/regenerate-code',
      'POST /sessions/12/kick',
      'PUT /sessions/12/assignments/21',
      'POST /sessions/12/ready',
      'POST /sessions/12/change-map',
      'POST /sessions/12/change-map',
      'POST /sessions/12/leave',
    ]);
    expect(calls[3]!.body).toEqual({ client_op_id: 'e' });
    expect(calls[5]!.body).toEqual({ user_id: '7' });
    expect(calls[6]!.body).toEqual({ user_id: null });
    expect(calls[7]!.body).toEqual({ ready: true });
    expect(calls[8]!.body).toEqual({ map_id: '35', floor_id: '40' });
    expect(calls[9]!.body).toEqual({ map_id: '35' });
  });

  it('snapshot, preload, presence, actions', async () => {
    const { client, calls } = setup((url) =>
      url.endsWith('/snapshot')
        ? ok(snapshot('gm'))
        : url.endsWith('/preload')
          ? ok({ map_id: '34', floor_id: '35', assets: [], total_bytes: 0 })
          : url.endsWith('/presence')
            ? noContent()
            : ok({ results: [{ index: 0, ok: true }], last_event_id: '5' }),
    );
    expect((await client.snapshot('12')).last_event_id).toBe('100');
    expect((await client.preload('12')).total_bytes).toBe(0);
    await client.presence('12');
    const r = await client.actions('12', [{ type: 'token.move', uid: 't1', x: 1, y: 2 }], {
      clientOpId: 'op-9',
    });
    expect(r.last_event_id).toBe('5');
    expect(calls[2]!.body).toEqual({ session_id: '12' });
    expect(calls[3]!.body).toEqual({
      actions: [{ type: 'token.move', uid: 't1', x: 1, y: 2 }],
      client_op_id: 'op-9',
    });
  });

  it('the typed errors come through ApiError', async () => {
    const cases: [number, string, Record<string, string>][] = [
      [409, 'session_exists', { session_id: '12' }],
      [409, 'invalid_transition', {}],
      [409, 'session_paused', {}],
      [409, 'session_not_running', {}],
      [422, 'session_code_invalid', {}],
      [410, 'session_not_joinable', {}],
      [403, 'kicked', {}],
      [410, 'events_gone', {}],
    ];
    for (const [status, code, fields] of cases) {
      const { client } = setup(() => fail(status, code, fields));
      const error = await client.join('K7F2QM9X').catch((e: unknown) => e);
      expect(classifySessionError(error)).toMatchObject({ code, status });
    }
    const { client } = setup(() => fail(429, 'rate_limited', {}, { 'Retry-After': '12' }));
    expect(
      classifySessionError(await client.join('K7F2QM9X').catch((e: unknown) => e)),
    ).toMatchObject({ code: 'rate_limited', retryAfter: 12 });
  });
});
