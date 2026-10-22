/**
 * Conversion between the server map format (contract P4b, projet.md 11.4/12.1: snake_case,
 * string identifiers) and the editor model (src/editor/contracts.ts).
 */
import type { GridSpec, GridTheme, LayerDef, LayerId, MapOp, PaletteEntry } from '../contracts';
import { DEFAULT_LAYERS } from '../model/ops';
import { validateLayers } from '../model/validate';
import type { MapDetail, MapLayer, MapPaletteEntry, WireMapOp } from '../../lib/types';

const THEMES: readonly GridTheme[] = ['parchment', 'slate', 'blueprint', 'dark', 'light'];

export function gridOf(map: Pick<MapDetail, 'grid'>): GridSpec {
  const g = map.grid;
  return {
    width: g.width,
    height: g.height,
    cellPx: Number.isFinite(g.cell_px) && g.cell_px > 0 ? g.cell_px : 70,
    unitLabel: g.unit_label,
    unitPerCell: g.unit_per_cell > 0 ? g.unit_per_cell : 1,
  };
}

export function themeOf(theme: string): GridTheme {
  return (THEMES as readonly string[]).includes(theme) ? (theme as GridTheme) : 'parchment';
}

/** Server layers ⇒ editor layers; the default stack when the list is not usable. */
export function layersFromWire(layers: readonly MapLayer[]): readonly LayerDef[] {
  try {
    return validateLayers(
      layers.map((l) => ({
        id: l.id as LayerId,
        kind: l.kind,
        visible: l.visible ?? true,
        locked: l.locked ?? false,
        opacity: l.opacity ?? 1,
        ...(l.gm_only === true ? { gmOnly: true } : {}),
      })),
    );
  } catch {
    return DEFAULT_LAYERS;
  }
}

export function layersToWire(layers: readonly LayerDef[]): MapLayer[] {
  return layers.map((l) => ({
    id: l.id,
    kind: l.kind,
    visible: l.visible,
    locked: l.locked,
    opacity: l.opacity,
    ...(l.gmOnly === true ? { gm_only: true } : {}),
  }));
}

export function paletteFromWire(
  palette: readonly (MapPaletteEntry | null)[],
): (PaletteEntry | null)[] {
  const out: (PaletteEntry | null)[] = [null];
  for (let i = 1; i < palette.length; i++) {
    const p = palette[i];
    out.push(
      p === null || p === undefined
        ? null
        : {
            assetId: p.asset_id,
            url: p.url,
            name: p.name,
            ...(p.autotile !== null && p.autotile !== undefined ? { autotile: p.autotile } : {}),
          },
    );
  }
  return out;
}

/** Editor op ⇒ wire op (map.meta layers carry `gm_only`). */
export function toWireOp(op: MapOp): WireMapOp {
  if (op.type !== 'map.meta') return op;
  return {
    type: 'map.meta',
    ...(op.layers !== undefined ? { layers: layersToWire(op.layers) } : {}),
    ...(op.theme !== undefined ? { theme: op.theme } : {}),
  };
}
