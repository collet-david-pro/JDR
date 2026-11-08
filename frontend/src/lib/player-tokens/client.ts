/**
 * Player tokens API: personal collection (/me/player-tokens) and the token chosen for a game
 * (/games/{id}/my-token). Multipart calls go through xhrUpload (same envelope, CSRF and errors).
 */
import { ApiError, type ApiClient } from '../api';
import { xhrUpload } from '../assets/xhr-upload';
import { services } from '../services';
import type { Token } from '../types';

export interface ImagePair {
  readonly full: string;
  readonly thumb: string;
}

export interface PlayerToken {
  readonly id: string;
  readonly name: string;
  readonly image: ImagePair | null;
  readonly source_image: ImagePair | null;
  readonly design: Readonly<Record<string, unknown>>;
  readonly games_count: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SaveInput {
  readonly name: string;
  readonly design: string;
  readonly png: Blob;
  /** Portrait source (re-editing); null = no portrait in this design. */
  readonly source: Blob | null;
  /** Re-edit only: keep the stored portrait when no new one is sent. */
  readonly keepSource?: boolean;
}

export class PlayerTokensClient {
  constructor(private readonly api: ApiClient) {}

  async list(): Promise<{ items: PlayerToken[]; max: number }> {
    const response = await this.api.get<PlayerToken[]>('/me/player-tokens');
    const max = response.meta['max'];
    return {
      items: Array.isArray(response.data) ? response.data : [],
      max: typeof max === 'number' ? max : 100,
    };
  }

  async create(input: SaveInput): Promise<PlayerToken> {
    return this.send<PlayerToken>('/me/player-tokens', input);
  }

  async redesign(id: string, input: SaveInput): Promise<PlayerToken> {
    return this.send<PlayerToken>(`/me/player-tokens/${id}/design`, input);
  }

  async rename(id: string, name: string): Promise<PlayerToken> {
    return (await this.api.patch<PlayerToken>(`/me/player-tokens/${id}`, { name })).data;
  }

  async duplicate(id: string, name: string): Promise<PlayerToken> {
    return (await this.api.post<PlayerToken>(`/me/player-tokens/${id}/duplicate`, { name })).data;
  }

  /** A 409 `player_token_in_use` asks for confirmation: call again with force. */
  async remove(id: string, force = false): Promise<void> {
    await this.api.delete(`/me/player-tokens/${id}`, { query: { force: force ? 1 : null } });
  }

  async choice(gameId: string): Promise<PlayerToken | null> {
    return (await this.api.get<PlayerToken | null>(`/games/${gameId}/my-token`)).data;
  }

  /** Out of session only (409 `session_in_progress`); null clears the choice. */
  async choose(gameId: string, playerTokenId: string | null): Promise<Token | null> {
    return (
      await this.api.put<Token | null>(`/games/${gameId}/my-token`, {
        player_token_id: playerTokenId,
      })
    ).data;
  }

  private async send<T>(path: string, input: SaveInput): Promise<T> {
    const form = (): FormData => {
      const body = new FormData();
      body.append('file', input.png, 'token.png');
      body.append('name', input.name);
      body.append('design', input.design);
      if (input.source !== null) body.append('source', input.source, 'portrait.jpg');
      else if (input.keepSource === true) body.append('keep_source', '1');
      return body;
    };
    for (let attempt = 0; ; attempt++) {
      try {
        return (
          await xhrUpload<T>({ url: this.api.url(path), body: form(), csrf: this.api.csrfToken })
        ).data;
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

let shared: PlayerTokensClient | null = null;

export function playerTokensClient(): PlayerTokensClient {
  shared ??= new PlayerTokensClient(services().api);
  return shared;
}
