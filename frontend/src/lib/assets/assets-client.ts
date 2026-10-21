/**
 * Assets API (etapes/P02 "Contrat d'API P2"): library, categories, tags, packs and jobs.
 * JSON calls go through ApiClient; multipart uploads through XHR (progress, cancellation)
 * with the same URL building (query routing mode), CSRF header and envelope.
 */

import { ApiError, type ApiClient, type QueryParams } from '../api';
import type { Page } from '../cursor-list.svelte';
import type {
  Asset,
  AssetCategory,
  AssetFilters,
  AssetKind,
  AssetLimits,
  AssetPatch,
  AssetScope,
  AssetTag,
  AssetUsages,
  Job,
  StorageUsage,
  UsageRef,
} from '../types';
import { xhrUpload, type XhrFactory } from './xhr-upload';

export interface UploadFields {
  readonly kind: AssetKind;
  readonly name?: string;
  readonly category_id?: string | null;
  /** `general`: administrators only. */
  readonly scope?: AssetScope;
  readonly client_op_id?: string;
}

export interface UploadOptions {
  readonly onProgress?: (loaded: number, total: number) => void;
  readonly signal?: AbortSignal;
}

export interface UploadResult {
  readonly asset: Asset;
  /** The same file was already in the library (no quota consumed). */
  readonly duplicate: boolean;
}

export interface CategoryInput {
  readonly name: string;
  readonly parent_id?: string | null;
  readonly scope?: AssetScope;
}

export interface CategoryPatch {
  readonly name?: string;
  readonly parent_id?: string | null;
  readonly sort_order?: number;
}

/** Query parameters of GET /assets for a set of filters. */
export function assetQuery(filters: AssetFilters): QueryParams {
  const q = filters.q?.trim() ?? '';
  return {
    scope: filters.scope,
    kind: filters.kind === '' ? null : filters.kind,
    q: q === '' ? null : q,
    tag: filters.tag === '' ? null : filters.tag,
    category: filters.category === '' ? null : filters.category,
    favorites: filters.favorites === true ? 1 : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function usageList(value: unknown): UsageRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    id: String(item['id'] ?? ''),
    name: typeof item['name'] === 'string' ? item['name'] : '',
  }));
}

/** Usages carried by a 409 `asset_in_use` error, or null. */
export function usagesFromError(error: unknown): AssetUsages | null {
  if (!(error instanceof ApiError) || error.code !== 'asset_in_use') return null;
  const raw = error.details['usages'];
  if (!isRecord(raw)) return null;
  return { maps: usageList(raw['maps']), tokens: usageList(raw['tokens']) };
}

function jobOf(data: { job: Job }): Job {
  return data.job;
}

export class AssetsClient {
  private limitsCache: Promise<AssetLimits> | null = null;

  constructor(
    private readonly api: ApiClient,
    private readonly xhr?: XhrFactory,
  ) {}

  /** GET /assets/limits (cached for the page lifetime; a failure is not cached). */
  limits(): Promise<AssetLimits> {
    if (this.limitsCache === null) {
      this.limitsCache = this.api
        .get<AssetLimits>('/assets/limits')
        .then((r) => r.data)
        .catch((error: unknown) => {
          this.limitsCache = null;
          throw error;
        });
    }
    return this.limitsCache;
  }

  async list(filters: AssetFilters, cursor: string | null, limit = 50): Promise<Page<Asset>> {
    const response = await this.api.get<Asset[]>('/assets', {
      query: { ...assetQuery(filters), cursor, limit },
    });
    const next = response.meta['next_cursor'];
    return {
      items: Array.isArray(response.data) ? response.data : [],
      next: typeof next === 'string' && next !== '' ? next : null,
    };
  }

  /** POST /assets (one file per request); retried once after a 403 csrf_invalid. */
  upload(
    file: Blob,
    fileName: string,
    fields: UploadFields,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    const form = (): FormData => {
      const body = new FormData();
      body.append('file', file, fileName);
      body.append('kind', fields.kind);
      if (fields.name !== undefined && fields.name !== '') body.append('name', fields.name);
      if (fields.category_id) body.append('category_id', fields.category_id);
      if (fields.scope === 'general') body.append('scope', 'general');
      if (fields.client_op_id) body.append('client_op_id', fields.client_op_id);
      return body;
    };
    return this.sendMultipart<Asset>('/assets', form, options).then((response) => ({
      asset: response.data,
      duplicate: response.meta['duplicate'] === true,
    }));
  }

