/**
 * State of the Maps tab of a game (projet.md 18.1 p.3): active maps or the trash, sorted and
 * grouped by folder. Plain values only ($state.raw arrays replaced as a whole). Writes throw
 * ApiError; the components show them.
 */
import type { MapsClient } from './maps-client';
import type { MapInput, MapListState, MapPatch, MapSummary, MapDetail } from '../types';
import { groupByFolder, type MapFolderGroup, type MapSort } from './folders';

export type MapsTabStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Summary of a detailed map (create / duplicate answers). */
export function summaryOf(map: MapDetail): MapSummary {
  return {
    id: map.id,
    game_id: map.game_id,
    name: map.name,
    folder: map.folder,
    sort_order: map.sort_order,
    kind: map.kind,
    grid: { width: map.grid.width, height: map.grid.height },
    thumb_url: map.thumb_url,
    revision: map.revision,
    updated_at: map.updated_at,
    deleted_at: map.deleted_at,
  };
}

export class MapsTabModel {
  status = $state<MapsTabStatus>('idle');
  error = $state.raw<unknown>(null);
  view = $state<MapListState>('active');
  sort = $state<MapSort>('manual');
  maps = $state.raw<readonly MapSummary[]>([]);
  readonly groups: MapFolderGroup[] = $derived(groupByFolder(this.maps, this.sort));

  private token = 0;

  constructor(
    private readonly client: Pick<
      MapsClient,
      'list' | 'create' | 'update' | 'remove' | 'restore' | 'duplicate'
    >,
    readonly gameId: string,
  ) {}

  async load(view: MapListState = this.view): Promise<void> {
    const token = ++this.token;
    this.view = view;
    this.status = 'loading';
    this.error = null;
    try {
      const maps = await this.client.list(this.gameId, view);
      if (token !== this.token) return;
      this.maps = maps;
      this.status = 'ready';
    } catch (error) {
      if (token !== this.token) return;
      this.error = error;
      this.status = 'error';
    }
  }

  async create(input: MapInput): Promise<MapDetail> {
    const map = await this.client.create(this.gameId, input);
    if (this.view === 'active') this.maps = [...this.maps, summaryOf(map)];
    return map;
  }

  async update(id: string, patch: MapPatch): Promise<MapSummary> {
    const updated = await this.client.update(id, patch);
    this.maps = this.maps.map((m) => (m.id === id ? { ...m, ...updated } : m));
    return updated;
  }

  async duplicate(id: string): Promise<MapDetail> {
    const copy = await this.client.duplicate(id);
    if (this.view === 'active') this.maps = [...this.maps, summaryOf(copy)];
    return copy;
  }

  /** To the trash (restorable). */
  async trash(id: string): Promise<void> {
    await this.client.remove(id);
    this.maps = this.maps.filter((m) => m.id !== id);
  }

  async restore(id: string): Promise<void> {
    await this.client.restore(id);
    this.maps = this.maps.filter((m) => m.id !== id);
  }
}
