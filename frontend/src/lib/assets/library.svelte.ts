/**
 * State of a library view (projet.md 13.2 `library` store): filters, cursor-paginated
 * asset list, categories, tags, limits, storage usage and selection. Used by the user
 * library (/library) and by the admin "general library" tab (scope fixed to general).
 */

import { CursorList } from '../cursor-list.svelte';
import {
  ASSET_KINDS,
  type Asset,
  type AssetCategory,
  type AssetFilters,
  type AssetKind,
  type AssetLimits,
  type AssetListScope,
  type AssetTag,
  type StorageUsage,
} from '../types';
import type { AssetsClient } from './assets-client';

export interface LibraryOptions {
  /** Admin console: general library only, general categories and tags. */
  readonly admin?: boolean;
}

export class LibraryModel {
  /** Bound to form controls: validated by filters(). */
  scope = $state<string>('mine');
  kind = $state<string>('');
  q = $state('');
  tag = $state('');
  category = $state('');
  favorites = $state(false);

  categories = $state.raw<readonly AssetCategory[]>([]);
  tags = $state.raw<readonly AssetTag[]>([]);
  limits = $state.raw<AssetLimits | null>(null);
  storage = $state.raw<StorageUsage | null>(null);
  selectedId = $state<string | null>(null);

  readonly admin: boolean;
  readonly list: CursorList<Asset>;

  constructor(
    readonly client: AssetsClient,
    options: LibraryOptions = {},
  ) {
    this.admin = options.admin === true;
    if (this.admin) this.scope = 'general';
    this.list = new CursorList<Asset>((cursor) => this.client.list(this.filters(), cursor));
  }

  filters(): AssetFilters {
    const scope: AssetListScope = this.admin || this.scope === 'general' ? 'general' : 'mine';
    const kind = (ASSET_KINDS as readonly string[]).includes(this.kind)
      ? (this.kind as AssetKind)
      : '';
    return {
      scope,
      kind,
      q: this.q,
      tag: this.tag,
      category: this.category,
      favorites: this.favorites,
    };
  }

  get selected(): Asset | null {
    return this.list.items.find((asset) => asset.id === this.selectedId) ?? null;
  }

  /** Scope of the categories and tags this view manages. */
  get ownScope(): 'personal' | 'general' {
    return this.admin ? 'general' : 'personal';
  }

  /** Personal assets for users, general assets in the admin console. */
  canEdit(asset: Asset): boolean {
    return asset.scope === this.ownScope;
  }

  reload(): Promise<void> {
    return this.list.reload();
  }

  async loadTaxonomy(): Promise<void> {
    const [categories, tags] = await Promise.all([this.client.categories(), this.client.tags()]);
    this.categories = categories;
    this.tags = tags;
  }

  async loadLimits(): Promise<void> {
    this.limits = await this.client.limits();
  }

  /** GET /me/storage (not shown in the admin console: general assets use no quota). */
  async refreshStorage(): Promise<void> {
    if (this.admin) return;
    this.storage = await this.client.storage();
  }

  /** Inserts or replaces an asset after an upload or an edit. */
  upsert(asset: Asset): void {
    if (this.list.items.some((item) => item.id === asset.id)) {
      this.list.replace((item) => item.id === asset.id, asset);
      return;
    }
    const visibleScope = this.admin || this.scope === 'general' ? 'general' : 'personal';
    if (asset.scope === visibleScope) this.list.prepend(asset);
  }

  removeLocal(id: string): void {
    this.list.remove((item) => item.id === id);
    if (this.selectedId === id) this.selectedId = null;
  }

  categoryName(id: string | null): string | null {
    if (id === null) return null;
    return this.categories.find((category) => category.id === id)?.name ?? null;
  }
}
