import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autoReloadRoute,
  claimReload,
  isEditing,
  watchVersion,
  type ServedVersion,
} from '../src/lib/version-watch';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(served: ServedVersion | Error, current = 'assets/main-A.js') {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  });
  const fetchVersion = vi.fn(() =>
    served instanceof Error ? Promise.reject(served) : Promise.resolve(served),
  );
  const onNewVersion = vi.fn();
  const stop = watchVersion({
    current,
    fetchVersion,
    onNewVersion,
    window: Object.assign(win, {
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (id: number) => clearInterval(id),
    }) as never,
    document: doc as never,
    intervalMs: 1000,
  });
  return { win, doc, fetchVersion, onNewVersion, stop };
}

describe('watchVersion', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports a new build once, then stops checking', async () => {
    const { fetchVersion, onNewVersion } = setup({ build: 'assets/main-B.js', maintenance: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNewVersion).toHaveBeenCalledWith('assets/main-B.js');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchVersion).toHaveBeenCalledTimes(1);
    expect(onNewVersion).toHaveBeenCalledTimes(1);
  });

  it('ignores the same build, an empty build and the maintenance of the update', async () => {
    for (const served of [
      { build: 'assets/main-A.js', maintenance: false },
      { build: '', maintenance: false },
      { build: 'assets/main-B.js', maintenance: true },
    ]) {
      const { onNewVersion, stop } = setup(served);
      await vi.advanceTimersByTimeAsync(1000);
      expect(onNewVersion).not.toHaveBeenCalled();
      stop();
    }
  });

  it('checks when the tab comes back, the network returns or a chunk fails to load', async () => {
    const { win, doc, fetchVersion, stop } = setup(new Error('offline'));
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    win.dispatchEvent(new Event('online'));
    await flush();
    win.dispatchEvent(new Event('vite:preloadError'));
    await flush();
    expect(fetchVersion).toHaveBeenCalledTimes(3);
    stop();
    win.dispatchEvent(new Event('online'));
    expect(fetchVersion).toHaveBeenCalledTimes(3);
  });

  it('watches nothing without a known build (development)', async () => {
    const { fetchVersion } = setup({ build: 'assets/main-B.js', maintenance: false }, '');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchVersion).not.toHaveBeenCalled();
  });
});

describe('reload policy', () => {
  it('reloads by itself only the screen and the table views', () => {
    expect(autoReloadRoute('display')).toBe(true);
    expect(autoReloadRoute('session')).toBe(true);
    expect(autoReloadRoute('join')).toBe(true);
    expect(autoReloadRoute('map-editor')).toBe(false);
    expect(autoReloadRoute(null)).toBe(false);
  });

  it('waits while the user types', () => {
    const el = (tagName: string, isContentEditable = false) =>
      ({ tagName, isContentEditable }) as unknown as Element;
    expect(isEditing(el('TEXTAREA'))).toBe(true);
    expect(isEditing(el('INPUT'))).toBe(true);
    expect(isEditing(el('DIV', true))).toBe(true);
    expect(isEditing(el('BUTTON'))).toBe(false);
    expect(isEditing(null)).toBe(false);
  });

  it('reloads once per build (no loop when the old page is still served)', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(claimReload(storage, 'assets/main-B.js')).toBe(true);
    expect(claimReload(storage, 'assets/main-B.js')).toBe(false);
    expect(claimReload(storage, 'assets/main-C.js')).toBe(true);
    expect(claimReload(null, 'assets/main-C.js')).toBe(false);
  });
});
