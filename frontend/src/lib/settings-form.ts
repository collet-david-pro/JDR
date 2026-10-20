/**
 * Administration settings form (contract P1, GET|PATCH /admin/settings): conversion between
 * the API object and string form values (sizes in Mo), checks, and the PATCH body made of
 * the changed fields only. The SMTP password is write-only: sent only when typed.
 */

import { bytesToMbInput, mbInputToBytes } from './format';
import type { SiteSettings, SmtpSettings } from './types';
import { checkEmail, collectErrors, type FieldErrors } from './validation';

export const TEXT_KEYS = ['site_name', 'base_url', 'default_locale', 'registration_mode'] as const;
export const MB_KEYS = ['default_quota_bytes', 'max_upload_bytes'] as const;
export const INT_KEYS = [
  'max_dimension_px',
  'max_total_pixels',
  'max_frames',
  'max_animation_ms',
  'events_retention_hours',
  'versions_retention',
  'trash_days',
  'session_idle_hours',
] as const;
export const FLAG_KEYS = ['use_db_sessions', 'maintenance'] as const;
export const SMTP_TEXT_KEYS = [
  'host',
  'encryption',
  'username',
  'from_email',
  'from_name',
] as const;

type FlagKey = (typeof FLAG_KEYS)[number];

/** Server field names of the string-valued form fields ("smtp.host" for SMTP fields). */
export type SettingsValueKey =
  | (typeof TEXT_KEYS)[number]
  | (typeof MB_KEYS)[number]
  | (typeof INT_KEYS)[number]
  | `smtp.${(typeof SMTP_TEXT_KEYS)[number]}`
  | 'smtp.port';

/** Field values keyed by the server field names. */
export interface SettingsFormValues {
  values: Record<SettingsValueKey, string>;
  flags: Record<FlagKey, boolean>;
  /** New SMTP password; "" = unchanged. */
  smtpPassword: string;
}

export function toFormValues(settings: SiteSettings): SettingsFormValues {
  const values: Partial<Record<SettingsValueKey, string>> = {};
  for (const key of TEXT_KEYS) values[key] = settings[key];
  for (const key of MB_KEYS) values[key] = bytesToMbInput(settings[key]);
  for (const key of INT_KEYS) values[key] = String(settings[key]);
  for (const key of SMTP_TEXT_KEYS) values[`smtp.${key}`] = settings.smtp[key] ?? '';
  values['smtp.port'] = String(settings.smtp.port);
  return {
    values: values as Record<SettingsValueKey, string>,
    flags: { use_db_sessions: settings.use_db_sessions, maintenance: settings.maintenance },
    smtpPassword: '',
  };
}

function intValue(raw: string | undefined): number | undefined {
  const value = (raw ?? '').trim();
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

export function validateSettings(form: SettingsFormValues): FieldErrors {
  const v = form.values;
  const checks: Record<string, string | null> = {
    site_name: (v['site_name'] ?? '').trim() === '' ? 'required' : null,
    base_url: /^https?:\/\/\S+$/.test((v['base_url'] ?? '').trim()) ? null : 'invalid',
  };
  for (const key of MB_KEYS) {
    const bytes = mbInputToBytes(v[key] ?? '');
    checks[key] = bytes === null ? 'required' : bytes === undefined ? 'invalid' : null;
  }
  for (const key of INT_KEYS) checks[key] = intValue(v[key]) === undefined ? 'invalid' : null;
  const host = (v['smtp.host'] ?? '').trim();
  const port = intValue(v['smtp.port']);
  checks['smtp.port'] =
    host === '' || (port !== undefined && port >= 1 && port <= 65535) ? null : 'invalid';
  const from = (v['smtp.from_email'] ?? '').trim();
  checks['smtp.from_email'] = from === '' ? null : checkEmail(from);
  return collectErrors(checks);
}

export type SettingsPatch = Record<string, unknown> & { smtp?: Record<string, unknown> };

/** PATCH body with the changed fields only (call after validateSettings). */
export function buildSettingsPatch(
  original: SiteSettings,
  form: SettingsFormValues,
): SettingsPatch {
  const patch: SettingsPatch = {};
  const v = form.values;
  for (const key of TEXT_KEYS) {
    const value = (v[key] ?? '').trim();
    if (value !== original[key]) patch[key] = value;
  }
  for (const key of MB_KEYS) {
    const bytes = mbInputToBytes(v[key] ?? '');
    // Unchanged display value: keep the exact original byte count.
    if (typeof bytes === 'number' && (v[key] ?? '') !== bytesToMbInput(original[key])) {
      patch[key] = bytes;
    }
  }
  for (const key of INT_KEYS) {
    const value = intValue(v[key]);
    if (value !== undefined && value !== original[key]) patch[key] = value;
  }
  for (const key of FLAG_KEYS) if (form.flags[key] !== original[key]) patch[key] = form.flags[key];

  const smtp: Record<string, unknown> = {};
  for (const key of SMTP_TEXT_KEYS) {
    const value = (v[`smtp.${key}`] ?? '').trim();
    if (value !== original.smtp[key as keyof SmtpSettings]) smtp[key] = value;
  }
  const port = intValue(v['smtp.port']);
  if (port !== undefined && port !== original.smtp.port) smtp['port'] = port;
  if (form.smtpPassword !== '') smtp['password'] = form.smtpPassword;
  if (Object.keys(smtp).length > 0) patch.smtp = smtp;
  return patch;
}
