/**
 * Maps API (etapes/P04 "Contrat d'API P4b" and "P4c", projet.md 9.2, 11.4): list, CRUD, trash,
 * duplication, ops and binary tile blocks; versions, export / import and thumbnail (P4c).
 * Identifiers are strings, URL-encoded in paths.
 */
import { ApiError, type ApiClient } from '../api';
import { xhrUpload, type XhrFactory } from '../assets/xhr-upload';
import type {
  MapDetail,
  MapFogResult,
  MapImportResult,
  MapInput,
  MapListState,
  MapOpsRequest,
  MapOpsResult,
  MapPatch,
  MapRestoreResult,
  MapSummary,
  MapThumbnailResult,
  MapVersion,
} from '../types';
import { ChunkStreamError, parseChunkStream, type ChunkRecord } from '../../formats/chunk-stream';

const seg = (id: string): string => encodeURIComponent(id);

export interface ChunkQuery {
  readonly floor: string;
  /** Default: the three tile layers. */
  readonly layers?: readonly string[];
  /** "cx:cy" keys; omitted = every block of the floor. */
  readonly cells?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface ChunkAnswer {
  readonly records: ChunkRecord[];
  /** X-Map-Revision header, null when absent. */
  readonly revision: number | null;
}

/** Ops are sent once per call: the queue owns retries (same client_op_id). */
const OPS_TIMEOUT_MS = 30_000;
/** Snapshot, restoration and export work on the whole map on the server. */
const LONG_TIMEOUT_MS = 120_000;

/** A downloaded export (GET /maps/{id}/export). */
export interface MapExportFile {
  readonly blob: Blob;
  readonly fileName: string;
}

export interface MapImportOptions {
  /** Bytes sent / total (total 0 when unknown). */
  readonly onProgress?: (loaded: number, total: number) => void;
  readonly signal?: AbortSignal;
  /** Idempotent replay: the same id returns the same answer without a second import. */
  readonly clientOpId?: string;
}

/** File name of a Content-Disposition header (RFC 6266: filename* first), or null. */
export function dispositionFileName(header: string | null): string | null {
  if (header === null) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star?.[2] !== undefined) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''));
    } catch {
      // Badly encoded: fall back to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  const name = (plain?.[2] ?? plain?.[1] ?? '').trim();
  return name === '' ? null : name;
}

