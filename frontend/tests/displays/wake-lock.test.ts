import { describe, expect, it, vi } from 'vitest';
import {
  WakeLockManager,
  type VideoFallback,
  type WakeLockDeps,
  type WakeLockSentinelLike,
} from '../../src/lib/displays/wake-lock';

class Sentinel implements WakeLockSentinelLike {
  released = false;
  private listeners: (() => void)[] = [];
  release = vi.fn(() => {
    this.fire();
    return Promise.resolve();
  });
  addEventListener(_t: 'release', l: () => void): void {
    this.listeners.push(l);
  }
  /** The browser released the lock (page hidden...). */
  fire(): void {
    this.released = true;
    for (const l of this.listeners) l();
  }
}

function setup(over: Partial<WakeLockDeps> = {}) {
  const sentinels: Sentinel[] = [];
  const visibility: (() => void)[] = [];
  const fallback = { play: vi.fn(), stop: vi.fn() } satisfies VideoFallback;
  const env = { visible: true };
  const deps: WakeLockDeps = {
    request: vi.fn(() => {
      const s = new Sentinel();
      sentinels.push(s);
      return Promise.resolve(s);
    }),
    startVideo: vi.fn(() => fallback),
    isVisible: () => env.visible,
    onVisibility: (l) => {
      visibility.push(l);
      return () => visibility.splice(visibility.indexOf(l), 1);
    },
    ...over,
  };
  const states: string[] = [];
  const lock = new WakeLockManager(deps, (s) => states.push(s));
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const show = async () => {
    env.visible = true;
    visibility.forEach((l) => l());
    await flush();
  };
  return { lock, deps, sentinels, visibility, fallback, env, states, flush, show };
}

describe('WakeLockManager', () => {
  it('holds the wake lock', async () => {
    const t = setup();
    expect(t.lock.state).toBe('idle');
    await t.lock.start();
    expect(t.lock.state).toBe('active');
    expect(t.sentinels).toHaveLength(1);
    expect(t.deps.startVideo).not.toHaveBeenCalled();
  });

  it('takes the lock again after a release and after the page became visible', async () => {
    const t = setup();
    await t.lock.start();
    t.env.visible = false;
    t.sentinels[0]!.fire(); // the browser releases it when the tab is hidden
    await t.flush();
    expect(t.sentinels).toHaveLength(1); // hidden: nothing can be requested
    await t.show();
    expect(t.sentinels).toHaveLength(2);
    expect(t.lock.state).toBe('active');
    // released while visible: requested again at once
    t.sentinels[1]!.fire();
    await t.flush();
    expect(t.sentinels).toHaveLength(3);
    expect(t.lock.state).toBe('active');
  });

  it('falls back to the video when the request is refused', async () => {
    const t = setup({ request: vi.fn(() => Promise.reject(new Error('NotAllowedError'))) });
    await t.lock.start();
    expect(t.lock.state).toBe('video');
    expect(t.deps.startVideo).toHaveBeenCalledTimes(1);
    await t.show();
    expect(t.fallback.play).toHaveBeenCalled();
    expect(t.deps.startVideo).toHaveBeenCalledTimes(1);
  });

  it('uses the video when the browser has no Wake Lock API', async () => {
    const t = setup({ request: null });
    await t.lock.start();
    expect(t.lock.state).toBe('video');
  });

  it('is unsupported when nothing works', async () => {
    const a = setup({ request: null, startVideo: () => null });
    await a.lock.start();
    expect(a.lock.state).toBe('unsupported');
    const b = setup({
      request: null,
      startVideo: () => {
        throw new Error('no captureStream');
      },
    });
    await b.lock.start();
    expect(b.lock.state).toBe('unsupported');
  });

  it('releases everything on stop', async () => {
    const t = setup();
    await t.lock.start();
    t.lock.stop();
    expect(t.lock.state).toBe('idle');
    expect(t.sentinels[0]!.release).toHaveBeenCalled();
    expect(t.visibility).toHaveLength(0);
    const v = setup({ request: null });
    await v.lock.start();
    v.lock.stop();
    expect(v.fallback.stop).toHaveBeenCalled();
    expect(v.states).toEqual(['video', 'idle']);
  });
});
