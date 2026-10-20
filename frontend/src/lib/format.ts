/**
 * Locale-aware formatting (projet.md section 13.1: dates and numbers through Intl).
 * Sizes use binary multiples (1 Mo = 1 048 576 octets), consistently with the quotas.
 */

import { locale } from './i18n';

export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;

const cache = new Map<string, Intl.NumberFormat>();

function unitFormat(unit: string, digits: number, display: 'short' | 'long' = 'short') {
  const key = `${unit}:${digits}:${display}`;
  let format = cache.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit,
      unitDisplay: display,
      maximumFractionDigits: digits,
    });
    cache.set(key, format);
  }
  return format;
}

/** "512 ko", "12,5 Mo", "1,25 Go". */
export function formatBytes(bytes: number): string {
  const abs = Math.abs(bytes);
  if (abs >= GIB) {
    const value = bytes / GIB;
    return unitFormat('gigabyte', Math.abs(value) < 10 ? 2 : 1).format(value);
  }
  if (abs >= MIB || abs === 0) {
    const value = bytes / MIB;
    return unitFormat('megabyte', Math.abs(value) < 100 ? 1 : 0).format(value);
  }
  return unitFormat('kilobyte', 0).format(Math.max(1, Math.round(bytes / 1024)));
}

/** Bytes → megabytes for a form field ("" for null). */
export function bytesToMbInput(bytes: number | null): string {
  if (bytes === null) return '';
  return String(Math.round((bytes / MIB) * 100) / 100);
}

/**
 * Form value in megabytes → bytes. Empty ⇒ null (default value). Returns undefined when
 * the input is not a non-negative number.
 */
export function mbInputToBytes(value: string): number | null | undefined {
  const trimmed = value.trim().replace(',', '.');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;
  return Math.round(Number(trimmed) * MIB);
}

const dateTimeFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

/** "20 oct. 2026, 21:35" (local time). Invalid or null dates give "". */
export function formatDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormat.format(date);
}

/** "45 secondes", "3 minutes", "2 heures" (rounded up). */
export function formatDuration(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return unitFormat('second', 0, 'long').format(s);
  if (s < 3600) return unitFormat('minute', 0, 'long').format(Math.ceil(s / 60));
  return unitFormat('hour', 0, 'long').format(Math.ceil(s / 3600));
}

/** Ratio used/quota in [0, 1]; null when the quota is unlimited or zero. */
export function usageRatio(used: number, quota: number | null): number | null {
  if (quota === null || quota <= 0) return null;
  return Math.min(1, Math.max(0, used / quota));
}
