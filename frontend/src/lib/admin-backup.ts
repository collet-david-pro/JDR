/**
 * Backups and restores of the administration (lot P10a): pure helpers, testable without Svelte.
 * The reactive model is in admin-backup.svelte.ts.
 */

import { ApiError } from './api';
import { describeError, type ErrorSummary } from './errors';
import type { Translate } from './translator';
import type { Job } from './types';

export type BackupKind = 'db' | 'assets';

/** Backup kinds. */
export const BACKUP_KINDS: readonly BackupKind[] = ['db', 'assets'];

/** Word to type before a restore (second check, with the "I understand" box). */
export const CONFIRM_WORD = 'RESTAURER';

export interface BackupLimits {
  readonly db_max_bytes: number;
  readonly assets_max_bytes: number;
  readonly chunk_bytes: number;
}

/** Database restore as the server describes it (POST /admin/backup/restore/db and its steps). */
export interface RestoreState {
  readonly id: string;
  readonly status: 'running' | 'done' | 'failed' | (string & {});
  readonly phase: 'scan' | 'apply' | 'done' | (string & {});
  readonly progress: { readonly done: number; readonly total: number; readonly percent: number };
  readonly version: string;
  readonly error: string | null;
  readonly schema_behind: boolean | null;
  /** Only in the answer of the start: authorizes the steps. */
  readonly token?: string;
}

/** GET /admin/backup */
export interface BackupInfo {
  readonly current_version: string;
  readonly limits: BackupLimits;
  readonly restore: RestoreState | null;
  readonly update_url: string;
}

/** Result of a finished assets restore (job assets_restore). */
export interface AssetsRestoreResult {
  readonly restored: number;
  readonly skipped: number;
  readonly rejected: number;
  readonly rejected_files: readonly string[];
}

export type RestoreOutcome =
  | { readonly kind: 'db'; readonly schemaBehind: boolean }
  | ({ readonly kind: 'assets' } & AssetsRestoreResult);

/** The restore button stays disabled until a file is chosen, the box is ticked and the word typed. */
export function isConfirmed(understood: boolean, word: string): boolean {
  return understood && word.trim() === CONFIRM_WORD;
}

/** True when a restore can be started in the given state. */
export function canStartRestore(state: {
  readonly file: Blob | null;
  readonly understood: boolean;
  readonly word: string;
  readonly busy: boolean;
}): boolean {
  return (
    !state.busy &&
    state.file !== null &&
    state.file.size > 0 &&
    isConfirmed(state.understood, state.word)
  );
}

/** Maximum upload size allowed for a backup kind. */
export function maxBytes(kind: BackupKind, limits: BackupLimits): number {
  return kind === 'db' ? limits.db_max_bytes : limits.assets_max_bytes;
}

/** Percentage done, clamped to 0-100. */
export function percentOf(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((done / total) * 100)));
}

/** Accepted file types of the file input. */
export function acceptFor(kind: BackupKind): string {
  return kind === 'db' ? '.gz,.sql.gz,application/gzip' : '.zip,application/zip';
}

/** Error code carried by a failed job (JobRunner stores `{error: "<code>"}`). */
export function failedJobCode(job: Job): string | null {
  const result = job.result;
  if (typeof result !== 'object' || result === null) return null;
  const record = result as Record<string, unknown>;
  const error = record['error'];
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const code = (error as Record<string, unknown>)['code'];
    if (typeof code === 'string') return code;
  }
  return null;
}

/** Message of an error of this screen (codes backup.* are translated under errors.backup.*). */
export function backupError(error: unknown, t: Translate): ErrorSummary {
  if (error instanceof ApiError && error.code === 'backup.too_recent') {
    return {
      message: t('errors.backup.too_recent', {
        version: String(error.fields['version'] ?? ''),
        current: String(error.fields['current'] ?? ''),
      }),
      requestId: error.requestId,
    };
  }
  return describeError(error, t);
}

/** Summary of a code without request (failed job, failed restore step). */
export function codeError(code: string | null, t: Translate): ErrorSummary {
  const key = `errors.${code ?? 'unknown'}`;
  const message = t(key);
  return { message: message === key ? t('errors.unknown') : message, requestId: null };
}

/** Extracts the assets restore result from a finished job. */
export function assetsResult(job: Job): AssetsRestoreResult {
  const r = (typeof job.result === 'object' && job.result !== null ? job.result : {}) as Record<
    string,
    unknown
  >;
  const n = (key: string): number => (typeof r[key] === 'number' ? (r[key] as number) : 0);
  const files = Array.isArray(r['rejected_files'])
    ? r['rejected_files'].filter((f): f is string => typeof f === 'string')
    : [];
  return {
    restored: n('restored'),
    skipped: n('skipped'),
    rejected: n('rejected'),
    rejected_files: files,
  };
}

/** File name proposed by the server for a finished backup. */
export function backupFileName(job: Job, kind: BackupKind): string {
  const r = job.result as Record<string, unknown> | null;
  const name = r !== null && typeof r === 'object' ? r['file_name'] : undefined;
  return typeof name === 'string' && name !== ''
    ? name
    : kind === 'db'
      ? 'jdr-db.sql.gz'
      : 'jdr-assets.zip';
}

/** Browser download of a URL (an `<a download>` clicked). */
export function browserDownload(url: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
}
