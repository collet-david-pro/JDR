/**
 * Reducers of the note events (P9b2b): `note.shared` (a note gained or changed), `note.hidden`
 * (lost) and `zone.entered` (GM, ephemeral: suggestion to read the note of a zone).
 */
import type { MapNote, PlayerNote } from '../../editor/contracts-notes';
import type { WireEvent } from '../realtime/types';
import { NO_EFFECTS } from './effects';
import type { Reduction } from './reducer';
import type { SessionState } from './state';

type Handler = (s: SessionState, e: WireEvent, p: Record<string, unknown>) => Reduction | null;

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Handles the event announcing a shared note. */
export const onNoteShared: Handler = (s, _e, p) => {
  const raw = p['note'];
  if (typeof raw !== 'object' || raw === null) return null;
  const note = raw as MapNote | PlayerNote;
  if (typeof note.uid !== 'string') return null;
  return { state: { ...s, notes: { ...s.notes, [note.uid]: note } }, effects: NO_EFFECTS };
};

/** Handles the event announcing a hidden note. */
export const onNoteHidden: Handler = (s, _e, p) => {
  const uid = text(p['uid']);
  if (uid === null || !(uid in s.notes)) return null;
  const notes = { ...s.notes } as Record<string, MapNote | PlayerNote>;
  delete notes[uid];
  return { state: { ...s, notes }, effects: NO_EFFECTS };
};

/** Handles the event announcing a zone entered by a token. */
export const onZoneEntered: Handler = (s, _e, p) => {
  const zoneUid = text(p['zone_uid']);
  const noteUid = text(p['note_uid']);
  if (s.role !== 'gm' || zoneUid === null || noteUid === null) return null;
  return {
    state: s,
    effects: [{ kind: 'zone.suggest', zoneUid, noteUid, title: text(p['title']) ?? '' }],
  };
};
