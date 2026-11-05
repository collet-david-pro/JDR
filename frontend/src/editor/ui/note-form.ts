/** Draft of a note being edited in the dialog (P9b2a): pure, testable form logic. */
import type { MapNote, NoteAudience, NoteValues } from '../contracts-notes';
import { MAX_NOTE_BODY, MAX_NOTE_TITLE } from '../model/NotesState';

export interface NoteDraft {
  title: string;
  body: string;
  asset_id: string | null;
  audience: NoteAudience;
  audience_users: string[];
  read_aloud: boolean;
}

export type NoteErrors = Partial<
  Record<'title' | 'body' | 'audience_users', 'required' | 'too_long'>
>;

/** Returns an empty note draft. */
export function emptyDraft(): NoteDraft {
  return {
    title: '',
    body: '',
    asset_id: null,
    audience: 'gm',
    audience_users: [],
    read_aloud: false,
  };
}

/** Builds an editable draft from a note. */
export function draftOf(note: MapNote): NoteDraft {
  return {
    title: note.title,
    body: note.body,
    asset_id: note.asset_id,
    audience: note.audience,
    audience_users: [...note.audience_users],
    read_aloud: note.read_aloud,
  };
}

/** `canTargetPlayers`: false without a game (no list of players to choose from). */
export function validateDraft(draft: NoteDraft, canTargetPlayers: boolean): NoteErrors {
  const errors: NoteErrors = {};
  const title = draft.title.trim();
  if (title === '') errors.title = 'required';
  else if (title.length > MAX_NOTE_TITLE) errors.title = 'too_long';
  if (draft.body.length > MAX_NOTE_BODY) errors.body = 'too_long';
  if (draft.audience === 'players' && (!canTargetPlayers || draft.audience_users.length === 0)) {
    errors.audience_users = 'required';
  }
  return errors;
}

/** Values to send: title trimmed, no audience users unless the audience is `players`. */
export function draftValues(draft: NoteDraft): NoteValues {
  return {
    title: draft.title.trim(),
    body: draft.body,
    asset_id: draft.asset_id,
    audience: draft.audience,
    audience_users: draft.audience === 'players' ? [...draft.audience_users] : [],
    read_aloud: draft.read_aloud,
  };
}

/** i18n key of the label of a note audience. */
export function audienceLabelKey(audience: NoteAudience): string {
  switch (audience) {
    case 'gm':
      return 'editor.notes.audience.gm';
    case 'players':
      return 'editor.notes.audience.players';
    case 'all':
      return 'editor.notes.audience.all';
  }
}
