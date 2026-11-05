/**
 * Screen model of the "Sauvegarde" tab: one-time backups (database, assets) downloaded as soon as they are
 * built, and restores from a file sent in chunks (double check: box + typed word).
 */

import { ApiError, type ApiClient } from './api';
import {
  assetsResult,
  backupError,
  backupFileName,
  browserDownload,
  canStartRestore,
  codeError,
  failedJobCode,
  maxBytes,
  percentOf,
  type BackupInfo,
  type BackupKind,
  type RestoreOutcome,
  type RestoreState,
} from './admin-backup';
import { uploadInChunks, type UploadTransport } from './admin-update-upload';
import type { ErrorSummary } from './errors';
import type { Translate } from './translator';
import type { Job } from './types';

export type BackupApiClient = Pick<ApiClient, 'get' | 'post' | 'put' | 'url'>;

export interface BackupModelDeps {
  readonly download?: (url: string, fileName: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Guard against a job or a restore that never ends. */
  readonly maxSteps?: number;
}

export type RestorePhase = 'idle' | 'uploading' | 'restoring' | 'done' | 'failed';

const TERMINAL = new Set(['done', 'failed', 'cancelled']);

/** Reactive model of the backup page (create, download, restore). */
export class BackupModel implements UploadTransport {
  info = $state.raw<BackupInfo | null>(null);
  loadFailure = $state.raw<ErrorSummary | null>(null);

  /** Backup being built (one at a time). */
  backupKind = $state<BackupKind | null>(null);
  backupPercent = $state(0);
  backupFailure = $state.raw<ErrorSummary | null>(null);
  /** Name of the last downloaded backup. */
  backupDone = $state<string | null>(null);

  restoreKind = $state<BackupKind>('db');
  file = $state.raw<File | null>(null);
  understood = $state(false);
  word = $state('');
  restorePhase = $state<RestorePhase>('idle');
  restorePercent = $state(0);
  restoreOutcome = $state.raw<RestoreOutcome | null>(null);
  restoreFailure = $state.raw<ErrorSummary | null>(null);

  #backupAbort: AbortController | null = null;
  #backupJob: Job | null = null;

  constructor(
    private readonly api: BackupApiClient,
    private readonly t: Translate,
    private readonly deps: BackupModelDeps = {},
  ) {}

  get restoreBusy(): boolean {
    return this.restorePhase === 'uploading' || this.restorePhase === 'restoring';
  }

  get canRestore(): boolean {
    return canStartRestore({
      file: this.file,
      understood: this.understood,
      word: this.word,
      busy: this.restoreBusy || this.backupKind !== null,
    });
  }

  async load(): Promise<void> {
    try {
      const { data } = await this.api.get<BackupInfo>('/admin/backup');
      this.info = data;
      this.loadFailure = null;
    } catch (error) {
      this.loadFailure = backupError(error, this.t);
    }
  }

  /* ---------------------------------------------------------------- backups */

