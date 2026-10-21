/**
 * Dashboard games (projet.md 18.1 p.2): "my games (GM)", "games I play", and on demand the
 * archived and trashed games of the GM, which can be restored.
 */

import type { Game, GameInput, GameState } from '../types';
import type { GamesClient } from './games-client';

export type ShelfState = Exclude<GameState, 'active'>;

/** Splits the active games by my role (co-GM games are listed with the played ones). */
export function splitByRole(games: readonly Game[]): { gm: Game[]; player: Game[] } {
  const gm: Game[] = [];
  const player: Game[] = [];
  for (const game of games) (game.my_role === 'gm' ? gm : player).push(game);
  const byName = (a: Game, b: Game): number => a.name.localeCompare(b.name, 'fr');
  return { gm: gm.sort(byName), player: player.sort(byName) };
}

export class DashboardGames {
  gm = $state.raw<readonly Game[]>([]);
  player = $state.raw<readonly Game[]>([]);
  loading = $state(false);
  loaded = $state(false);
  error = $state.raw<unknown>(null);
  /** Archived / trashed games of the GM, loaded when the section is opened. */
  shelf = $state.raw<Readonly<Record<ShelfState, readonly Game[] | null>>>({
    archived: null,
    trash: null,
  });
  shelfError = $state.raw<unknown>(null);

  constructor(private readonly client: GamesClient) {}

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const { gm, player } = splitByRole(await this.client.list());
      this.gm = gm;
      this.player = player;
      this.loaded = true;
    } catch (error) {
      this.error = error;
    } finally {
      this.loading = false;
    }
  }

  async loadShelf(state: ShelfState): Promise<void> {
    this.shelfError = null;
    try {
      const games = await this.client.list({ role: 'gm', state });
      this.shelf = { ...this.shelf, [state]: games };
    } catch (error) {
      this.shelfError = error;
    }
  }

  async create(input: GameInput): Promise<Game> {
    const game = await this.client.create(input);
    this.gm = splitByRole([...this.gm, game]).gm;
    return game;
  }

  /** Restores an archived or trashed game: it goes back to the active list. */
  async restore(game: Game, from: ShelfState): Promise<void> {
    const restored = (await this.client.restore(game.id)) ?? {
      ...game,
      archived_at: null,
      deleted_at: null,
    };
    const list = this.shelf[from];
    this.shelf = { ...this.shelf, [from]: list?.filter((g) => g.id !== game.id) ?? null };
    this.gm = splitByRole([...this.gm.filter((g) => g.id !== game.id), restored]).gm;
  }
}
