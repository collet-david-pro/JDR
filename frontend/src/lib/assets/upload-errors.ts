/**
 * Explicit, translated upload errors: refusals decided before sending (UploadRejected)
 * and server codes of the import pipeline (projet.md 11.3), with the limits in the text.
 */

import { ApiError } from '../api';
import { errorMessageKey } from '../errors';
import { formatBytes, formatDuration } from '../format';
import type { Translate, TranslationParams } from '../translator';
import type { AssetLimits } from '../types';
import { UploadRejected } from './reduce';

export interface UploadFailure {
  /** i18n key. */
  readonly key: string;
  readonly params: TranslationParams;
  readonly requestId: string | null;
}

/** Server codes that get a dedicated, more explicit message. */
export const UPLOAD_ERROR_CODES = [
  'file_too_large',
  'unsupported_type',
  'image_too_large',
  'animation_too_long',
  'quota_exceeded',
] as const;

function limitParams(limits: AssetLimits | null): TranslationParams {
  if (limits === null) return {};
  return {
    max: formatBytes(limits.max_upload_bytes),
    dimension: limits.max_dimension_px,
    frames: limits.max_frames,
    duration: formatDuration(limits.max_animation_ms / 1000),
  };
}

export function failureFromError(error: unknown, limits: AssetLimits | null): UploadFailure {
  const params = limitParams(limits);
  if (error instanceof UploadRejected) {
    return { key: `library.upload.reject.${error.reason}`, params, requestId: null };
  }
  if (error instanceof ApiError) {
    const code = error.code;
    if ((UPLOAD_ERROR_CODES as readonly string[]).includes(code)) {
      const known = limits !== null || code === 'unsupported_type' || code === 'quota_exceeded';
      return {
        key: known ? `library.upload.errors.${code}` : `errors.${code}`,
        params,
        requestId: error.requestId,
      };
    }
    if (code === 'rate_limited' && error.retryAfter !== null) {
      return {
        key: 'errors.rate_limited_for',
        params: { duration: formatDuration(error.retryAfter) },
        requestId: error.requestId,
      };
    }
    return { key: errorMessageKey(code), params: {}, requestId: error.requestId };
  }
  return { key: 'errors.unknown', params: {}, requestId: null };
}

/** Translated text of a failure (falls back to errors.unknown for unknown codes). */
export function failureText(failure: UploadFailure, t: Translate): string {
  const text = t(failure.key, failure.params);
  return text === failure.key ? t('errors.unknown') : text;
}
