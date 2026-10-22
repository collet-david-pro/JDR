/**
 * Maps API (etapes/P04 "Contrat d'API P4b", projet.md 9.2, 11.4): list, CRUD, trash,
 * duplication, ops and binary tile blocks. Identifiers are strings, URL-encoded in paths.
 */
import { ApiError, type ApiClient } from '../api';
import type {
  MapDetail,
  MapInput,
  MapListState,
  MapOpsRequest,
  MapOpsResult,
  MapPatch,
  MapSummary,
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

export class MapsClient {
  constructor(private readonly api: ApiClient) {}

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
}
