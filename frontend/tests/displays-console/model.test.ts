import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/lib/api';
import type { DisplayInfo, PairingInfo } from '../../src/lib/displays/types';
import { DisplaysModel, type DisplaysApi } from '../../src/lib/sessions/console/displays.svelte';
import { event } from '../sessions/fixtures';

const settings = {
  diagonal_in: null,
  px_per_mm: null,
  mm_per_cell: 25,
  rotation: 0 as const,
  mirror: false,
  show_tokens: true,
  follow_camera: false,
  view_lock: null,
};

const pairing = (code = '042917'): PairingInfo => ({
  code,
  expires_at: '2026-01-01T00:10:00Z',
  url: `https://x.test/display?c=${code}`,
});

const info = (id: string, over: Partial<DisplayInfo> = {}): DisplayInfo => ({
  id,
  session_id: '12',
  name: `Écran ${id}`,
  state: 'active',
  online: false,
  last_seen_at: null,
  paired_at: null,
  user_agent: null,
  settings,
  pairing: null,
  ...over,
});

function fakeApi(initial: DisplayInfo[] = []) {
  let list = initial;
  const api = {
    list: vi.fn(async () => ({ displays: list })),
    create: vi.fn(async (_s: string, name: string) =>
      info('9', { name, state: 'pending', pairing: pairing() }),
    ),
    update: vi.fn(async (id: string, patch: { name?: string }) =>
      info(id, { name: patch.name ?? 'x' }),
    ),
    remove: vi.fn(async () => undefined),
    regenerateCode: vi.fn(async (id: string) =>
      info(id, { state: 'pending', pairing: pairing('111222') }),
    ),
  };
  return {
    api: api as unknown as DisplaysApi & typeof api,
    set: (next: DisplayInfo[]) => (list = next),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const model = (api: DisplaysApi, onError = vi.fn()) =>
  new DisplaysModel({ sessionId: '12', api, onError });

describe('DisplaysModel', () => {
  it('loads the list and counts the active screens', async () => {
    const { api } = fakeApi([info('1'), info('2', { state: 'pending' })]);
    const m = model(api);
    m.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.loaded).toBe(true);
    expect(m.displays.map((d) => d.id)).toEqual(['1', '2']);
    expect(m.activeCount).toBe(1);
    expect('reusable' in m).toBe(false);
    m.stop();
  });

  it('refreshes every 15 s until stopped', async () => {
    const { api, set } = fakeApi([info('1')]);
    const m = model(api);
    m.start();
    await vi.advanceTimersByTimeAsync(0);
    set([info('1', { online: true })]);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(m.displays[0]?.online).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.displays[0]?.online).toBe(true);
    m.stop();
    const calls = api.list.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.list.mock.calls.length).toBe(calls);
  });

  it('keeps the pairing of a created screen until it becomes active', async () => {
    const { api, set } = fakeApi([]);
    const m = model(api);
    m.start();
    await vi.advanceTimersByTimeAsync(0);
    const created = await m.add('Table');
    expect(created.id).toBe('9');
    expect(m.pairings['9']?.code).toBe('042917');
    expect(m.displays[0]?.pairing).toBeNull();
    // A refresh (still pending) keeps the code the server will not give again.
    set([info('9', { state: 'pending' })]);
    await m.refresh();
    expect(m.pairings['9']?.code).toBe('042917');
    // display.paired: active, the code goes away.
    set([info('9', { online: true })]);
    m.onEvent(event(1, 'display.paired', { display: info('9', { online: true }) }));
    await vi.advanceTimersByTimeAsync(0);
    expect(m.displays[0]?.state).toBe('active');
    expect(m.pairings['9']).toBeUndefined();
    expect(m.activeCount).toBe(1);
    m.stop();
  });

  it('applies display.updated and display.revoked', async () => {
    const { api } = fakeApi([info('1'), info('2')]);
    const m = model(api);
    m.start();
    await vi.advanceTimersByTimeAsync(0);
    m.onEvent(
      event(2, 'display.updated', {
        display: {
          id: '1',
          name: 'Renommé',
          state: 'active',
          settings: { ...settings, rotation: 90 },
        },
      }),
    );
    expect(m.displays[0]?.name).toBe('Renommé');
    expect(m.displays[0]?.settings.rotation).toBe(90);
    expect(m.displays[0]?.online).toBe(false);
    m.onEvent(event(3, 'display.revoked', { display_id: '2' }));
    expect(m.displays.map((d) => d.id)).toEqual(['1']);
    m.onEvent(event(4, 'session.state', {}));
    expect(m.displays).toHaveLength(1);
    m.stop();
  });

  it('regenerates a code and revokes', async () => {
    const { api } = fakeApi([info('2', { state: 'pending' })]);
    const m = model(api);
    m.start();
    await vi.advanceTimersByTimeAsync(0);
    await m.newCode('2');
    expect(m.pairings['2']?.code).toBe('111222');
    await m.revoke('2');
    expect(api.remove).toHaveBeenCalledWith('2');
    expect(m.displays).toHaveLength(0);
    expect(m.pairings['2']).toBeUndefined();
    m.stop();
  });

  it('propagates display_limit and reports list errors', async () => {
    const { api } = fakeApi([]);
    api.create.mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'display_limit', message: 'x' }),
    );
    const onError = vi.fn();
    const m = model(api, onError);
    await expect(m.add('Neuvième')).rejects.toMatchObject({ code: 'display_limit' });
    api.list.mockRejectedValueOnce(new Error('boom'));
    await m.refresh();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
