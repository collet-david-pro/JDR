import { describe, expect, it } from 'vitest';
import fr from '../../i18n/fr.json';
import { placeCard, spotlight } from '../src/lib/tour/position';
import {
  TOURS,
  TOUR_IDS,
  presentSteps,
  stepBodyKey,
  stepTitleKey,
  type TourId,
} from '../src/lib/tour/tours';
import {
  TOURS_OFF_KEY,
  TOURS_STORAGE_KEY,
  TourStore,
  type TourAccount,
} from '../src/stores/tour.svelte';

function lookup(key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return node !== null && typeof node === 'object'
      ? (node as Record<string, unknown>)[part]
      : undefined;
  }, fr);
}

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function setup(user: string | null = 'u1', remote: unknown = undefined) {
  const saved: unknown[] = [];
  let prefs = remote;
  const account: TourAccount = {
    userId: () => user,
    remote: () => prefs,
    save: (value) => {
      saved.push(value);
      prefs = value ?? undefined;
    },
  };
  const storage = new MemoryStorage();
  const store = new TourStore(account, storage as unknown as Storage);
  return { store, saved, storage };
}

const everywhere = (): boolean => true;

describe('tour definitions', () => {
  it('has a title and a text for every step', () => {
    for (const id of TOUR_IDS) {
      expect(TOURS[id].length).toBeGreaterThan(0);
      for (const step of TOURS[id]) {
        expect(typeof lookup(stepTitleKey(id, step)), stepTitleKey(id, step)).toBe('string');
        expect(typeof lookup(stepBodyKey(id, step)), stepBodyKey(id, step)).toBe('string');
      }
    }
  });

  it('keeps the steps whose target is on screen, and the centred ones', () => {
    const steps = presentSteps(TOURS.home, (selector) => selector.includes('home-gm'));
    expect(steps.map((step) => step.key)).toEqual(['welcome', 'gm']);
  });
});

describe('tour card placement', () => {
  const view = { width: 1000, height: 800 };
  const card = { width: 300, height: 150 };

  it('goes below the target, centred on it and kept on screen', () => {
    expect(placeCard({ x: 100, y: 50, width: 200, height: 40 }, card, view)).toEqual({
      x: 50,
      y: 102,
      side: 'bottom',
    });
    expect(placeCard({ x: 0, y: 50, width: 20, height: 40 }, card, view).x).toBe(12);
  });

  it('goes above, then to the side, when there is no room below', () => {
    expect(placeCard({ x: 300, y: 700, width: 100, height: 60 }, card, view).side).toBe('top');
    expect(placeCard({ x: 0, y: 100, width: 300, height: 650 }, card, view)).toMatchObject({
      side: 'right',
      x: 312,
    });
    expect(placeCard({ x: 600, y: 100, width: 400, height: 650 }, card, view).side).toBe('left');
  });

  it('is centred without a target or around a target filling the screen', () => {
    expect(placeCard(null, card, view)).toEqual({ x: 350, y: 325, side: 'center' });
    expect(placeCard({ x: 0, y: 0, width: 1000, height: 800 }, card, view).side).toBe('center');
  });

  it('lights the target with a margin, inside the viewport', () => {
    expect(
      spotlight({ x: 10, y: 10, width: 100, height: 20 }, { width: 1000, height: 800 }),
    ).toEqual({ x: 4, y: 4, width: 112, height: 32 });
    expect(
      spotlight({ x: -50, y: 790, width: 100, height: 40 }, { width: 1000, height: 800 }),
    ).toEqual({ x: 0, y: 784, width: 56, height: 16 });
  });
});

describe('tour store', () => {
  it('starts an unseen tour, walks it and marks it seen at the end', () => {
    const { store, saved, storage } = setup();
    expect(store.offer('home', everywhere)).toBe(true);
    expect(store.active?.index).toBe(0);
    store.previous();
    expect(store.active?.index).toBe(0);
    store.next();
    store.previous();
    expect(store.active?.index).toBe(0);
    for (let i = 0; i < TOURS.home.length; i += 1) store.next();
    expect(store.active).toBeNull();
    expect(saved).toEqual([{ home: true }]);
    expect(JSON.parse(storage.getItem(TOURS_STORAGE_KEY) ?? '{}')).toEqual({ u1: ['home'] });
    expect(store.offer('home', everywhere)).toBe(false);
  });

  it('marks a skipped tour seen, not a cancelled one', () => {
    const { store, saved } = setup();
    store.offer('editor', everywhere);
    store.cancel();
    expect(saved).toEqual([]);
    expect(store.offer('editor', everywhere)).toBe(true);
    store.finish();
    expect(store.offer('editor', everywhere)).toBe(false);
  });

  it('reads the seen tours from the account and from the device', () => {
    const { store, storage } = setup('u1', { game: true, bogus: true, play: false });
    storage.setItem(TOURS_STORAGE_KEY, JSON.stringify({ u1: ['admin'], u2: ['home'] }));
    expect([...store.seen('u1')].sort()).toEqual(['admin', 'game']);
    expect(store.offer('game', everywhere)).toBe(false);
    expect(store.offer('home', everywhere)).toBe(true);
  });

  it('keeps the seen tours of each account apart on a shared device', () => {
    const { store, storage } = setup('u1');
    storage.setItem(TOURS_STORAGE_KEY, JSON.stringify({ u2: ['home'] }));
    expect(store.offer('home', everywhere)).toBe(true);
  });

  it('offers nothing when signed out, turned off, busy or with nothing on screen', () => {
    expect(setup(null).store.offer('home', everywhere)).toBe(false);
    const off = setup();
    off.storage.setItem(TOURS_OFF_KEY, '1');
    expect(off.store.offer('home', everywhere)).toBe(false);
    const busy = setup();
    busy.store.offer('home', everywhere);
    expect(busy.store.offer('admin', everywhere)).toBe(false);
    expect(busy.store.active?.id).toBe('home');
    expect(setup().store.offer('editor', () => false)).toBe(false);
  });

  it('offers every tour again after a reset', () => {
    const { store, saved, storage } = setup('u1', { home: true });
    storage.setItem(TOURS_STORAGE_KEY, JSON.stringify({ u1: ['home', 'game'] }));
    store.reset();
    expect(saved).toEqual([null]);
    for (const id of ['home', 'game'] as TourId[]) {
      expect(store.offer(id, everywhere)).toBe(true);
      store.cancel();
    }
  });
});
