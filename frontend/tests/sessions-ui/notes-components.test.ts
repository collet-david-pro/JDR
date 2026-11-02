import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import MapNotesList from '../../src/components/sessions/MapNotesList.svelte';
import NoteShareDialog from '../../src/components/sessions/NoteShareDialog.svelte';
import SecretsList from '../../src/components/sessions/SecretsList.svelte';
import ZoneSuggestions from '../../src/components/sessions/ZoneSuggestions.svelte';
import PlayerNotes from '../../src/components/play/PlayerNotes.svelte';
import { createSessionState } from '../../src/lib/sessions';
import { snapshot } from '../sessions/fixtures';

const notes = {
  n1: {
    uid: 'n1',
    title: 'Crypte',
    body: 'Texte',
    asset_id: null,
    audience: 'all',
    audience_users: [],
    read_aloud: false,
  },
  n2: {
    uid: 'n2',
    title: 'Alpha',
    body: 'x',
    asset_id: null,
    audience: 'gm',
    audience_users: [],
    read_aloud: false,
  },
};
const send = async (): Promise<boolean> => true;
const gmRun = (extra = {}) =>
  ({
    state: { ...createSessionState(snapshot('gm'), '1'), notes, ...extra },
    scene: { floor: '35' },
    zoneSuggestions: [],
    dismissSuggestion: () => undefined,
  }) as never;

describe('console notes components', () => {
  it('MapNotesList lists the notes sorted with audience, Read and Share', () => {
    const out = render(MapNotesList, { props: { run: gmRun(), gameId: '1', send } }).body;
    expect(out.indexOf('Alpha')).toBeLessThan(out.indexOf('Crypte'));
    expect(out).toContain('map-note-read');
    expect(out).toContain('map-note-share');
    expect(out).toContain('data-audience="gm"');
  });
  it('NoteShareDialog offers the three audiences', () => {
    const note = notes.n1 as never;
    const out = render(NoteShareDialog, { props: { open: true, note, gameId: '1', send } }).body;
    for (const id of ['share-gm', 'share-players', 'share-all']) expect(out).toContain(id);
  });
  it('SecretsList shows state and the Reveal button of an unrevealed trap only', () => {
    const base = {
      floor: '35',
      layer: 'props',
      visibility: 'hidden_until_revealed',
      locked: false,
      sort_order: 0,
      rev: 1,
    };
    const objects = {
      t1: {
        ...base,
        uid: 't1',
        type: 'trap',
        geometry: { x: 1, y: 1 },
        props: { note: 'n1', reveal_effect: 'pulse' },
      },
      t2: {
        ...base,
        uid: 't2',
        type: 'trap',
        geometry: { x: 2, y: 1 },
        props: { note: null, reveal_effect: 'none' },
      },
    };
    const out = render(SecretsList, {
      props: { run: gmRun({ objects, revealed: ['t2'] }), send },
    }).body;
    expect(out.match(/secret-reveal/g)).toHaveLength(1);
    expect(out).toContain('Crypte');
  });
  it('ZoneSuggestions prints nothing without suggestion and a read button with one', () => {
    expect(render(ZoneSuggestions, { props: { run: gmRun(), send } }).body).not.toContain(
      'zone-read',
    );
    const run = {
      ...(gmRun() as object),
      zoneSuggestions: [{ zoneUid: 'z', noteUid: 'n1', title: 'Crypte', at: Date.now() }],
    } as never;
    expect(render(ZoneSuggestions, { props: { run, send } }).body).toContain('zone-read');
  });
  it('PlayerNotes shows the counter only with notes, never the GM-only data', () => {
    const player = createSessionState(snapshot('player'), '7');
    const none = render(PlayerNotes, { props: { run: { state: player } as never } }).body;
    expect(none).not.toContain('play-notes-button');
    const some = render(PlayerNotes, {
      props: {
        run: {
          state: {
            ...player,
            notes: { n1: { uid: 'n1', title: 'Crypte', body: 'b', asset_id: null } },
          },
        } as never,
      },
    }).body;
    expect(some).toContain('play-notes-button');
  });
});