  async backup(kind: BackupKind): Promise<void> {
    if (this.backupKind !== null) return;
    this.backupKind = kind;
    this.backupPercent = 0;
    this.backupFailure = null;
    this.backupDone = null;
    const abort = new AbortController();
    this.#backupAbort = abort;
    try {
      const { data } = await this.api.post<{ job: Job }>('/admin/backup/jobs', { kind });
      let job = data.job;
      this.#backupJob = job;
      job = await this.#runJob(job, abort.signal, (j) => {
        this.#backupJob = j;
        this.backupPercent = j.progress.percent;
      });
      if (abort.signal.aborted || job.status === 'cancelled') return;
      if (job.status !== 'done') {
        this.backupFailure = codeError(failedJobCode(job), this.t);
        return;
      }
      const name = backupFileName(job, kind);
      (this.deps.download ?? browserDownload)(this.api.url(`/jobs/${job.id}/download`), name);
      this.backupDone = name;
    } catch (error) {
      if (!abort.signal.aborted) this.backupFailure = backupError(error, this.t);
    } finally {
      this.backupKind = null;
      this.#backupAbort = null;
      this.#backupJob = null;
    }
  }

  async cancelBackup(): Promise<void> {
    const job = this.#backupJob;
    this.#backupAbort?.abort();
    if (job !== null && !TERMINAL.has(job.status)) {
      try {
        await this.api.post(`/jobs/${job.id}/cancel`);
      } catch {
        // Best effort: the server purges abandoned backups after an hour.
      }
    }
  }

  /* --------------------------------------------------------------- restores */

  setKind(kind: BackupKind): void {
    if (this.restoreBusy) return;
    this.restoreKind = kind;
    this.file = null;
    this.restoreOutcome = null;
    this.restoreFailure = null;
  }

  async restore(): Promise<void> {
    const file = this.file;
    const info = this.info;
    if (!this.canRestore || file === null || info === null) return;
    const kind = this.restoreKind;
    this.restoreFailure = null;
    this.restoreOutcome = null;
    this.restorePercent = 0;
    try {
      if (file.size > maxBytes(kind, info.limits)) {
        throw new ApiError({ code: 'backup.too_large', message: '', status: 422 });
      }
      this.restorePhase = 'uploading';
      const { data: upload } = await this.api.post<{ upload_id: string; chunk_bytes: number }>(
        '/admin/backup/uploads',
        { kind, size: file.size },
      );
      await uploadInChunks({
        file,
        uploadId: upload.upload_id,
        chunkBytes: upload.chunk_bytes,
        transport: this,
        sleep: this.deps.sleep,
        onProgress: (sent, total) => {
          this.restorePercent = percentOf(sent, total);
        },
      });
      this.restorePhase = 'restoring';
      this.restorePercent = 0;
      if (kind === 'db') {
        await this.#restoreDb(upload.upload_id);
      } else {
        await this.#restoreAssets(upload.upload_id);
      }
    } catch (error) {
      this.restoreFailure = backupError(error, this.t);
      this.restorePhase = 'failed';
    } finally {
      this.understood = false;
      this.word = '';
    }
  }

  async putChunk(uploadId: string, offset: number, chunk: Blob): Promise<{ received: number }> {
    const { data } = await this.api.put<{ received: number }>(
      `/admin/backup/uploads/${uploadId}`,
      chunk,
      {
        query: { offset },
        headers: { 'Content-Type': 'application/octet-stream' },
        timeoutMs: 120_000,
        retries: 0,
      },
    );
    return data;
  }

  async #restoreDb(uploadId: string): Promise<void> {
    const { data } = await this.api.post<{ restore: RestoreState }>('/admin/backup/restore/db', {
      upload_id: uploadId,
    });
    const token = data.restore.token ?? '';
    let restore = data.restore;
    const maxSteps = this.deps.maxSteps ?? 1_000_000;
    for (let steps = 0; restore.status === 'running'; steps++) {
      this.restorePercent = restore.progress.percent;
      if (steps >= maxSteps)
        throw new ApiError({ code: 'backup.restore_failed', message: '', status: 0 });
      const { data: step } = await this.api.post<{ restore: RestoreState }>(
        `/admin/backup/restore/db/${restore.id}/step`,
        { token },
        { timeoutMs: 60_000 },
      );
      restore = step.restore;
    }
    if (restore.status !== 'done') {
      this.restoreFailure = codeError(restore.error ?? 'backup.restore_failed', this.t);
      this.restorePhase = 'failed';
      return;
    }
    this.restorePercent = 100;
    this.restoreOutcome = { kind: 'db', schemaBehind: restore.schema_behind === true };
    this.restorePhase = 'done';
  }

  async #restoreAssets(uploadId: string): Promise<void> {
    const { data } = await this.api.post<{ job: Job }>('/admin/backup/restore/assets', {
      upload_id: uploadId,
    });
    const job = await this.#runJob(data.job, undefined, (j) => {
      this.restorePercent = j.progress.percent;
    });
    if (job.status !== 'done') {
      this.restoreFailure = codeError(failedJobCode(job), this.t);
      this.restorePhase = 'failed';
      return;
    }
    this.restorePercent = 100;
    this.restoreOutcome = { kind: 'assets', ...assetsResult(job) };
    this.restorePhase = 'done';
  }

  /** Steps a job until it is finished (or `signal` aborts: the job is then returned as is). */
  async #runJob(
    start: Job,
    signal: AbortSignal | undefined,
    onProgress: (job: Job) => void,
  ): Promise<Job> {
    let job = start;
    onProgress(job);
    const maxSteps = this.deps.maxSteps ?? 1_000_000;
    for (let steps = 0; !TERMINAL.has(job.status); steps++) {
      if (signal?.aborted === true || steps >= maxSteps) return job;
      const { data } = await this.api.post<{ job: Job }>(`/jobs/${job.id}/step`, undefined, {
        timeoutMs: 60_000,
      });
      job = data.job;
      onProgress(job);
    }
    return job;
  }
}
