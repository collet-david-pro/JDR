import { ApiError, type ApiClient } from './api';
import { sha256Hex, uploadInChunks, type UploadTransport } from './admin-update-upload';
import { describeError, type ErrorSummary } from './errors';
import type { Translate } from './translator';

export type UpdateChannel = 'stable' | 'prerelease';

export interface UpdateAsset {
  readonly name: string;
  readonly url: string;
  readonly size: number;
  readonly sha256: string | null;
}

export interface UpdateRelease {
  readonly version: string;
  readonly name: string | null;
  readonly published_at: string | null;
  readonly notes: string | null;
  readonly html_url: string | null;
  readonly update_asset: UpdateAsset | null;
}

export interface UpdateCheck {
  readonly current: string;
  readonly channel: UpdateChannel;
  readonly latest: UpdateRelease | null;
  readonly checked_at: string;
  readonly error: 'unreachable' | 'invalid_response' | null;
}

export interface UpdateWarning {
  readonly code: 'unverified' | 'no_manifest' | 'version_jump';
  readonly message: string;
}

export interface UpdateSummary {
  readonly id: string;
  readonly version: string;
  readonly current: string;
  readonly authenticity: 'verified' | 'unverified';
  readonly sha256: string;
  readonly size: number;
  readonly files: {
    readonly added: number;
    readonly changed: number;
    readonly removed: number;
    readonly unchanged: number;
  };
  readonly changes: {
    readonly added: readonly string[];
    readonly changed: readonly string[];
    readonly removed: readonly string[];
  };
  readonly migrations: readonly string[];
  readonly warnings: readonly UpdateWarning[];
  readonly uploaded_at: string;
}

export const RESUMABLE_STATES = [
  'running',
  'rolling_back',
  'restoring',
  'failed_migration',
] as const;

export interface UpdateRun {
  readonly id: string;
  readonly mode: string;
  readonly from: string;
  readonly to: string;
  readonly step: string;
  readonly state: string;
  readonly error: string | null;
  readonly progress: {
    readonly done: number;
    readonly total: number;
    readonly percent: number;
    readonly label: string | null;
    readonly detail: string | null;
  } | null;
  readonly updated_at: string;
}

export interface UpdateInfo {
  readonly current: string;
  readonly db_version: string | number | null;
  readonly required_db_version: string | number | null;
  readonly channel: UpdateChannel;
  readonly check: UpdateCheck | null;
  readonly pending: UpdateSummary | null;
  readonly run: UpdateRun | null;
  readonly upload_max_bytes: number;
  readonly chunk_bytes: number;
  readonly php: { readonly upload_max_filesize: string; readonly post_max_size: string };
  readonly update_url: string;
}

export const RELEASES_URL = 'https://github.com/collet-david-pro/JDR/releases';

export type UpdateApiClient = Pick<ApiClient, 'get' | 'post' | 'put' | 'patch' | 'delete'>;

export function isResumable(run: UpdateRun | null): run is UpdateRun {
  return run !== null && (RESUMABLE_STATES as readonly string[]).includes(run.state);
}

/** Link to resume a run: the server-provided update.php URL + the run id. */
export function resumeUrl(info: UpdateInfo, run: UpdateRun): string {
  const base = info.update_url === '' ? 'update.php' : info.update_url;
  return `${base}${base.includes('?') ? '&' : '?'}id=${encodeURIComponent(run.id)}`;
}

/** Compares two semver strings (precedence rules of semver 2.0); null when one is not valid. */
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string): { nums: number[]; pre: string[] } | null => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
    if (m === null) return null;
    return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
  };
  const x = parse(a);
  const y = parse(b);
  if (x === null || y === null) return null;
  for (let i = 0; i < 3; i += 1) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (x.pre.length === 0 || y.pre.length === 0) return Math.sign(y.pre.length - x.pre.length);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Math.sign(Number(p) - Number(q));
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

export function isNewerRelease(check: UpdateCheck | null): boolean {
  if (check === null || check.latest === null) return false;
  return (compareVersions(check.latest.version, check.current) ?? 0) > 0;
}

const FILE_HASH_REASONS = ['mismatch', 'unlisted', 'missing'];
const shortHash = (value: string | undefined): string =>
  value === undefined ? '' : value.length > 16 ? `${value.slice(0, 16)}…` : value;

/** Translated message of an error; `update.*` codes get their fields as parameters. */
export function updateError(error: unknown, t: Translate): ErrorSummary {
  if (error instanceof Error && error.message === 'no_crypto') {
    return { message: t('admin.update.errors.no_crypto'), requestId: null };
  }
  if (error instanceof ApiError && error.code.startsWith('update.')) {
    const key = `errors.${error.code}`;
    const f = error.fields;
    const reason = f['reason'] ?? '';
    const message = t(key, {
      path: f['path'] ?? reason,
      reason: FILE_HASH_REASONS.includes(reason)
        ? t(`admin.update.file_hash_reason.${reason}`)
        : reason,
      version: f['version'] ?? '',
      current: f['current'] ?? '',
      expected: shortHash(f['expected']),
      actual: shortHash(f['actual']),
      received: f['received'] ?? '',
      size: f['size'] ?? '',
    });
    if (message !== key) return { message, requestId: error.requestId };
  }
  return describeError(error, t);
}