  async update(id: string, patch: AssetPatch): Promise<Asset> {
    return (await this.api.patch<Asset>(`/assets/${id}`, patch)).data;
  }

  /** DELETE /assets/{id}; a 409 `asset_in_use` carries the usages (usagesFromError). */
  async remove(id: string, force = false): Promise<void> {
    await this.api.delete(`/assets/${id}`, { query: { force: force ? 1 : null } });
  }

  async usages(id: string): Promise<AssetUsages> {
    const { data } = await this.api.get<Partial<AssetUsages>>(`/assets/${id}/usages`);
    return { maps: usageList(data.maps), tokens: usageList(data.tokens) };
  }

  async setFavorite(id: string, favorite: boolean): Promise<void> {
    if (favorite) await this.api.put(`/assets/${id}/favorite`);
    else await this.api.delete(`/assets/${id}/favorite`);
  }

  async categories(): Promise<AssetCategory[]> {
    const { data } = await this.api.get<AssetCategory[]>('/asset-categories');
    return Array.isArray(data) ? data : [];
  }

  async createCategory(input: CategoryInput): Promise<AssetCategory> {
    return (await this.api.post<AssetCategory>('/asset-categories', input)).data;
  }

  async updateCategory(id: string, patch: CategoryPatch): Promise<AssetCategory> {
    return (await this.api.patch<AssetCategory>(`/asset-categories/${id}`, patch)).data;
  }

  async deleteCategory(id: string): Promise<void> {
    await this.api.delete(`/asset-categories/${id}`);
  }

  async tags(): Promise<AssetTag[]> {
    const { data } = await this.api.get<AssetTag[]>('/asset-tags');
    return Array.isArray(data) ? data : [];
  }

  async createTag(name: string, scope?: AssetScope): Promise<AssetTag> {
    const body = scope === 'general' ? { name, scope } : { name };
    return (await this.api.post<AssetTag>('/asset-tags', body)).data;
  }

  async deleteTag(id: string): Promise<void> {
    await this.api.delete(`/asset-tags/${id}`);
  }

  async storage(): Promise<StorageUsage> {
    return (await this.api.get<StorageUsage>('/me/storage')).data;
  }

  /** POST /asset-packs/import (multipart zip) → 202 {job}. */
  async importPack(file: Blob, fileName: string, scope?: AssetScope, options: UploadOptions = {}) {
    const form = (): FormData => {
      const body = new FormData();
      body.append('file', file, fileName);
      if (scope === 'general') body.append('scope', 'general');
      return body;
    };
    return jobOf(
      (await this.sendMultipart<{ job: Job }>('/asset-packs/import', form, options)).data,
    );
  }

  async exportPack(selection: { asset_ids?: readonly string[]; category_id?: string }) {
    return jobOf((await this.api.post<{ job: Job }>('/asset-packs/export', selection)).data);
  }

  async job(id: string, signal?: AbortSignal): Promise<Job> {
    const options = signal === undefined ? {} : { signal };
    return jobOf((await this.api.get<{ job: Job }>(`/jobs/${id}`, options)).data);
  }

  async stepJob(id: string, signal?: AbortSignal): Promise<Job> {
    // A step lasts 2-5 s on the server: allow more than the default 15 s timeout.
    const options = signal === undefined ? { timeoutMs: 60_000 } : { timeoutMs: 60_000, signal };
    return jobOf((await this.api.post<{ job: Job }>(`/jobs/${id}/step`, undefined, options)).data);
  }

  async cancelJob(id: string): Promise<Job> {
    return jobOf((await this.api.post<{ job: Job }>(`/jobs/${id}/cancel`)).data);
  }

  /** URL of the file produced by a finished export job. */
  jobDownloadUrl(id: string): string {
    return this.api.url(`/jobs/${id}/download`);
  }

  private async sendMultipart<T>(
    path: string,
    form: () => FormData,
    options: UploadOptions,
  ): Promise<{ data: T; meta: Readonly<Record<string, unknown>> }> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await xhrUpload<T>({
          url: this.api.url(path),
          body: form(),
          csrf: this.api.csrfToken,
          ...(options.onProgress ? { onProgress: options.onProgress } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
          ...(this.xhr ? { xhr: this.xhr } : {}),
        });
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === 'csrf_invalid' && attempt === 0 && (await this.api.renewCsrf())) {
            continue;
          }
          this.api.notify(error);
        }
        throw error;
      }
    }
  }
}
