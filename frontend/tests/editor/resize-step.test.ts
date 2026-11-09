import { describe, expect, it } from 'vitest';
import {
  saveResizeStep,
  takeResizeStep,
  type ResizeStep,
} from '../../src/editor/versions/resize-step';
import type { MapVersion } from '../../src/lib/types';

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const step: ResizeStep = {
  mapId: '7',
  revision: 12,
  stack: 'undo',
  version: { id: '3', label: 'Avant redimensionnement' } as unknown as MapVersion,
  params: { width: 40, height: 30, shiftX: 5, shiftY: 0 },
};

describe('resize step', () => {
  it('comes back once, for the same map at the same revision', () => {
    const store = memory();
    saveResizeStep(store, step);
    expect(takeResizeStep(store, '7', 12)).toEqual(step);
    expect(takeResizeStep(store, '7', 12)).toBeNull();
  });

  it('is dropped when the map changed meanwhile or is another one', () => {
    const store = memory();
    saveResizeStep(store, step);
    expect(takeResizeStep(store, '7', 13)).toBeNull();
    expect(store.data.size).toBe(0);
    saveResizeStep(store, step);
    expect(takeResizeStep(store, '8', 12)).toBeNull();
  });

  it('ignores broken data and a missing storage', () => {
    const store = memory();
    store.setItem('jdr-editor-resize-step', '{"mapId":"7","revision":12,"stack":"undo"}');
    expect(takeResizeStep(store, '7', 12)).toBeNull();
    store.setItem('jdr-editor-resize-step', 'not json');
    expect(takeResizeStep(store, '7', 12)).toBeNull();
    expect(takeResizeStep(null, '7', 12)).toBeNull();
    expect(() => saveResizeStep(null, step)).not.toThrow();
  });
});
