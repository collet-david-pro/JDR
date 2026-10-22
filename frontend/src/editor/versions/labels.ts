/** Texts of the History panel (literal keys for the i18n key check). */
import { t as defaultT, type Translate } from '../../lib/i18n';
import type { MapVersionKind } from '../../lib/types';

export function versionKindLabel(kind: MapVersionKind | string, t: Translate = defaultT): string {
  switch (kind) {
    case 'auto':
      return t('editor.versions.kinds.auto');
    case 'manual':
      return t('editor.versions.kinds.manual');
    case 'pre_restore':
      return t('editor.versions.kinds.pre_restore');
    case 'pre_generate':
      return t('editor.versions.kinds.pre_generate');
    case 'pre_update':
      return t('editor.versions.kinds.pre_update');
    default:
      return kind;
  }
}
