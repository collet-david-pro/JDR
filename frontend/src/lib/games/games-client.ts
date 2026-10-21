/**
 * Games API (etapes/P03 "Contrat d'API P3"): games, members, tokens and encounters.
 * Identifiers are strings and are URL-encoded in paths; errors are ApiError (lib/api.ts).
 */

import type { ApiClient } from '../api';
import type {
  Encounter,
  EncounterInput,
  Game,
  GameInput,
  GamePatch,
  GameState,
  Member,
  MemberRole,
  Token,
  TokenInput,
} from '../types';

export interface GameListFilters {
  /** Omitted: games where I am GM and games where I play. */
  readonly role?: 'gm' | 'player';
  /** Omitted: active games (server default). */
  readonly state?: GameState;
}

const seg = (id: string): string => encodeURIComponent(id);

function list<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

/** A response body that is a game (archive/restore may answer 204 or the game). */
function gameOrNull(data: unknown): Game | null {
  return typeof data === 'object' && data !== null && 'id' in data ? (data as Game) : null;
}

export class GamesClient {
  constructor(private readonly api: ApiClient) {}

  /* Games ------------------------------------------------------------------------------- */

  async list(filters: GameListFilters = {}): Promise<Game[]> {
    const { data } = await this.api.get<Game[]>('/games', {
      query: { role: filters.role ?? null, state: filters.state ?? null },
    });
    return list<Game>(data);
  }

  async create(input: GameInput): Promise<Game> {
    return (await this.api.post<Game>('/games', input)).data;
  }

  async get(id: string, signal?: AbortSignal): Promise<Game> {
    const options = signal === undefined ? {} : { signal };
    return (await this.api.get<Game>(`/games/${seg(id)}`, options)).data;
  }

  async update(id: string, patch: GamePatch): Promise<Game> {
    return (await this.api.patch<Game>(`/games/${seg(id)}`, patch)).data;
  }

  /** Soft delete (trash, restorable for `trash_days`). */
  async remove(id: string): Promise<void> {
    await this.api.delete(`/games/${seg(id)}`);
  }

  async archive(id: string): Promise<Game | null> {
    return gameOrNull((await this.api.post<unknown>(`/games/${seg(id)}/archive`)).data);
  }

  /** Un-archives the game and takes it out of the trash. */
  async restore(id: string): Promise<Game | null> {
    return gameOrNull((await this.api.post<unknown>(`/games/${seg(id)}/restore`)).data);
  }

  /* Members ----------------------------------------------------------------------------- */

  async members(gameId: string): Promise<Member[]> {
    return list<Member>((await this.api.get<Member[]>(`/games/${seg(gameId)}/members`)).data);
  }

  /** Direct invitation by e-mail or username (422 fields.identifier = not_found). */
  async addMember(gameId: string, identifier: string, role?: MemberRole): Promise<Member> {
    const body = role === undefined ? { identifier } : { identifier, role };
    return (await this.api.post<Member>(`/games/${seg(gameId)}/members`, body)).data;
  }

  async setMemberRole(gameId: string, userId: string, role: MemberRole): Promise<void> {
    await this.api.patch(`/games/${seg(gameId)}/members/${seg(userId)}`, { role });
  }

  /** Removes a member (GM), or leaves the game when `userId` is the current user. */
  async removeMember(gameId: string, userId: string): Promise<void> {
    await this.api.delete(`/games/${seg(gameId)}/members/${seg(userId)}`);
  }

  /* Tokens ------------------------------------------------------------------------------ */

  /** GM/co-GM: every token; player: the tokens they own by default. */
  async tokens(gameId: string): Promise<Token[]> {
    return list<Token>((await this.api.get<Token[]>(`/games/${seg(gameId)}/tokens`)).data);
  }

  async createToken(gameId: string, input: TokenInput): Promise<Token> {
    return (await this.api.post<Token>(`/games/${seg(gameId)}/tokens`, input)).data;
  }

  async updateToken(id: string, patch: Partial<TokenInput>): Promise<Token> {
    return (await this.api.patch<Token>(`/tokens/${seg(id)}`, patch)).data;
  }

  async deleteToken(id: string): Promise<void> {
    await this.api.delete(`/tokens/${seg(id)}`);
  }

  /* Encounters -------------------------------------------------------------------------- */

  async encounters(gameId: string): Promise<Encounter[]> {
    return list<Encounter>(
      (await this.api.get<Encounter[]>(`/games/${seg(gameId)}/encounters`)).data,
    );
  }

  async createEncounter(gameId: string, input: EncounterInput): Promise<Encounter> {
    return (await this.api.post<Encounter>(`/games/${seg(gameId)}/encounters`, input)).data;
  }

  async updateEncounter(id: string, patch: Partial<EncounterInput>): Promise<Encounter> {
    return (await this.api.patch<Encounter>(`/encounters/${seg(id)}`, patch)).data;
  }

  async deleteEncounter(id: string): Promise<void> {
    await this.api.delete(`/encounters/${seg(id)}`);
  }
}
