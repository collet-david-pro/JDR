/**
 * Readable text of a refused batch of ops (P9b2a): the notes errors of the server
 * (`ops.<i>.note.<key>`, `ops.<i>.patch.<key>`, `ops.<i> = limit`) say what to change.
 * Anything else: the generic "rejected" text.
 */
import { t as defaultT } from '../../lib/i18n';
import type { Translate } from '../../lib/translator';
import { saveErrorText } from './save-status';

const NOTE_FIELD = /^ops\.\d+\.(?:note|patch)\.[a-z_]+$/;
const OP_FIELD = /^ops\.\d+$/;

export function rejectionText(
  error: { readonly code: string; readonly fields?: Readonly<Record<string, string>> },
  t: Translate = defaultT,
): string {
  for (const [field, code] of Object.entries(error.fields ?? {})) {
    if (OP_FIELD.test(field) && code === 'limit') return t('validation.limit');
    if (!NOTE_FIELD.test(field)) continue;
    switch (code) {
      case 'required':
        return t('validation.required');
      case 'invalid':
        return t('validation.invalid');
      case 'too_long':
        return t('validation.too_long');
      case 'too_many':
      case 'limit':
        return t('validation.limit');
      case 'taken':
        return t('validation.taken');
      case 'not_found':
        return t('validation.not_found');
      case 'not_member':
        return t('validation.not_member');
    }
  }
  return saveErrorText('rejected', t);
}
