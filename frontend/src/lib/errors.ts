import { ApiError } from './api';
import { formatDuration } from './format';
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
  if (code === 'rate_limited' && error instanceof ApiError && error.retryAfter !== null) {
    return t('errors.rate_limited_for', { duration: formatDuration(error.retryAfter) });
  }
  const key = errorMessageKey(code);
  const message = t(key);
  return message === key ? t('errors.unknown') : message;
}

export interface ErrorSummary {
  readonly message: string;
  readonly requestId: string | null;
}

/** Message + request id (shown to help the administrator find the server log). */
export function describeError(error: unknown, t: Translate): ErrorSummary {
  return {
    message: errorMessage(error, t),
    requestId: error instanceof ApiError ? error.requestId : null,
  };
}
