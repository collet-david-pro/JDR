/** Client checks of the account forms (shared by pages and tests). */

import {
  checkConfirmation,
  checkEmail,
  checkPassword,
  checkRequired,
  checkUsername,
  collectErrors,
  type FieldErrors,
} from './validation';

export interface RegisterValues {
  readonly email: string;
  readonly username: string;
  readonly password: string;
  readonly confirmation: string;
  /** Required in "invite" registration mode. */
  readonly invitationCode: string | null;
}

export function validateRegister(values: RegisterValues): FieldErrors {
  return collectErrors({
    email: checkEmail(values.email),
    username: checkUsername(values.username),
    password: checkPassword(values.password),
    password_confirmation: checkConfirmation(values.password, values.confirmation),
    invitation_code: values.invitationCode === null ? null : checkRequired(values.invitationCode),
  });
}

export function validateNewPassword(password: string, confirmation: string): FieldErrors {
  return collectErrors({
    password: checkPassword(password),
    password_confirmation: checkConfirmation(password, confirmation),
  });
}

/** Invitation codes are case-insensitive; spaces from a copy-paste are dropped. */
export function normalizeInvitationCode(code: string): string {
  return code.replace(/\s+/g, '');
}
