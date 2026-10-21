/**
 * Client-side validation, aligned with the server rules (projet.md 6.4, contract P1).
 * The server stays the authority: its `fields` codes (422 validation_failed) are displayed
 * the same way (i18n `validation.<code>`, optionally `validation.fields.<field>.<code>`).
 */

import { ApiError } from './api';
import type { Translate } from './translator';

export const VALIDATION_CODES = [
  'required',
  'invalid',
  'too_short',
  'too_long',
  'too_common',
  'taken',
  'mismatch',
  'wrong_password',
  'too_small',
  'too_large',
  'not_found',
] as const;

export type ValidationCode = (typeof VALIDATION_CODES)[number];

/** Field name → validation code. */
export type FieldErrors = Readonly<Record<string, string>>;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;
export const USERNAME_PATTERN = /^[\p{L}\p{N}_ .-]{3,40}$/u;
export const EMAIL_MAX = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function length(value: string): number {
  return [...value].length;
}

export function checkRequired(value: string): ValidationCode | null {
  return value.trim() === '' ? 'required' : null;
}

export function checkEmail(value: string): ValidationCode | null {
  const v = value.trim();
  if (v === '') return 'required';
  if (length(v) > EMAIL_MAX) return 'too_long';
  return EMAIL_PATTERN.test(v) ? null : 'invalid';
}

export function checkUsername(value: string): ValidationCode | null {
  const v = value.trim();
  if (v === '') return 'required';
  if (length(v) < 3) return 'too_short';
  if (length(v) > 40) return 'too_long';
  return USERNAME_PATTERN.test(v) ? null : 'invalid';
}

export function checkPassword(value: string): ValidationCode | null {
  if (value === '') return 'required';
  if (length(value) < PASSWORD_MIN) return 'too_short';
  if (length(value) > PASSWORD_MAX) return 'too_long';
  return null;
}

export function checkConfirmation(password: string, confirmation: string): ValidationCode | null {
  if (confirmation === '') return 'required';
  return password === confirmation ? null : 'mismatch';
}

/** Keeps the failed checks only. */
export function collectErrors(checks: Readonly<Record<string, string | null>>): FieldErrors {
  const errors: Record<string, string> = {};
  for (const [field, code] of Object.entries(checks)) if (code !== null) errors[field] = code;
  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Field errors of a 422 validation_failed response. `rename` maps server field names to
 * form field names (e.g. {new_password: 'password'}).
 */
export function serverFieldErrors(
  error: unknown,
  rename: Readonly<Record<string, string>> = {},
): FieldErrors {
  if (!(error instanceof ApiError) || error.code !== 'validation_failed') return {};
  const errors: Record<string, string> = {};
  for (const [field, code] of Object.entries(error.fields)) {
    errors[rename[field] ?? field] = code.trim();
  }
  return errors;
}

function isValidationCode(code: string): code is ValidationCode {
  return (VALIDATION_CODES as readonly string[]).includes(code);
}

/**
 * Message of a field error: `validation.fields.<field>.<code>` when it exists, otherwise
 * `validation.<code>` (unknown codes fall back to `validation.invalid`).
 */
export function validationMessage(
  field: string,
  code: string,
  t: Translate,
  tryT: (key: string) => string | null,
): string {
  const specific = tryT(`validation.fields.${field}.${code}`);
  if (specific !== null) return specific;
  return t(`validation.${isValidationCode(code) ? code : 'invalid'}`);
}
