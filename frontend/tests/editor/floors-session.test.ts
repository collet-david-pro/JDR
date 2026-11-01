import { describe, expect, it, vi } from 'vitest';
import type { FloorInfo } from '../../src/editor/contracts';
import { EditorSession } from '../../src/editor/ui/session';
import { grid, palette } from './helpers';

const floors: FloorInfo[] = [
  { id: '10', uid: 'ground', level: 0, name: 'RdC', sort_order: 0 },
  { id: '11', uid: 'upper', level: 1, name: 'Étage', sort_order: 1 },
];

function open(uids: string[] = ['u1', 'u2', 'u3']) {
  const next = [...uids];
  const session = new EditorSession({
    grid: grid(32, 32),
    palette: palette(4),
    floor: 'ground',
    floors,
    newUid: () => next.shift() ?? 'zzz',
    describeNotice: (n) => n.code,
  });
  return session;
}

describe('FloorsController', () => {
  it('mirrors the floors in the UI state', () => {
    const s = open();
    expect(s.ui.floors.map((f) => [f.uid, f.loaded])).toEqual([
      ['ground', true],
      ['upper', false],
    ]);
    expect(s.ui.currentFloor).toBe('ground');
  });

  it('fetches a floor that is not in memory before showing it; a failure keeps the current floor', async () => {
    const s = open();
    const loader = vi
      .fn<(meta: { uid: string }) => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    s.floors.setLoader(loader);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await s.floors.select('upper')).toBe(false);
    expect(s.ui.currentFloor).toBe('ground');
    expect(s.ui.notice?.text).toBe('floor_load_failed');
    expect(await s.floors.select('upper')).toBe(true);
    expect(s.ui.currentFloor).toBe('upper');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('adds a floor on the next free level, shows it and undoes it', async () => {
    const s = open();
    const uid = await s.floors.add('Cave');
    expect(uid).toBe('u1');
    expect(s.doc.floorMeta('u1')).toMatchObject({ name: 'Cave', level: 2 });
    s.doc.flush();
    expect(s.ui.currentFloor).toBe('u1');
    s.undo();
    s.doc.flush();
    expect(s.doc.floorMeta('u1')).toBeUndefined();
    expect(s.ui.floors).toHaveLength(2);
  });

  it('refuses the eleventh floor and bad names or levels with a notice', async () => {
    const s = open(Array.from({ length: 12 }, (_, i) => `n${i}`));
    for (let i = 0; i < 8; i++) expect(await s.floors.add(`F${i}`)).not.toBeNull();
    expect(await s.floors.add('Trop')).toBeNull();
    expect(s.ui.notice?.text).toBe('floor_limit');
    const t = open();
    expect(await t.floors.add('   ')).toBeNull();
    expect(t.ui.notice?.text).toBe('floor_invalid');
    expect(t.floors.setLevel('upper', 0)).toBe(false);
    expect(t.floors.setLevel('upper', 12)).toBe(false);
    expect(t.floors.rename('upper', '')).toBe(false);
  });

  it('renames and re-levels with undo', () => {
    const s = open();
    expect(s.floors.rename('upper', 'Grenier')).toBe(true);
    expect(s.floors.setLevel('upper', 5)).toBe(true);
    s.doc.flush();
    expect(s.ui.floors.find((f) => f.uid === 'upper')).toMatchObject({ name: 'Grenier', level: 5 });
    s.undo();
    s.undo();
    s.doc.flush();
    expect(s.ui.floors.find((f) => f.uid === 'upper')).toMatchObject({ name: 'Étage', level: 1 });
  });

  it('removes a floor only after reading its content; offline it refuses and nothing is lost', async () => {
    const s = open();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    s.floors.setLoader(() => Promise.reject(new Error('offline')));
    expect(await s.floors.remove('upper')).toBe(false);
    expect(s.doc.floorMeta('upper')).toBeDefined();
    expect(s.ui.notice?.text).toBe('floor_load_failed');
    expect(s.history.state.canUndo).toBe(false);
    s.floors.setLoader(() => Promise.resolve());
    expect(await s.floors.remove('upper')).toBe(true);
    expect(s.doc.floorMeta('upper')).toBeUndefined();
  });

  it('never removes the last floor', async () => {
    const s = new EditorSession({ grid: grid(8, 8), floor: 'only', describeNotice: (n) => n.code });
    expect(await s.floors.remove('only')).toBe(false);
    expect(s.ui.notice?.text).toBe('floor_last');
  });

  it('shows the restored floor again when its deletion is undone', async () => {
    const s = open();
    await s.floors.select('upper');
    expect(await s.floors.remove('upper')).toBe(true);
    s.doc.flush();
    expect(s.ui.currentFloor).toBe('ground');
    s.undo();
    s.doc.flush();
    expect(s.ui.currentFloor).toBe('upper');
  });

  it('draws the floor below as a ghost when it is in memory', async () => {
    const s = open();
    const calls: (string | null)[] = [];
    const engine = {
      setGhost: (view: unknown) => calls.push(view === null ? null : 'view'),
    };
    s.floors.attach(engine);
    expect(calls.at(-1)).toBeNull(); // ground has nothing below
    await s.floors.select('upper');
    s.doc.flush();
    expect(calls.at(-1)).toBe('view');
    s.floors.setGhostVisible(false);
    expect(calls.at(-1)).toBeNull();
  });
});
