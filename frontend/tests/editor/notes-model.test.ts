import { describe, expect, it } from 'vitest';
import { History } from '../../src/editor/history/History';
import { MapDocument } from '../../src/editor/model/MapDocument';
import {
  linkedObjects,
  noteAddCommand,
  noteRemoveCommand,
  noteUpdateCommand,
} from '../../src/editor/model/note-commands';
import { MAX_NOTES, NotesState } from '../../src/editor/model/NotesState';
import { MapOpError } from '../../src/editor/model/ops';
import { normalizeObject } from '../../src/editor/model/scene-values';
import { grid, palette } from './helpers';
import { passage, pin, zone } from './note-helpers';

function setup() {
  const doc = new MapDocument({ grid: grid(30, 30), palette: palette(3) });
  const history = new History(doc);
  const sent: string[] = [];
  history.onOps((ops, origin) => sent.push(...ops.map((o) => `${origin}:${o.type}`)));
  return { doc, history, sent };
}

const values = { uid: 'n1', title: 'Auberge', body: 'Le **Cerf**', audience: 'gm' as const };

describe('NotesState through the document', () => {
  it('adds a note with the server defaults, and undoes / redoes it', () => {
    const { doc, history } = setup();
    history.execute(noteAddCommand(values));
    expect(doc.notes.list()).toEqual([
      {
        uid: 'n1',
        title: 'Auberge',
        body: 'Le **Cerf**',
        asset_id: null,
        audience: 'gm',
        audience_users: [],
        read_aloud: false,
      },
    ]);
    history.undo();
    expect(doc.notes.list()).toEqual([]);
    history.redo();
    expect(doc.notes.get('N1')?.title).toBe('Auberge');
  });

  it('updates with an inverse patch', () => {
    const { doc, history } = setup();
    history.execute(noteAddCommand(values));
    const prev = doc.notes.get('n1')!;
    const command = noteUpdateCommand(prev, {
      title: 'Taverne',
      audience: 'players',
      audience_users: ['u1'],
    })!;
    history.execute(command);
    expect(doc.notes.get('n1')).toMatchObject({
      title: 'Taverne',
      audience: 'players',
      audience_users: ['u1'],
    });
    history.undo();
    expect(doc.notes.get('n1')).toMatchObject({
      title: 'Auberge',
      audience: 'gm',
      audience_users: [],
    });
    expect(noteUpdateCommand(prev, { title: 'Auberge' })).toBeNull();
  });

  it('refuses a duplicate uid (case-insensitive), an empty title and a too long body', () => {
    const { doc, history } = setup();
    history.execute(noteAddCommand(values));
    expect(() => history.execute(noteAddCommand({ ...values, uid: 'N1' }))).toThrow(MapOpError);
    expect(() => history.execute(noteAddCommand({ ...values, uid: 'n2', title: ' ' }))).toThrow(
      MapOpError,
    );
    expect(() =>
      history.execute(noteAddCommand({ ...values, uid: 'n3', body: 'x'.repeat(20_001) })),
    ).toThrow(MapOpError);
    expect(doc.notes.list()).toHaveLength(1);
  });

  it('limits the notes to 500', () => {
    const state = new NotesState();
    for (let i = 0; i < MAX_NOTES; i++) {
      state.apply({ type: 'note.add', note: { uid: `n${i}`, title: 't', body: '' } });
    }
    expect(() =>
      state.apply({ type: 'note.add', note: { uid: 'more', title: 't', body: '' } }),
    ).toThrow(MapOpError);
  });

  it('secrets.reset has no local effect, no inverse, and goes out untracked', () => {
    const { history, sent } = setup();
    history.applyUntracked([{ type: 'secrets.reset' }]);
    expect(sent).toEqual(['untracked:secrets.reset']);
    expect(history.state.canUndo).toBe(false);
  });

  it('a conflict replaces or removes the local note', () => {
    const { doc, history } = setup();
    history.execute(noteAddCommand(values));
    doc.notes.replace('n1', null);
    expect(doc.notes.list()).toEqual([]);
  });

  it('notifies subscribers and loads the server state', () => {
    const { doc } = setup();
    let calls = 0;
    const off = doc.notes.onChanged(() => calls++);
    doc.notes.load([
      {
        uid: 'a',
        title: 'A',
        body: '',
        asset_id: null,
        audience: 'all',
        audience_users: [],
        read_aloud: true,
      },
    ]);
    off();
    doc.notes.load([]);
    expect(calls).toBe(1);
  });
});

describe('deleting a note', () => {
  function withLinks() {
    const s = setup();
    s.history.execute(noteAddCommand(values));
    s.history.execute({
      label: 'x',
      ops: [
        { type: 'object.add', object: pin('p1', 3, 3, 'n1') },
        {
          type: 'object.add',
          object: zone(
            'z1',
            [
              [1, 1],
              [5, 1],
              [5, 5],
            ],
            'n1',
          ),
        },
        { type: 'object.add', object: pin('p2', 8, 8, null) },
      ],
      inverseOps: [],
    });
    return s;
  }

  it('lists the linked objects', () => {
    const { doc } = withLinks();
    expect(
      linkedObjects(doc, 'n1')
        .map((o) => o.uid)
        .sort(),
    ).toEqual(['p1', 'z1']);
  });

  it('detaches the links, then removes; undo brings back the note and the links', () => {
    const { doc, history, sent } = withLinks();
    sent.length = 0;
    history.execute(noteRemoveCommand(doc.notes.get('n1')!, linkedObjects(doc, 'n1')));
    expect(sent).toEqual(['do:object.update', 'do:object.update', 'do:note.remove']);
    expect(doc.notes.list()).toEqual([]);
    expect((doc.object('p1')!.props as { note: string | null }).note).toBeNull();
    expect((doc.object('z1')!.props as { note: string | null }).note).toBeNull();
    history.undo();
    expect(doc.notes.get('n1')?.title).toBe('Auberge');
    expect((doc.object('p1')!.props as { note: string | null }).note).toBe('n1');
    expect((doc.object('z1')!.props as { note: string | null }).note).toBe('n1');
    expect(sent.slice(3)).toEqual(['undo:note.add', 'undo:object.update', 'undo:object.update']);
    history.redo();
    expect(doc.notes.list()).toEqual([]);
  });
});

describe('note objects in the scene model', () => {
  const bounds = { width: 30, height: 30 };

  it('normalises and keeps the props of the four types', () => {
    const p = normalizeObject(pin('p', 1.23456, 2, 'n1'), bounds);
    expect(p.geometry).toEqual({ x: 1.235, y: 2 });
    expect(p.props).toMatchObject({ icon: 'place', note: 'n1' });
    const z = normalizeObject(
      zone('z', [
        [0, 0],
        [4, 0],
        [4, 4],
      ]),
      bounds,
    );
    expect(z.geometry).toEqual({
      polygon: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
    });
    const s = normalizeObject(passage('s', [1, 1], [4, 1]), bounds);
    expect(s.geometry).toEqual({ a: [1, 1], b: [4, 1] });
  });

  it('refuses a polygon of 2 points and a passage longer than 20 cells', () => {
    expect(() =>
      normalizeObject(
        zone('z', [
          [0, 0],
          [4, 0],
        ]),
        bounds,
      ),
    ).toThrow(MapOpError);
    expect(() => normalizeObject(passage('s', [0, 0], [25, 0]), { width: 40, height: 40 })).toThrow(
      MapOpError,
    );
  });
});
