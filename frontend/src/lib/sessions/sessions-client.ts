/**
 * Sessions API (etapes/P06 "Endpoints séances" and "Actions de séance"). Identifiers are
 * strings, URL-encoded in paths; errors are ApiError (see errors.ts for the session cases).
 * Every write accepts a `clientOpId` (≤ 40 characters): the same value replays the same answer
 * without a second execution (processed_ops).
 */
import type { ApiClient } from '../api';
import { normalizeSessionCode } from './code';
import type {
  ActionsResponse,
  JoinResult,
  Preload,
  Session,
  SessionAction,
  SessionInput,
  SessionList,
  SessionPatch,
  SessionSnapshot,
} from './types';

const seg = (id: string): string => encodeURIComponent(id);

export interface WriteOptions {
  readonly clientOpId?: string;
  readonly signal?: AbortSignal;
}

export type Transition = 'start' | 'pause' | 'resume' | 'end';

export class SessionsClient {
  constructor(private readonly api: ApiClient) {}

  async create(gameId: string, input: SessionInput = {}, o: WriteOptions = {}): Promise<Session> {
    return (await this.api.post<Session>(`/games/${seg(gameId)}/sessions`, body(input, o), opts(o)))
      .data;
  }

  async list(
    gameId: string,
    page: { cursor?: string | null; limit?: number } = {},
  ): Promise<SessionList> {
    const { data, meta } = await this.api.get<Session[]>(`/games/${seg(gameId)}/sessions`, {
      query: { cursor: page.cursor ?? null, limit: page.limit ?? null },
    });
    const next = meta['next_cursor'];
    return {
      items: Array.isArray(data) ? data : [],
      nextCursor: typeof next === 'string' ? next : null,
    };
  }

  async get(id: string, signal?: AbortSignal): Promise<Session> {
    return (await this.api.get<Session>(`/sessions/${seg(id)}`, signal ? { signal } : {})).data;
  }

  async update(id: string, patch: SessionPatch, o: WriteOptions = {}): Promise<Session> {
    return (await this.api.patch<Session>(`/sessions/${seg(id)}`, body(patch, o), opts(o))).data;
  }

  /** Joins with a code typed by the user (normalised here: "k7f2-qm9x" ⇒ "K7F2QM9X"). */
  async join(code: string, o: WriteOptions = {}): Promise<JoinResult> {
    return (
      await this.api.post<JoinResult>(
        '/sessions/join',
        body({ code: normalizeSessionCode(code) }, o),
        opts(o),
      )
    ).data;
  }

  async leave(id: string, o: WriteOptions = {}): Promise<void> {
    await this.api.post<null>(`/sessions/${seg(id)}/leave`, body({}, o), opts(o));
  }

  /** start / pause / resume / end (409 invalid_transition, 422 current_map_id on start). */
  async transition(id: string, action: Transition, o: WriteOptions = {}): Promise<Session> {
    return (await this.api.post<Session>(`/sessions/${seg(id)}/${action}`, body({}, o), opts(o)))
      .data;
  }

  start(id: string, o?: WriteOptions): Promise<Session> {
    return this.transition(id, 'start', o);
  }

  pause(id: string, o?: WriteOptions): Promise<Session> {
    return this.transition(id, 'pause', o);
  }

  resume(id: string, o?: WriteOptions): Promise<Session> {
    return this.transition(id, 'resume', o);
  }

  end(id: string, o?: WriteOptions): Promise<Session> {
    return this.transition(id, 'end', o);
  }

  /** The new code, without dash (use formatSessionCode to show it). */
  async regenerateCode(id: string, o: WriteOptions = {}): Promise<string> {
    const { data } = await this.api.post<{ code: string }>(
      `/sessions/${seg(id)}/regenerate-code`,
      body({}, o),
      opts(o),
    );
    return data.code;
  }

  async kick(id: string, userId: string, o: WriteOptions = {}): Promise<void> {
    await this.api.post<null>(`/sessions/${seg(id)}/kick`, body({ user_id: userId }, o), opts(o));
  }

  async assign(
    id: string,
    tokenId: string,
    userId: string | null,
    o: WriteOptions = {},
  ): Promise<{ token_id: string; user_id: string | null }> {
    return (
      await this.api.put<{ token_id: string; user_id: string | null }>(
        `/sessions/${seg(id)}/assignments/${seg(tokenId)}`,
        body({ user_id: userId }, o),
        opts(o),
      )
    ).data;
  }

  async ready(id: string, ready: boolean, o: WriteOptions = {}): Promise<void> {
    await this.api.post<null>(`/sessions/${seg(id)}/ready`, body({ ready }, o), opts(o));
  }

  async changeMap(
    id: string,
    mapId: string,
    floorId?: string,
    o: WriteOptions = {},
  ): Promise<Session> {
    const fields = floorId === undefined ? { map_id: mapId } : { map_id: mapId, floor_id: floorId };
    return (
      await this.api.post<Session>(`/sessions/${seg(id)}/change-map`, body(fields, o), opts(o))
    ).data;
  }

  /** 409 session_paused for a player while paused; 409 session_not_running once ended. */
  async preload(id: string, signal?: AbortSignal): Promise<Preload> {
    return (await this.api.get<Preload>(`/sessions/${seg(id)}/preload`, signal ? { signal } : {}))
      .data;
  }

  async snapshot(id: string, signal?: AbortSignal): Promise<SessionSnapshot> {
    return (
      await this.api.get<SessionSnapshot>(`/sessions/${seg(id)}/snapshot`, signal ? { signal } : {})
    ).data;
  }

  /** POST /presence (every 20 s while the session is open). */
  async presence(sessionId: string): Promise<void> {
    await this.api.post<null>('/presence', { session_id: sessionId }, { retries: 0 });
  }

  /** 1-20 actions; refused as a whole on 422, `results` otherwise (blocked_by_wall per action). */
  async actions(
    id: string,
    actions: readonly SessionAction[],
    o: WriteOptions = {},
  ): Promise<ActionsResponse> {
    return (
      await this.api.post<ActionsResponse>(
        `/sessions/${seg(id)}/actions`,
        body({ actions }, o),
        opts(o),
      )
    ).data;
  }
}

function body(fields: object, o: WriteOptions): object {
  return o.clientOpId === undefined ? fields : { ...fields, client_op_id: o.clientOpId };
}

function opts(o: WriteOptions): { signal?: AbortSignal } {
  return o.signal === undefined ? {} : { signal: o.signal };
}
