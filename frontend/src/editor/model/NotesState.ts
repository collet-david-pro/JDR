/**
 * Notes of the map (P9b2a): a plain list outside the scenes (a note belongs to the map, not to a
 * floor). Applies the `note.*` ops and returns their inverse, like the scene state does.
 * `secrets.reset` only has an effect on the server: here it is a no-op without inverse.
 */
import type { MapOp } from '../contracts';
import type { MapNote, NoteOp, NoteValues } from '../contracts-notes';
import { MapOpError } from './ops';

export const MAX_NOTES = 500;
export const MAX_NOTE_BODY = 20_000;
export const MAX_NOTE_TITLE = 120;

export function isNoteOp(op: MapOp): op is NoteOp {
  return (
    op.type === 'note.add' ||
    op.type === 'note.update' ||
    op.type === 'note.remove' ||
    op.type === 'secrets.reset'
  );
}

function bad(message: string): never {
  throw new MapOpError('bad_note', message);
}

/** The full values of a stored note (what `note.add` needs to bring it back). */
export function noteValues(note: MapNote): NoteValues & { readonly uid: string } {
  return {
    uid: note.uid,
    title: note.title,
    body: note.body,
    asset_id: note.asset_id,
    audience: note.audience,
    audience_users: note.audience === 'players' ? [...note.audience_users] : [],
    read_aloud: note.read_aloud,
  };
}

function checkValues(v: Partial<NoteValues>): void {
  if (v.title !== undefined && (v.title.trim() === '' || v.title.length > MAX_NOTE_TITLE)) {
    bad('Invalid note title');
  }
  if (v.body !== undefined && v.body.length > MAX_NOTE_BODY) bad('Note body too long');
}

export class NotesState {
  private notes: readonly MapNote[] = [];
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(initial: readonly MapNote[] = []) {
    this.notes = [...initial];
  }

  list(): readonly MapNote[] {
    return this.notes;
  }

  get revision(): number {
    return this.version;
  }

  get(uid: string): MapNote | undefined {
    return this.notes.find((n) => n.uid.toLowerCase() === uid.toLowerCase());
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Server state (load, conflict): not an op, not undoable. */
  load(notes: readonly MapNote[]): void {
    this.set([...notes]);
  }

  /** Server state of one note after a conflict (null: removed). */
  replace(uid: string, value: MapNote | null): void {
    const rest = this.notes.filter((n) => n.uid !== uid);
    this.set(value === null ? rest : [...rest, value]);
  }

  apply(op: NoteOp): { op: NoteOp; inverse: NoteOp | null } {
    switch (op.type) {
      case 'secrets.reset':
        return { op, inverse: null };
      case 'note.add': {
        const n = op.note;
        checkValues(n);
        if (this.get(n.uid) !== undefined) bad(`Note ${n.uid} already exists`);
        if (this.notes.length >= MAX_NOTES) bad('Too many notes');
        const audience = n.audience ?? 'gm';
        const note: MapNote = {
          uid: n.uid,
          title: n.title,
          body: n.body,
          asset_id: n.asset_id ?? null,
          audience,
          audience_users: audience === 'players' ? [...(n.audience_users ?? [])] : [],
          read_aloud: n.read_aloud ?? false,
        };
        this.set([...this.notes, note]);
        return { op, inverse: { type: 'note.remove', uid: n.uid } };
      }
      case 'note.update': {
        const prev = this.get(op.uid);
        if (prev === undefined) return { op, inverse: null };
        checkValues(op.patch);
        const next: Record<string, unknown> = { ...prev };
        const back: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(op.patch)) {
          if (value === undefined) continue;
          back[key] = (prev as unknown as Record<string, unknown>)[key];
          next[key] = value;
        }
        const note = next as unknown as MapNote;
        if (note.audience !== 'players') next['audience_users'] = [];
        else if (back['audience'] !== undefined && back['audience_users'] === undefined) {
          back['audience_users'] = [...prev.audience_users];
        }
        this.set(this.notes.map((n) => (n === prev ? (next as unknown as MapNote) : n)));
        return {
          op,
          inverse: { type: 'note.update', uid: prev.uid, patch: back as Partial<NoteValues> },
        };
      }
      case 'note.remove': {
        const prev = this.get(op.uid);
        if (prev === undefined) return { op, inverse: null };
        this.set(this.notes.filter((n) => n !== prev));
        return { op, inverse: { type: 'note.add', note: noteValues(prev) } };
      }
    }
  }

  private set(notes: readonly MapNote[]): void {
    this.notes = notes;
    this.version++;
    for (const l of [...this.listeners]) l();
  }
}