/** Safe file name from a map name ("Crypte oubliée" ⇒ "Crypte oubliée"); "map" when empty. */
export function exportFileName(mapName: string, withAssets: boolean): string {
  const printable = [...mapName].map((c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('');
  const base = printable
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base === '' ? 'map' : base}.${withAssets ? 'zip' : 'json'}`;
}

export class MapsClient {
  constructor(
    private readonly api: ApiClient,
    /** XMLHttpRequest factory of the import upload (tests). */
    private readonly xhr?: XhrFactory,
  ) {}

  async list(gameId: string, state: MapListState = 'active'): Promise<MapSummary[]> {
    const { data } = await this.api.get<MapSummary[]>(`/games/${seg(gameId)}/maps`, {
      query: { state },
    });
    return Array.isArray(data) ? data : [];
  }

  async create(gameId: string, input: MapInput): Promise<MapDetail> {
    return (await this.api.post<MapDetail>(`/games/${seg(gameId)}/maps`, input)).data;
  }

  async get(id: string, signal?: AbortSignal): Promise<MapDetail> {
    return (await this.api.get<MapDetail>(`/maps/${seg(id)}`, signal ? { signal } : {})).data;
  }

  async update(id: string, patch: MapPatch): Promise<MapSummary> {
    return (await this.api.patch<MapSummary>(`/maps/${seg(id)}`, patch)).data;
  }

  /** To the trash (restorable). */
  async remove(id: string): Promise<void> {
    await this.api.delete(`/maps/${seg(id)}`);
  }

  async restore(id: string): Promise<void> {
    await this.api.post(`/maps/${seg(id)}/restore`);
  }

  async duplicate(id: string): Promise<MapDetail> {
    return (await this.api.post<MapDetail>(`/maps/${seg(id)}/duplicate`)).data;
  }

  async sendOps(
    id: string,
    body: MapOpsRequest,
    options: { keepalive?: boolean } = {},
  ): Promise<MapOpsResult> {
    const { data } = await this.api.post<MapOpsResult>(`/maps/${seg(id)}/ops`, body, {
      timeoutMs: OPS_TIMEOUT_MS,
      ...(options.keepalive === true ? { keepalive: true } : {}),
    });
    return data;
  }

  /** Binary tile blocks (`[cx u16][cy u16][layer u8][len u32][data]`, little endian). */
  async chunks(id: string, query: ChunkQuery): Promise<ChunkAnswer> {
    const response = await this.api.raw('GET', `/maps/${seg(id)}/chunks`, {
      query: {
        floor: query.floor,
        layers: query.layers ?? ['ground', 'terrain', 'decor'],
        cells: query.cells === undefined ? null : query.cells,
      },
      accept: 'application/octet-stream',
      ...(query.signal ? { signal: query.signal } : {}),
    });
    const header = response.headers.get('X-Map-Revision');
    const revision = header === null || header === '' ? null : Number(header);
    const bytes = new Uint8Array(await response.arrayBuffer());
    try {
      return {
        records: parseChunkStream(bytes),
        revision: revision !== null && Number.isFinite(revision) ? revision : null,
      };
    } catch (error) {
      if (error instanceof ChunkStreamError) {
        throw new ApiError({
          code: 'invalid_response',
          message: error.message,
          status: response.status,
          requestId: response.headers.get('X-Request-Id'),
          cause: error,
        });
      }
      throw error;
    }
  }

  // ---- P5: fog -------------------------------------------------------------------------------

  /** Explored fog of a floor (projet.md 12.3): `[cx, cy, base64 raw deflate]` per chunk. */
  async fog(id: string, floor: string, signal?: AbortSignal): Promise<MapFogResult> {
    const { data } = await this.api.get<MapFogResult>(`/maps/${seg(id)}/fog`, {
      query: { floor },
      ...(signal ? { signal } : {}),
    });
    return {
      floor: typeof data?.floor === 'string' ? data.floor : floor,
      chunks: Array.isArray(data?.chunks) ? data.chunks : [],
    };
  }

  /** Clears the whole fog of a floor (GM reset); answers the new map revision. */
  async resetFog(id: string, floor: string): Promise<{ revision: number }> {
    return (
      await this.api.delete<{ revision: number }>(`/maps/${seg(id)}/fog`, { query: { floor } })
    ).data;
  }

  // ---- P4c: versions -----------------------------------------------------------------------

  /** Snapshots of a map, most recent first. */
  async versions(id: string, signal?: AbortSignal): Promise<MapVersion[]> {
    const { data } = await this.api.get<MapVersion[]>(
      `/maps/${seg(id)}/versions`,
      signal ? { signal } : {},
    );
    return Array.isArray(data) ? data : [];
  }

  /** Manual snapshot of the current server state. */
  async createVersion(id: string, label: string | null = null): Promise<MapVersion> {
    const body = label === null || label.trim() === '' ? {} : { label: label.trim() };
    return (
      await this.api.post<MapVersion>(`/maps/${seg(id)}/versions`, body, {
        timeoutMs: LONG_TIMEOUT_MS,
      })
    ).data;
  }

  /**
   * Restores a snapshot (the server first snapshots the current state as `pre_restore`, then
   * writes the snapshot as a new revision). `clientOpId` makes a replay harmless.
   */
  async restoreVersion(
    id: string,
    versionId: string,
    clientOpId: string,
  ): Promise<MapRestoreResult> {
    return (
      await this.api.post<MapRestoreResult>(
        `/maps/${seg(id)}/versions/${seg(versionId)}/restore`,
        { client_op_id: clientOpId },
        { timeoutMs: LONG_TIMEOUT_MS },
      )
    ).data;
  }

  // ---- P4c: export / import ----------------------------------------------------------------

  /** Map document (projet.md 12.1): JSON without images, or ZIP with the images. */
  async exportFile(id: string, withAssets: boolean, mapName = 'map'): Promise<MapExportFile> {
    const response = await this.api.raw('GET', `/maps/${seg(id)}/export`, {
      query: { assets: withAssets ? 1 : 0 },
      accept: withAssets ? 'application/zip' : 'application/json',
      timeoutMs: LONG_TIMEOUT_MS,
    });
    const blob = await response.blob();
    return {
      blob,
      fileName:
        dispositionFileName(response.headers.get('Content-Disposition')) ??
        exportFileName(mapName, withAssets),
    };
  }

  /** Imports a map document (JSON or ZIP) into a game; upload progress through XHR. */
  async importFile(
    gameId: string,
    file: Blob,
    fileName: string,
    options: MapImportOptions = {},
  ): Promise<MapImportResult> {
    const path = `/games/${seg(gameId)}/maps/import`;
    for (let attempt = 0; ; attempt++) {
      const body = new FormData();
      body.append('file', file, fileName);
      if (options.clientOpId !== undefined) body.append('client_op_id', options.clientOpId);
      try {
        const { data } = await xhrUpload<MapImportResult>({
          url: this.api.url(path),
          body,
          csrf: this.api.csrfToken,
          ...(options.onProgress ? { onProgress: options.onProgress } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
          ...(this.xhr ? { xhr: this.xhr } : {}),
        });
        return {
          map: data.map,
          missing_assets: Array.isArray(data.missing_assets) ? data.missing_assets : [],
          missing_tokens: Array.isArray(data.missing_tokens) ? data.missing_tokens : [],
        };
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

  // ---- P4c: thumbnail ----------------------------------------------------------------------

  /** Thumbnail image (PNG or WebP, ≤ 512 px, ≤ 512 KB) sent as the raw request body. */
  async putThumbnail(id: string, image: Blob): Promise<MapThumbnailResult> {
    return (
      await this.api.put<MapThumbnailResult>(`/maps/${seg(id)}/thumbnail`, image, {
        headers: { 'Content-Type': image.type === '' ? 'image/png' : image.type },
        timeoutMs: 30_000,
      })
    ).data;
  }
}
