/**
 * State of the Game page (/games/:id): the game, its members, tokens and encounters.
 * Plain values only ($state.raw arrays replaced as a whole). Writes throw ApiError; the
 * components show them (toast, form message). Role and rename changes are optimistic.
 */

import { ApiError } from '../api';
import type {
  Encounter,
  EncounterInput,
  Game,
  GamePatch,
  Member,
  MemberRole,
  Token,
  TokenInput,
} from '../types';
import { applyGamePatch } from './game-form';
import type { GamesClient } from './games-client';
import { nowIso, optimistic } from './optimistic';
import { canEditContent } from './roles';

export type GamePageStatus = 'loading' | 'ready' | 'not_found' | 'error';

export class GamePageModel {
  status = $state<GamePageStatus>('loading');
  error = $state.raw<unknown>(null);
  game = $state.raw<Game | null>(null);
  members = $state.raw<readonly Member[]>([]);
  tokens = $state.raw<readonly Token[]>([]);
  encounters = $state.raw<readonly Encounter[]>([]);
  /** Error of a secondary list (members, tokens, encounters): the page stays usable. */
  listError = $state.raw<unknown>(null);
  listsLoaded = $state(false);

  private token = 0;

  constructor(
    private readonly client: GamesClient,
    readonly gameId: string,
  ) {}

  get role() {
    return this.game?.my_role ?? 'player';
  }

  /** Loads the game, then its lists. A 404 (unknown game, or not a member) ⇒ not_found. */
  async load(): Promise<void> {
    const token = ++this.token;
    this.status = 'loading';
    this.error = null;
    try {
      const game = await this.client.get(this.gameId);
      if (token !== this.token) return;
      this.game = game;
      this.status = 'ready';
    } catch (error) {
      if (token !== this.token) return;
      this.error = error;
      this.status = error instanceof ApiError && error.status === 404 ? 'not_found' : 'error';
      return;
    }
    await this.loadLists(token);
  }

  async loadLists(token = this.token): Promise<void> {
    const game = this.game;
    if (game === null) return;
    this.listError = null;
    try {
      const editor = canEditContent(game.my_role);
      const [members, tokens, encounters] = await Promise.all([
        this.client.members(game.id),
        this.client.tokens(game.id),
        editor ? this.client.encounters(game.id) : Promise.resolve([]),
      ]);
      if (token !== this.token) return;
      this.members = members;
      this.tokens = tokens;
      this.encounters = encounters;
    } catch (error) {
      if (token === this.token) this.listError = error;
    } finally {
      if (token === this.token) this.listsLoaded = true;
    }
  }

  /* Game ---------------------------------------------------------------------------------- */

  /** PATCH the game, shown at once and rolled back if the server refuses. */
  async updateGame(patch: GamePatch): Promise<Game> {
    const updated = await optimistic(
      () => {
        const previous = this.requireGame();
        this.game = applyGamePatch(previous, patch);
        return previous;
      },
      () => this.client.update(this.gameId, patch),
      (previous) => {
        this.game = previous;
      },
    );
    this.game = updated;
    return updated;
  }

  async archive(): Promise<void> {
    const game = await this.client.archive(this.gameId);
    this.game = game ?? { ...this.requireGame(), archived_at: nowIso() };
  }

  async restore(): Promise<void> {
    const game = await this.client.restore(this.gameId);
    this.game = game ?? { ...this.requireGame(), archived_at: null, deleted_at: null };
  }

  async remove(): Promise<void> {
    await this.client.remove(this.gameId);
  }

  /* Members ------------------------------------------------------------------------------- */

  async addMember(identifier: string, role: MemberRole): Promise<Member> {
    const member = await this.client.addMember(this.gameId, identifier, role);
    this.members = [...this.members.filter((m) => m.user.id !== member.user.id), member];
    this.bumpCount('members', 1);
    return member;
  }

  /** Role change, optimistic. */
  async setRole(userId: string, role: MemberRole): Promise<void> {
    await optimistic(
      () => {
        const previous = this.members;
        this.members = previous.map((m) => (m.user.id === userId ? { ...m, role } : m));
        return previous;
      },
      () => this.client.setMemberRole(this.gameId, userId, role),
      (previous) => {
        this.members = previous;
      },
    );
  }

  async removeMember(userId: string): Promise<void> {
    await this.client.removeMember(this.gameId, userId);
    this.members = this.members.filter((m) => m.user.id !== userId);
    this.bumpCount('members', -1);
  }

  /* Tokens -------------------------------------------------------------------------------- */

  async createToken(input: TokenInput): Promise<Token> {
    const token = await this.client.createToken(this.gameId, input);
    this.tokens = [...this.tokens, token];
    this.bumpCount('tokens', 1);
    return token;
  }

  async updateToken(id: string, input: Partial<TokenInput>): Promise<Token> {
    const token = await this.client.updateToken(id, input);
    this.tokens = this.tokens.map((t) => (t.id === id ? token : t));
    return token;
  }

  async deleteToken(id: string): Promise<void> {
    await this.client.deleteToken(id);
    this.tokens = this.tokens.filter((t) => t.id !== id);
    // encounter_tokens rows cascade on the server: mirror it locally.
    this.encounters = this.encounters.map((e) =>
      e.tokens.some((p) => p.token_id === id)
        ? { ...e, tokens: e.tokens.filter((p) => p.token_id !== id) }
        : e,
    );
    this.bumpCount('tokens', -1);
  }

  /* Encounters ---------------------------------------------------------------------------- */

  async createEncounter(input: EncounterInput): Promise<Encounter> {
    const encounter = await this.client.createEncounter(this.gameId, input);
    this.encounters = [...this.encounters, encounter];
    return encounter;
  }

  async updateEncounter(id: string, input: EncounterInput): Promise<Encounter> {
    const encounter = await this.client.updateEncounter(id, input);
    this.encounters = this.encounters.map((e) => (e.id === id ? encounter : e));
    return encounter;
  }

  async deleteEncounter(id: string): Promise<void> {
    await this.client.deleteEncounter(id);
    this.encounters = this.encounters.filter((e) => e.id !== id);
  }

  /* Helpers ------------------------------------------------------------------------------- */

  private requireGame(): Game {
    if (this.game === null) throw new Error('Game not loaded');
    return this.game;
  }

  private bumpCount(key: 'members' | 'tokens', delta: number): void {
    const game = this.game;
    if (game === null) return;
    this.game = {
      ...game,
      counts: { ...game.counts, [key]: Math.max(0, game.counts[key] + delta) },
    };
  }
}
