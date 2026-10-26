/**
 * Typed errors of the session endpoints (etapes/P06 D12, projet.md 9.1). The API client throws
 * ApiError; `classifySessionError` tells which session case it is.
 */
import { ApiError } from '../api';

export const SESSION_ERROR_CODES = [
  'session_exists',
  'invalid_transition',
  'session_paused',
  'session_not_running',
  'session_code_invalid',
  'session_not_joinable',
  'kicked',
  'blocked_by_wall',
  'events_gone',
  'rate_limited',
] as const;

export type SessionErrorCode = (typeof SESSION_ERROR_CODES)[number];

export interface SessionErrorInfo {
  readonly code: SessionErrorCode;
  readonly status: number;
  /** Seconds to wait (429). */
  readonly retryAfter: number | null;
  /** 409 session_exists: the open session of the game. */
  readonly sessionId: string | null;
  readonly fields: Readonly<Record<string, string>>;
}

/** The session error behind `error`, null for any other error (network, 401, 404...). */
export function classifySessionError(error: unknown): SessionErrorInfo | null {
  if (!(error instanceof ApiError)) return null;
  const known = (SESSION_ERROR_CODES as readonly string[]).includes(error.code);
  const code: SessionErrorCode | null =
    error.status === 429 ? 'rate_limited' : known ? (error.code as SessionErrorCode) : null;
  if (code === null) return null;
  return {
    code,
    status: error.status,
    retryAfter: error.retryAfter,
    sessionId: error.fields['session_id'] ?? null,
    fields: error.fields,
  };
}

export function isSessionError(error: unknown, code: SessionErrorCode): boolean {
  return classifySessionError(error)?.code === code;
}
