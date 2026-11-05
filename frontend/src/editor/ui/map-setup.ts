/** Local draft map of P4a: grid built from the game settings and a size (projet.md 15, 11.4). */
import type { GridSpec } from '../contracts';
import { MAX_MAP_CELLS_PER_SIDE } from '../model/MapDocument';

/** Default size of a new map, in cells. */
export const DEFAULT_MAP_SIZE = { width: 60, height: 40 } as const;
/** Smallest map side, in cells. */
export const MIN_MAP_SIZE = 1;
/** Largest map side, in cells. */
export const MAX_MAP_SIZE = MAX_MAP_CELLS_PER_SIDE;

/** Game settings used by the editor (lib/types.ts GameSettings). */
export interface GridSettings {
  readonly default_cell_px: number;
  readonly unit_label: string;
  readonly unit_per_cell: number;
}

export interface MapSize {
  readonly width: number;
  readonly height: number;
}

/** Parses a side length typed in the size dialog; null when invalid. */
export function parseMapSide(value: string | number): number | null {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < MIN_MAP_SIZE || n > MAX_MAP_SIZE) return null;
  return n;
}

/** Builds the grid specification from the grid settings and the map size. */
export function gridFromSettings(settings: GridSettings, size: MapSize): GridSpec {
  const cellPx = Number.isFinite(settings.default_cell_px)
    ? Math.min(512, Math.max(16, Math.round(settings.default_cell_px)))
    : 70;
  return {
    width: size.width,
    height: size.height,
    cellPx,
    unitLabel: settings.unit_label,
    unitPerCell: settings.unit_per_cell > 0 ? settings.unit_per_cell : 1,
  };
}
