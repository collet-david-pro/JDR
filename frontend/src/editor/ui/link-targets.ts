/**
 * Where a link can lead (P9a2): the maps of the game and the floors of each (door / stairs / portal link
 * editors). Reads are cached for the life of the editor; the floors of the edited map are always live.
 */
export interface LinkMapItem {
  readonly id: string;
  readonly name: string;
}

export interface LinkFloorItem {
  readonly uid: string;
  readonly name: string;
  readonly level: number;
}

export interface LinkTargetsDeps {
  readonly currentMapId: string;
  readonly currentFloors: () => readonly LinkFloorItem[];
  readonly listMaps: () => Promise<readonly LinkMapItem[]>;
  readonly floorsOf: (mapId: string) => Promise<readonly LinkFloorItem[]>;
}

/** Computes the maps and floors that a link or portal can target. */
export class LinkTargets {
  private mapsCache: Promise<readonly LinkMapItem[]> | null = null;
  private readonly floorsCache = new Map<string, Promise<readonly LinkFloorItem[]>>();

  constructor(private readonly deps: LinkTargetsDeps) {}

  get currentMapId(): string {
    return this.deps.currentMapId;
  }

  maps(): Promise<readonly LinkMapItem[]> {
    this.mapsCache ??= this.deps.listMaps().catch((error: unknown) => {
      this.mapsCache = null;
      throw error;
    });
    return this.mapsCache;
  }

  floors(mapId: string): Promise<readonly LinkFloorItem[]> {
    if (mapId === this.deps.currentMapId) return Promise.resolve(this.deps.currentFloors());
    let cached = this.floorsCache.get(mapId);
    if (cached === undefined) {
      cached = this.deps.floorsOf(mapId).catch((error: unknown) => {
        this.floorsCache.delete(mapId);
        throw error;
      });
      this.floorsCache.set(mapId, cached);
    }
    return cached;
  }
}

/** Svelte context key of the LinkTargets provided by the editor workspace. */
export const LINK_TARGETS = Symbol('link-targets');

/**
 * Whether a link no longer leads anywhere: flagged by the server, no map, a map that is not in the game's
 * list, or a floor that the target map does not have. `maps` / `floors` null = not read yet (not broken).
 */
export function linkBroken(
  link: {
    readonly map_id: string | null;
    readonly floor: string | null;
    readonly broken?: true | undefined;
  } | null,
  maps: readonly LinkMapItem[] | null,
  floors: readonly LinkFloorItem[] | null,
): boolean {
  if (link === null) return false;
  if (link.broken === true || link.map_id === null) return true;
  if (maps !== null && !maps.some((m) => m.id === link.map_id)) return true;
  return floors !== null && link.floor !== null && !floors.some((f) => f.uid === link.floor);
}
