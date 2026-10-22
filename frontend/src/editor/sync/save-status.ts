/**
 * Texts of the save indicator (projet.md 15.1: « Enregistré », « Enregistrement… »,
 * « Hors ligne — N modifications en attente », « Conflit résolu »). Keys are literal for the
 * i18n key check; the translator is injectable for tests.
 */
import { t as defaultT, type Translate } from '../../lib/i18n';
import type { SaveStatus } from './OpsQueue';

export function saveErrorText(code: string | null, t: Translate = defaultT): string {
  switch (code) {
    case 'revision_conflict':
      return t('editor.save.errors.revision_conflict');
    case 'unauthenticated':
      return t('editor.save.errors.unauthenticated');
    case 'forbidden':
      return t('editor.save.errors.forbidden');
    case 'not_found':
      return t('editor.save.errors.not_found');
    case 'validation_failed':
    case 'payload_too_large':
    case 'rejected':
      return t('editor.save.errors.rejected');
    default:
      return t('editor.save.errors.unknown');
  }
}

export function saveStatusText(status: SaveStatus, t: Translate = defaultT): string {
  switch (status.state) {
    case 'saved':
      return t('editor.save.saved');
    case 'saving':
      return t('editor.save.saving');
    case 'offline':
      return t('editor.save.offline', { count: status.pending });
    case 'conflict':
      return t('editor.save.conflict');
    case 'error':
      return saveErrorText(status.error, t);
  }
}

/** Badge style of a state. */
export function saveStatusTone(status: SaveStatus): 'ok' | 'info' | 'warn' | 'error' {
  switch (status.state) {
    case 'saved':
      return 'ok';
    case 'saving':
      return 'info';
    case 'offline':
    case 'conflict':
      return 'warn';
    case 'error':
      return 'error';
  }
}
