/**
 * Command builders for the notes (P9b2a). Labels are i18n keys. The history recomputes the
 * inverse ops from the document; `inverseOps` documents what undoing does.
 */
import type { Command, MapObject, MapOp } from '../contracts';
import type { FloorMeta } from './FloorSlot';
import type { MapNote, NoteObject, NoteValues } from '../contracts-notes';
import { noteValues } from './NotesState';

export function noteAddCommand(note: NoteValues & { readonly uid: string }): Command {
  return {
    label: 'editor.command.note_add',
    ops: [{ type: 'note.add', note }],
    inverseOps: [{ type: 'note.remove', uid: note.uid }],
  };
}

/** Null when the patch changes nothing. */
export function noteUpdateCommand(prev: MapNote, patch: Partial<NoteValues>): Command | null {
  const changed: Record<string, unknown> = {};
  const back: Record<string, unknown> = {};
  const before = prev as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (JSON.stringify(value) === JSON.stringify(before[key])) continue;
    changed[key] = value;
    back[key] = before[key];
  }
  if (Object.keys(changed).length === 0) return null;
  return {
    label: 'editor.command.note_update',
    ops: [{ type: 'note.update', uid: prev.uid, patch: changed as Partial<NoteValues> }],
    inverseOps: [{ type: 'note.update', uid: prev.uid, patch: back as Partial<NoteValues> }],
  };
}

/** The pins, zones, traps and secrets linked to a note, on the floors held in memory. */
export function linkedObjects(
  doc: {
    floors(): readonly FloorMeta[];
    objectsOf(floor: string): readonly MapObject[];
  },
  uid: string,
): NoteObject[] {
  const out: NoteObject[] = [];
  for (const floor of doc.floors()) {
    for (const o of doc.objectsOf(floor.uid)) {
      if (
        (o.type === 'pin' || o.type === 'zone' || o.type === 'trap' || o.type === 'secret') &&
        o.props.note === uid
      ) {
        out.push(o);
      }
    }
  }
  return out;
}

/**
 * Removes a note: its linked objects are detached first (`props.note = null`), then the note
 * goes. Undoing brings the note back, then the links (the server would detach on its own, but
 * the undo must restore them).
 */
export function noteRemoveCommand(note: MapNote, linked: readonly NoteObject[]): Command {
  const detach: MapOp[] = linked.map((o) => ({
    type: 'object.update',
    uid: o.uid,
    rev: o.rev,
    patch: { props: { ...o.props, note: null } as MapObject['props'] },
  }));
  const relink: MapOp[] = linked.map((o) => ({
    type: 'object.update',
    uid: o.uid,
    rev: o.rev,
    patch: { props: o.props },
  }));
  return {
    label: 'editor.command.note_remove',
    ops: [...detach, { type: 'note.remove', uid: note.uid }],
    inverseOps: [{ type: 'note.add', note: noteValues(note) }, ...relink],
  };
}

/** Link (or unlink with null) of a pin / zone / trap / secret to a note: full props are kept. */
export function noteLinkOp(o: NoteObject, note: string | null): MapOp {
  return {
    type: 'object.update',
    uid: o.uid,
    rev: o.rev,
    patch: { props: { ...o.props, note } as MapObject['props'] },
  };
}
