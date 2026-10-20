import { ApiError } from './api';
import type { Translate } from './translator';

/** i18n key of an error code (server codes of section 9.1 + client codes of api.ts). */
export function errorMessageKey(code: string): string {
  switch (code) {
    case 'network_error':
      return 'errors.network';
    case 'timeout':
      return 'errors.timeout';
    case 'invalid_response':
    case 'http_error':
    case 'aborted':
      return 'errors.unknown';
    default:
      return `errors.${code}`;
  }
}

/** User-facing message of an error, translated; falls back to errors.unknown. */
export function errorMessage(error: unknown, t: Translate): string {
  const code = error instanceof ApiError ? error.code : 'unknown';
  const key = errorMessageKey(code);
  const message = t(key);
  return message === key ? t('errors.unknown') : message;
}