export type UploadPhase = 'idle' | 'hashing' | 'uploading' | 'completing';

export interface UpdateModelDeps {
  readonly sha256?: (file: Blob) => Promise<string>;
  readonly navigate?: (url: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** State and actions of the "Mise à jour" admin tab. */
export class UpdateModel implements UploadTransport {
  info = $state.raw<UpdateInfo | null>(null);
  failure = $state.raw<ErrorSummary | null>(null);
  check = $state.raw<UpdateCheck | null>(null);
  checking = $state(false);
  /** Seconds before the next forced check is accepted (429), null when not limited. */
  retryAfter = $state<number | null>(null);
  phase = $state<UploadPhase>('idle');
  sent = $state(0);
  total = $state(0);
  busy = $state(false);
  uploadFailure = $state.raw<ErrorSummary | null>(null);
  actionFailure = $state.raw<ErrorSummary | null>(null);

  constructor(
    private readonly api: UpdateApiClient,
    private readonly t: Translate,
    private readonly deps: UpdateModelDeps = {},
  ) {}

  get pending(): UpdateSummary | null {
    return this.info?.pending ?? null;
  }

  get run(): UpdateRun | null {
    return this.info?.run ?? null;
  }

  get percent(): number {
    return this.total === 0 ? 0 : Math.min(100, Math.floor((this.sent / this.total) * 100));
  }

  async load(): Promise<void> {
    try {
      const { data } = await this.api.get<UpdateInfo>('/admin/update');
      this.info = data;
      this.check = data.check;
      this.failure = null;
    } catch (error) {
      this.failure = updateError(error, this.t);
    }
  }

  async runCheck(): Promise<void> {
    this.checking = true;
    this.actionFailure = null;
    this.retryAfter = null;
    try {
      const { data } = await this.api.post<UpdateCheck>('/admin/update/check', { force: true });
      this.check = data;
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        this.retryAfter = error.retryAfter ?? 30;
      } else {
        this.actionFailure = updateError(error, this.t);
      }
    } finally {
      this.checking = false;
    }
  }

  async setChannel(channel: UpdateChannel): Promise<void> {
    this.actionFailure = null;
    try {
      await this.api.patch('/admin/update', { channel });
      if (this.info !== null) this.info = { ...this.info, channel };
      this.check = null;
    } catch (error) {
      this.actionFailure = updateError(error, this.t);
    }
  }

  /** Accepts the file picked by the administrator (hash, upload, complete). */
  async send(file: File): Promise<void> {
    const info = this.info;
    if (info === null || this.phase !== 'idle') return;
    this.uploadFailure = null;
    this.sent = 0;
    this.total = file.size;
    try {
      if (file.size < 1 || file.size > info.upload_max_bytes) {
        throw new ApiError({ code: 'update.too_large', message: '', status: 422 });
      }
      this.phase = 'hashing';
      const sha256 = await (this.deps.sha256 ?? sha256Hex)(file);
      this.phase = 'uploading';
      const { data: started } = await this.api.post<{ upload_id: string; chunk_bytes: number }>(
        '/admin/update/uploads',
        { size: file.size, sha256 },
      );
      await uploadInChunks({
        file,
        uploadId: started.upload_id,
        chunkBytes: started.chunk_bytes,
        transport: this,
        sleep: this.deps.sleep,
        onProgress: (sent, total) => {
          this.sent = sent;
          this.total = total;
        },
      });
      this.phase = 'completing';
      const { data } = await this.api.post<{ pending: UpdateSummary }>(
        `/admin/update/uploads/${started.upload_id}/complete`,
      );
      this.info = { ...info, pending: data.pending };
    } catch (error) {
      this.uploadFailure = updateError(error, this.t);
    } finally {
      this.phase = 'idle';
    }
  }

  async putChunk(uploadId: string, offset: number, chunk: Blob): Promise<{ received: number }> {
    const { data } = await this.api.put<{ received: number }>(
      `/admin/update/uploads/${uploadId}`,
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

  async discard(): Promise<void> {
    this.busy = true;
    this.actionFailure = null;
    try {
      await this.api.delete('/admin/update/pending');
      if (this.info !== null) this.info = { ...this.info, pending: null };
    } catch (error) {
      this.actionFailure = updateError(error, this.t);
    } finally {
      this.busy = false;
    }
  }

  async install(confirmUnverified: boolean): Promise<void> {
    this.busy = true;
    this.actionFailure = null;
    try {
      const { data } = await this.api.post<{ redirect: string; run: UpdateRun }>(
        '/admin/update/start',
        { confirm_unverified: confirmUnverified },
      );
      (this.deps.navigate ?? ((url: string) => window.location.assign(url)))(data.redirect);
    } catch (error) {
      this.actionFailure = updateError(error, this.t);
      this.busy = false;
    }
  }
}
