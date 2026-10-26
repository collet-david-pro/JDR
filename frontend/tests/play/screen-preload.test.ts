import { describe, expect, it } from 'vitest';
import { playScreen } from '../../src/lib/sessions/play/screen';
import {
  Preloader,
  preloadRatio,
  type PreloadHost,
  type PreloadProgress,
} from '../../src/lib/sessions/play/preload';
import type { Preload, PreloadAsset } from '../../src/lib/sessions/types';

describe('playScreen', () => {
  const base = { phase: 'ready', status: 'running', hasMap: true, preloaded: true } as const;
  it('picks the screen from the state', () => {
    expect(playScreen({ ...base, phase: 'loading', status: null })).toBe('loading');
    expect(playScreen({ ...base, phase: 'error' })).toBe('error');
    expect(playScreen({ ...base, phase: 'kicked' })).toBe('kicked');
    expect(playScreen({ ...base, status: 'lobby' })).toBe('lobby');
    expect(playScreen({ ...base, status: 'paused' })).toBe('paused');
    expect(playScreen({ ...base, status: 'ended' })).toBe('ended');
    expect(playScreen(base)).toBe('game');
  });
  it('stays in the lobby while running until the map is preloaded', () => {
    expect(playScreen({ ...base, preloaded: false })).toBe('lobby');
    expect(playScreen({ ...base, hasMap: false })).toBe('lobby');
  });
});

const asset = (id: string, bytes: number): PreloadAsset => ({
  id,
  url: `/a/${id}`,
  bytes,
  kind: 'image',
});
const list = (assets: PreloadAsset[]): Preload => ({
  map_id: '1',
  floor_id: null,
  assets,
  total_bytes: assets.reduce((n, a) => n + a.bytes, 0),
});

function host(assets: PreloadAsset[], failing: string[] = []): PreloadHost {
  return {
    preload: async () => list(assets),
    download: async (a, _s, onBytes) => {
      if (failing.includes(a.id)) throw new Error('boom');
      onBytes(a.bytes / 2);
      onBytes(a.bytes / 2);
      return new Blob(['x']);
    },
    decode: async () => undefined,
  };
}

describe('Preloader', () => {
  it('reports the progress in bytes and ends done', async () => {
    const seen: PreloadProgress[] = [];
    const p = new Preloader(host([asset('a', 100), asset('b', 300)]), (s) => seen.push(s));
    await p.start();
    expect(seen[0]!.status).toBe('loading');
    expect(seen.some((s) => s.loadedBytes > 0 && s.loadedBytes < 400)).toBe(true);
    const last = seen.at(-1)!;
    expect(last).toMatchObject({
      status: 'done',
      done: 2,
      total: 2,
      loadedBytes: 400,
      totalBytes: 400,
      errors: 0,
    });
    expect(preloadRatio(last)).toBe(1);
  });

  it('counts the failing assets without blocking, and can start again', async () => {
    let failing = ['b'];
    const h: PreloadHost = {
      ...host([asset('a', 10), asset('b', 10)]),
      download: async (a, s, n) => host([], failing).download(a, s, n),
    };
    const p = new Preloader(h, () => undefined);
    await p.start();
    expect(p.current).toMatchObject({ status: 'done', errors: 1, done: 2 });
    failing = [];
    await p.start();
    expect(p.current).toMatchObject({ status: 'done', errors: 0 });
  });

  it('counts a decoding failure', async () => {
    const h: PreloadHost = {
      ...host([asset('a', 10)]),
      decode: async () => Promise.reject(new Error('bad')),
    };
    const p = new Preloader(h, () => undefined);
    await p.start();
    expect(p.current.errors).toBe(1);
    expect(p.current.status).toBe('done');
  });

  it('is done at once without asset, and errors when the request fails', async () => {
    const empty = new Preloader(host([]), () => undefined);
    await empty.start();
    expect(empty.current.status).toBe('done');
    const bad = new Preloader(
      { ...host([]), preload: async () => Promise.reject(new Error('409')) },
      () => undefined,
    );
    await bad.start();
    expect(bad.current.status).toBe('error');
  });

  it('ignores a run that was stopped', async () => {
    const seen: PreloadProgress[] = [];
    const p = new Preloader(host([asset('a', 10)]), (s) => seen.push(s));
    const run = p.start();
    p.stop();
    await run;
    expect(seen.every((s) => s.status !== 'done')).toBe(true);
  });
});
