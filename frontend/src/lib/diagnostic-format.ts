/**
 * Readable text of a diagnostic check value (GET /admin/diagnostic): scalars as is,
 * booleans as yes / no, objects as "key: value" pairs, arrays as truncated lists (for
 * instance the modified / missing files of the integrity check).
 */

import type { Translate } from './translator';

/** Maximum number of array items shown before "+N". */
export const MAX_LIST_ITEMS = 5;

export function formatCheckValue(value: unknown, t: Translate, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return t(value ? 'common.yes' : 'common.no');
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return t('admin.diagnostic.none');
    const shown = value
      .slice(0, MAX_LIST_ITEMS)
      .map((item) => formatCheckValue(item, t, depth + 1))
      .join(', ');
    const rest = value.length - MAX_LIST_ITEMS;
    return rest > 0 ? `${shown} ${t('admin.diagnostic.more', { count: rest })}` : shown;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '';
    if (depth > 1) return entries.map(([key]) => key).join(', ');
    const text = entries
      .map(([key, item]) => {
        const formatted = formatCheckValue(item, t, depth + 1);
        return formatted === '' ? key : `${key} : ${formatted}`;
      })
      .join(' · ');
    return depth > 0 ? `{${text}}` : text;
  }
  return '';
}
