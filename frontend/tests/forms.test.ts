import { describe, expect, it } from 'vitest';
import { buildUserPatch } from '../src/lib/admin-users';
import { ApiError } from '../src/lib/api';
import {
  normalizeInvitationCode,
  validateNewPassword,
  validateRegister,
} from '../src/lib/auth-forms';
import { errorMessage } from '../src/lib/errors';
import { FormState } from '../src/lib/form.svelte';
import { t } from '../src/lib/i18n';
import type { User } from '../src/lib/types';
import {
  checkEmail,
  checkPassword,
  checkUsername,
  serverFieldErrors,
  validationMessage,
} from '../src/lib/validation';

const validation = (fields: Record<string, string>) =>
  new ApiError({ code: 'validation_failed', message: 'x', status: 422, fields, requestId: 'r1' });

describe('client checks (aligned with the server rules)', () => {
  it('checks passwords: 10 to 256 characters', () => {
    expect(checkPassword('')).toBe('required');
    expect(checkPassword('123456789')).toBe('too_short');
    expect(checkPassword('1234567890')).toBeNull();
    expect(checkPassword('x'.repeat(257))).toBe('too_long');
    expect(checkPassword('é'.repeat(10))).toBeNull();
  });

  it('checks usernames with ^[\\p{L}\\p{N}_ .-]{3,40}$', () => {
    expect(checkUsername('Ana')).toBeNull();
    expect(checkUsername('Élodie_42 .-')).toBeNull();
    expect(checkUsername('ab')).toBe('too_short');
    expect(checkUsername('a'.repeat(41))).toBe('too_long');
    expect(checkUsername('ana@home')).toBe('invalid');
    expect(checkUsername('<script>')).toBe('invalid');
    expect(checkUsername('  ')).toBe('required');
  });

  it('checks e-mail addresses', () => {
    expect(checkEmail('ana@example.test')).toBeNull();
    expect(checkEmail('ana@')).toBe('invalid');
    expect(checkEmail('ana example@x.y')).toBe('invalid');
    expect(checkEmail('')).toBe('required');
  });

  it('validates the registration form', () => {
    expect(
      validateRegister({
        email: 'bad',
        username: 'Ana',
        password: 'short',
        confirmation: 'other',
        invitationCode: '',
      }),
    ).toEqual({
      email: 'invalid',
      password: 'too_short',
      password_confirmation: 'mismatch',
      invitation_code: 'required',
    });
    expect(
      validateRegister({
        email: 'ana@example.test',
        username: 'Ana',
        password: 'long enough pw',
        confirmation: 'long enough pw',
        invitationCode: null,
      }),
    ).toEqual({});
    expect(validateNewPassword('long enough pw', '')).toEqual({
      password_confirmation: 'required',
    });
    expect(normalizeInvitationCode(' AB CD-12 ')).toBe('ABCD-12');
  });
});

describe('server errors', () => {
  it('maps 422 fields (with renaming) and ignores other errors', () => {
    expect(
      serverFieldErrors(validation({ email: 'taken', new_password: 'too_common' }), {
        new_password: 'password',
      }),
    ).toEqual({
      email: 'taken',
      password: 'too_common',
    });
    expect(
      serverFieldErrors(new ApiError({ code: 'forbidden', message: '', status: 403 })),
    ).toEqual({});
  });

  it('translates field codes, field-specific messages first', () => {
    const lookup = (key: string): string | null =>
      ({ 'validation.fields.password.too_short': 'Au moins 10 caractères.' })[key] ?? null;
    const tr = (key: string): string => `T:${key}`;
    expect(validationMessage('password', 'too_short', tr, lookup)).toBe('Au moins 10 caractères.');
    expect(validationMessage('email', 'taken', tr, lookup)).toBe('T:validation.taken');
    expect(validationMessage('email', 'weird_code', tr, lookup)).toBe('T:validation.invalid');
  });

  it('formats rate limiting with the waiting time', () => {
    const tr = (key: string, params?: Readonly<Record<string, string | number>>) =>
      `${key} ${JSON.stringify(params ?? {})}`;
    const error = new ApiError({ code: 'rate_limited', message: '', status: 429, retryAfter: 90 });
    expect(errorMessage(error, tr).replace(/[\u00a0\u202f]/g, ' ')).toBe(
      'errors.rate_limited_for {"duration":"2 minutes"}',
    );
  });
});

describe('FormState', () => {
  it('stops on client errors without calling the server', async () => {
    const form = new FormState();
    let called = false;
    const ok = await form.submit(
      () => {
        called = true;
        return Promise.resolve();
      },
      { validate: () => ({ email: 'required' }) },
    );
    expect(ok).toBe(false);
    expect(called).toBe(false);
    expect(form.errors).toEqual({ email: 'required' });
    expect(form.message('email')).toBe(t('validation.required'));
  });

  it('maps a 422 answer to the fields and other errors to the form', async () => {
    const form = new FormState();
    expect(await form.submit(() => Promise.reject(validation({ username: 'taken' })))).toBe(false);
    expect(form.errors).toEqual({ username: 'taken' });
    expect(form.failure).toBeNull();

    const failure = new ApiError({
      code: 'invalid_credentials',
      message: '',
      status: 401,
      requestId: 'rq-9',
    });
    expect(await form.submit(() => Promise.reject(failure))).toBe(false);
    expect(form.errors).toEqual({});
    expect(form.failure?.requestId).toBe('rq-9');
    expect(form.submitting).toBe(false);
  });

  it('returns true on success', async () => {
    const form = new FormState();
    expect(await form.submit(() => Promise.resolve(), { validate: () => ({}) })).toBe(true);
  });
});

describe('admin user patch', () => {
  const user: User = {
    id: '3',
    email: 'bob@example.test',
    username: 'Bob',
    role: 'user',
    status: 'active',
    locale: 'fr',
    storage_quota_bytes: 500 * 1024 * 1024,
    storage_used_bytes: 0,
    email_verified_at: null,
    last_login_at: null,
    created_at: '2026-10-20T00:00:00Z',
  };

  it('sends changed fields only and converts Mo to bytes', () => {
    expect(
      buildUserPatch(user, { username: 'Bob', email: user.email, role: 'user', quotaMb: '500' }),
    ).toEqual({});
    expect(
      buildUserPatch(user, { username: 'Bobby', email: user.email, role: 'admin', quotaMb: '1,5' }),
    ).toEqual({
      username: 'Bobby',
      role: 'admin',
      storage_quota_bytes: 1572864,
    });
  });

  it('resets the quota to the default with an empty value', () => {
    expect(
      buildUserPatch(user, { username: 'Bob', email: user.email, role: 'user', quotaMb: '' }),
    ).toEqual({
      storage_quota_bytes: null,
    });
  });
});
