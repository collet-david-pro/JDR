/** Labels of the notes family (i18n keys written literally so the key check can find them). */
import type { NoteAudience, PinIcon, SecretKind } from '../contracts-notes';
import { t } from '../../lib/i18n';

/** Pin icons in display order. */
export const PIN_ICONS: readonly PinIcon[] = ['place', 'danger', 'treasure', 'npc', 'info'];
/** Secret kinds in display order. */
export const SECRET_KIND_LIST: readonly SecretKind[] = ['passage', 'room', 'object'];
/** Reveal effects in display order. */
export const REVEAL_EFFECTS: readonly ('pulse' | 'none')[] = ['pulse', 'none'];

/** Label of a pin icon. */
export function pinIconLabel(icon: PinIcon): string {
  switch (icon) {
    case 'place':
      return t('editor.notes.pin_icons.place');
    case 'danger':
      return t('editor.notes.pin_icons.danger');
    case 'treasure':
      return t('editor.notes.pin_icons.treasure');
    case 'npc':
      return t('editor.notes.pin_icons.npc');
    case 'info':
      return t('editor.notes.pin_icons.info');
  }
}

/** Label of a secret kind. */
export function secretKindLabel(kind: SecretKind): string {
  switch (kind) {
    case 'passage':
      return t('editor.notes.secret_kinds.passage');
    case 'room':
      return t('editor.notes.secret_kinds.room');
    case 'object':
      return t('editor.notes.secret_kinds.object');
  }
}

/** Label of a reveal effect. */
export function revealEffectLabel(effect: 'pulse' | 'none'): string {
  return effect === 'pulse' ? t('editor.notes.reveal.pulse') : t('editor.notes.reveal.none');
}

/** Short badge text of a note audience. */
export function audienceBadge(audience: NoteAudience): string {
  switch (audience) {
    case 'gm':
      return t('editor.notes.audience.gm');
    case 'players':
      return t('editor.notes.audience.players');
    case 'all':
      return t('editor.notes.audience.all');
  }
}

/** True for the objects of the notes family. */
export function isNoteFamily(type: string): boolean {
  return type === 'pin' || type === 'zone' || type === 'trap' || type === 'secret';
}

/** Layer fixed by the server for this object (passage: walls, zone: gm). */
export function layerImposed(o: { type: string; geometry: unknown }): boolean {
  if (o.type === 'zone') return true;
  return (
    o.type === 'secret' &&
    typeof o.geometry === 'object' &&
    o.geometry !== null &&
    'a' in o.geometry
  );
}

/** Visibility fixed by the server (zone: gm, trap and secret: hidden until revealed). */
export function visibilityImposed(o: { type: string }): boolean {
  return o.type === 'zone' || o.type === 'trap' || o.type === 'secret';
}
