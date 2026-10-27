import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/lib/api';
import {
  DisplayRun,
  ME_POLL_MS,
  ME_POLL_WAITING_MS,
  type DisplayRunOptions,
} from '../../src/lib/displays/display-run.svelte';
import type { DisplayMe } from '../../src/lib/displays/types';
import type { SyncClient, SyncHandlers, SyncStatus } from '../../src/lib/realtime/types';
import type { TileSource } from '../../src/lib/sessions/scene';
import type { SessionSnapshot } from '../../src/lib/sessions/types';
import { definition, event, placed, session, snapshot } from '../sessions/fixtures';
import { settings } from './scale.test';

class FakeSync implements SyncClient {
  handlers: SyncHandlers[] = [];
  channels: string[][] = [];
  status: SyncStatus = { mode: 'sse', state: 'online', leader: true, lastEventId: null };
  subscribe(c: string[], _s: string, h: SyncHandlers): () => void {
    this.channels.push(c);
    this.handlers.push(h);
    return () => undefined;
  }
  setActivity(): void {}
  listeners: Array<(s: SyncStatus) => void> = [];
  onStatus(cb: (s: SyncStatus) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }
  setState(state: SyncStatus['state']): void {
    this.status = { ...this.status, state };
    for (const l of this.listeners) l(this.status);
  }
  close(): void {}
  /** Delivers an event to the latest subscription. */
  emit(...args: Parameters<typeof event>): void {
    this.handlers[this.handlers.length - 1]!.onEvent(event(...args));
  }
}

const err = (status: number, code: string) => new ApiError({ code, message: code, status });
const flush = () => new Promise((r) => setTimeout(r, 5));
const tiles = { chunks: async () => ({ records: [], revision: 7 }) } as unknown as TileSource;

const meOf = (
  patch: Partial<DisplayMe> = {},
  sessionPatch: Partial<DisplayMe['session']> = {},
): DisplayMe => ({
  id: '5',
  name: 'Table',
  settings: settings(),
  session: {
    id: '12',
    game_id: '3',
    name: 'Séance 4',
    state: 'running',
    current_map_id: '34',
    current_floor_id: '35',
    camera: null,
    pause_screen: null,
    ...sessionPatch,
  },
  status: 'running',
  last_event_id: '100',
  ...patch,
});

const displaySnapshot = (patch: Partial<SessionSnapshot> = {}): SessionSnapshot =>
  snapshot('player', {
    session: { ...session('player'), role: 'display', assignments: [] },
    tokens: [
      { ...definition('21'), kind: 'pc' },
      { ...definition('22'), kind: 'monster' },
    ],
    ...patch,
  });

function setup(initial: DisplayMe | ApiError = meOf()) {
  const sync = new FakeSync();
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const t = {
    sync,
    timers,
    next: initial as DisplayMe | ApiError,
    snapshot: (async () => displaySnapshot()) as (id: string) => Promise<SessionSnapshot>,
    problems: [] as unknown[],
    device: {
      pair: vi.fn(async (_code: string) => {
        if (t.next instanceof Error) throw t.next;
        return t.next;
      }),
      me: vi.fn(async () => {
        if (t.next instanceof Error) throw t.next;
        return t.next;
      }),
      patchMe: vi.fn(async (patch: object) => {
        const me = t.next as DisplayMe;
        return { ...me, settings: { ...me.settings, ...patch } };
      }),
      unpair: vi.fn(async () => undefined),
    },
    sessions: { snapshot: vi.fn((id: string) => t.snapshot(id)) },
    /** Runs the pending timer with the given delay. */
    fire: async (ms: number) => {
      const timer = timers.filter((x) => x.live && x.ms === ms).pop();
      expect(timer, `no timer of ${ms} ms`).toBeDefined();
      timer!.live = false;
      timer!.fn();
      await flush();
    },
    delays: () => timers.filter((x) => x.live).map((x) => x.ms),
  };
  const options: DisplayRunOptions = {
    device: t.device,
    sessions: t.sessions,
    tiles,
    sync,
    onProblem: (e) => t.problems.push(e),
    setTimeout: (fn, ms) => {
      const timer = { fn, ms, live: true };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (h) => {
      (h as { live: boolean }).live = false;
    },
  };
  return Object.assign(t, { run: new DisplayRun(options) });
}

describe('DisplayRun: pairing and records', () => {
  it('is unpaired on a 401 of /display/me', async () => {
    const t = setup(err(401, 'display_unpaired'));
    expect(t.run.loading).toBe(true);
    await t.run.start();
    expect(t.run.status).toBe('unpaired');
    expect(t.run.loading).toBe(false);
    expect(t.run.me).toBeNull();
    expect(t.delays()).toEqual([]);
  });

  it('pairs with a code and follows the session', async () => {
    const t = setup(err(401, 'display_unpaired'));
    await t.run.start();
    t.next = meOf();
    const pending = t.run.pair('K7F2-QM9X');
    expect(t.run.status).toBe('pairing');
    expect(await pending).toBe(true);
    await flush();
    expect(t.device.pair).toHaveBeenCalledWith('K7F2-QM9X');
    expect(t.run.status).toBe('running');
    expect(t.run.me?.name).toBe('Table');
    expect(t.run.run?.state?.session.role).toBe('display');
    expect(t.sync.channels).toEqual([['session:12']]);
    expect(t.delays()).toEqual([ME_POLL_MS]);
    t.run.stop();
  });

  it('keeps the pairing page and the error when the code is refused', async () => {
    const t = setup(err(401, 'display_unpaired'));
    await t.run.start();
    t.next = err(422, 'display_code_invalid');
    expect(await t.run.pair('NOPE')).toBe(false);
    expect(t.run.pairError?.code).toBe('display_code_invalid');
    expect(t.run.status).toBe('unpaired');
  });

  it('forgets the pairing on unpair()', async () => {
    const t = setup();
    await t.run.start();
    await t.run.unpair();
    expect(t.device.unpair).toHaveBeenCalled();
    expect(t.run.status).toBe('unpaired');
    expect(t.run.run).toBeNull();
    expect(t.delays()).toEqual([]);
  });

  it('reads /display/me every 30 s and falls to unpaired on a 401', async () => {
    const t = setup();
    await t.run.start();
    await flush();
    expect(t.run.status).toBe('running');
    await t.fire(ME_POLL_MS);
    expect(t.device.me).toHaveBeenCalledTimes(2);
    expect(t.delays()).toEqual([ME_POLL_MS]);
    t.next = err(401, 'display_unpaired');
    await t.fire(ME_POLL_MS);
    expect(t.run.status).toBe('unpaired');
    expect(t.run.run).toBeNull();
    expect(t.delays()).toEqual([]);
  });

  it('retries after a failed refresh without changing state', async () => {
    const t = setup();
    await t.run.start();
    await flush();
    t.next = err(503, 'maintenance');
    await t.fire(ME_POLL_MS);
    expect(t.run.status).toBe('running');
    expect(t.problems).toHaveLength(1);
    expect(t.delays()).toEqual([ME_POLL_MS]);
    t.run.stop();
  });
});

describe('DisplayRun: events', () => {
  it('reads /display/me when the stream drops: a revoked screen goes unpaired (401)', async () => {
    const t = setup();
    await t.run.start();
    await flush();
    expect(t.run.status).toBe('running');
    t.next = err(401, 'display_unpaired');
    t.sync.setState('reconnecting');
    await flush();
    expect(t.run.status).toBe('unpaired');
    t.run.stop();
    expect(t.sync.listeners).toHaveLength(0);
  });

  it('goes unpaired on display.revoked with its own id, ignores another', async () => {
    const t = setup();
    await t.run.start();
    await flush();
    t.sync.emit(101, 'display.revoked', { display_id: '77' });
    await flush();
    expect(t.run.status).toBe('running');
    t.sync.emit(102, 'display.revoked', { display_id: '5' });
    expect(t.run.status).toBe('unpaired');
    expect(t.run.run).toBeNull();
    expect(t.delays()).toEqual([]);
  });

  it('updates its settings on display.updated with its own id only', async () => {
    const t = setup();
    await t.run.start();
    await flush();
    const mine = {
      id: '5',
      session_id: '12',
      name: 'Salon',
      state: 'active',
      settings: settings({ rotation: 90 }),
    };
    t.sync.emit(101, 'display.updated', { display: { ...mine, id: '77', name: 'Autre' } });
    expect(t.run.settings?.rotation).toBe(0);
    t.sync.emit(102, 'display.updated', { display: mine });
    expect(t.run.settings?.rotation).toBe(90);
    expect(t.run.me?.name).toBe('Salon');
    t.run.stop();
  });

  it('shows a text to read until the next one or its duration (D11)', async () => {
    const t = setup();
    await t.run.start();
    await flush();
    t.sync.emit(101, 'note.read_aloud', { title: 'Titre', body: 'x'.repeat(95) });
    expect(t.run.readAloud).toEqual({ eventId: '101', title: 'Titre', body: 'x'.repeat(95) });
    expect(t.delays()).toContain(21_000);
    t.sync.emit(102, 'note.read_aloud', { title: 'Suite', body: '' });
    expect(t.run.readAloud?.title).toBe('Suite');
    expect(t.delays()).toContain(15_000 + 300);
    await t.fire(15_300);
    expect(t.run.readAloud).toBeNull();
    t.sync.emit(103, 'note.read_aloud', { title: 'Encore', body: '' });
    t.run.dismissReadAloud();
    expect(t.run.readAloud).toBeNull();
    t.run.stop();
  });

  it('follows the table viewers with the D5 rule', async () => {
    const t = setup();
    t.snapshot = async () => displaySnapshot();
    await t.run.start();
    await flush();
    expect(t.run.viewers).toEqual(['t1']); // t1 is a PC (kind pc), t2 a monster
    t.sync.emit(101, 'maptoken.added', { ...placed('t3', '21', 5, 5), view: 'display' });
    await flush();
    expect(t.run.viewers).toEqual(['t1', 't3']);
    t.sync.emit(102, 'assignment.set', { token_id: '22', user_id: '8' });
    await flush();
    expect(t.run.viewers).toEqual(['t1', 't2', 't3']);
    t.run.stop();
  });

  it('ignores the player and gm versions of a token event', async () => {
    const t = setup();
    await t.run.start();
    await flush();
    t.sync.emit(101, 'maptoken.moved', { uid: 't1', x: 9, y: 9, view: 'player' });
    await flush();
    expect(t.run.run?.state?.tokens['t1']?.x).toBe(3);
    t.sync.emit(102, 'maptoken.moved', { uid: 't1', x: 9, y: 9, view: 'display' });
    await flush();
    expect(t.run.run?.state?.tokens['t1']?.x).toBe(9);
    t.run.stop();
  });
});

describe('DisplayRun: session life', () => {
  it('waits when the session ends, then follows the attached one', async () => {
    const t = setup();
    await t.run.start();
    await flush();
    t.sync.emit(101, 'session.state', {
      state: 'ended',
      current_map_id: null,
      floor_id: null,
      pause_screen: null,
    });
    await flush();
    expect(t.run.status).toBe('waiting');
    expect(t.run.run).toBeNull();
    expect(t.delays()).toEqual([ME_POLL_WAITING_MS]);
    // still over: stays waiting and polls every 10 s
    t.next = meOf({ status: 'waiting' }, { state: 'ended' });
    await t.fire(ME_POLL_WAITING_MS);
    expect(t.run.status).toBe('waiting');
    expect(t.delays()).toEqual([ME_POLL_WAITING_MS]);
    // the GM attached the screen to another session
    t.next = meOf({}, { id: '13', current_map_id: '40' });
    await t.fire(ME_POLL_WAITING_MS);
    expect(t.run.status).toBe('running');
    expect(t.run.run?.sync.state?.session.id).toBe('12'); // fixture snapshot, new run
    expect(t.sessions.snapshot).toHaveBeenLastCalledWith('13', undefined);
    expect(t.delays()).toEqual([ME_POLL_MS]);
    t.run.stop();
  });

  it('is waiting when the stream is refused with 409 session_not_running', async () => {
    const t = setup();
    t.snapshot = async () => {
      throw err(409, 'session_not_running');
    };
    await t.run.start();
    expect(t.run.status).toBe('waiting');
    expect(t.run.run).toBeNull();
    expect(t.delays()).toEqual([ME_POLL_WAITING_MS]);
  });

  it('is waiting from /display/me when the session is over, without opening a stream', async () => {
    const t = setup(meOf({ status: 'waiting' }, { state: 'ended', current_map_id: null }));
    await t.run.start();
    expect(t.run.status).toBe('waiting');
    expect(t.sessions.snapshot).not.toHaveBeenCalled();
    expect(t.sync.channels).toEqual([]);
  });

  it('builds the paused state from /display/me on 409 session_paused', async () => {
    const pause = { asset_id: '9', text: 'Pause', url: 'https://x/pause.jpg' };
    const t = setup(meOf({ status: 'paused' }, { state: 'paused', pause_screen: pause }));
    t.snapshot = async () => {
      throw err(409, 'session_paused');
    };
    await t.run.start();
    await flush();
    expect(t.run.status).toBe('paused');
    expect(t.run.run?.state?.map).toBeNull();
    expect(t.run.run?.state?.session.role).toBe('display');
    expect(t.run.pauseScreen).toEqual({ asset_id: '9', text: 'Pause', url: 'https://x/pause.jpg' });
    t.run.stop();
  });

  it('reads /display/me again to sign the pause image of a session.state event', async () => {
    const t = setup();
    await t.run.start();
    await flush();
    const calls = t.device.me.mock.calls.length;
    t.next = meOf(
      { status: 'paused' },
      { state: 'paused', pause_screen: { asset_id: '9', text: null, url: 'https://x/p.jpg' } },
    );
    t.sync.emit(101, 'session.state', {
      state: 'paused',
      current_map_id: '34',
      floor_id: '35',
      pause_screen: { asset_id: '9', text: null },
    });
    await flush();
    expect(t.device.me.mock.calls.length).toBe(calls + 1);
    expect(t.run.status).toBe('paused');
    expect(t.run.pauseScreen?.url).toBe('https://x/p.jpg');
    t.run.stop();
  });

  it('reads /display/me again on a 404 (screen moved) and follows the new session', async () => {
    const t = setup();
    let first = true;
    t.snapshot = async (id) => {
      if (first) {
        first = false;
        throw err(404, 'not_found');
      }
      return displaySnapshot({ session: { ...session('player'), role: 'display', id } });
    };
    await t.run.start();
    expect(t.run.run).toBeNull();
    expect(t.delays()).toEqual([2000]);
    t.next = meOf({}, { id: '13' });
    await t.fire(2000);
    expect(t.sessions.snapshot).toHaveBeenLastCalledWith('13', undefined);
    expect(t.run.run?.state?.session.id).toBe('13');
    t.run.stop();
  });

  it('goes unpaired when the snapshot answers 401', async () => {
    const t = setup();
    t.snapshot = async () => {
      throw err(401, 'display_unpaired');
    };
    await t.run.start();
    expect(t.run.status).toBe('unpaired');
  });
});

describe('DisplayRun: settings', () => {
  it('applies a change at once and keeps the answer of the server', async () => {
    const t = setup();
    await t.run.start();
    await flush();
    await t.run.saveSettings({ rotation: 180, mirror: true });
    expect(t.device.patchMe).toHaveBeenCalledWith({ rotation: 180, mirror: true });
    expect(t.run.settings).toMatchObject({ rotation: 180, mirror: true });
    t.run.stop();
  });

  it('undoes the change when the server refuses it', async () => {
    const t = setup();
    await t.run.start();
    await flush();
    t.device.patchMe.mockRejectedValueOnce(err(422, 'validation_failed'));
    await expect(t.run.saveSettings({ diagonal_in: 999 })).rejects.toBeInstanceOf(ApiError);
    expect(t.run.settings?.diagonal_in).toBeNull();
    t.run.stop();
  });
});
