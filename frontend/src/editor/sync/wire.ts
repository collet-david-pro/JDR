/**
 * Conversion between the server map format (contract P4b, projet.md 11.4/12.1: snake_case,
 * string identifiers) and the editor model (src/editor/contracts.ts).
 */
import type {
  GridSpec,
  GridTheme,
  LayerDef,
  LayerId,
  Link,
  MapObject,
  MapOp,
  PaletteEntry,
  TokenDefView,
} from '../contracts';
import { DEFAULT_LAYERS } from '../model/ops';
import { validateLayers } from '../model/validate';
import type { MapDetail, MapLayer, MapPaletteEntry, Token, WireMapOp } from '../../lib/types';

const THEMES: readonly GridTheme[] = ['parchment', 'slate', 'blueprint', 'dark', 'light'];

/** Extracts the grid specification from a map detail. */
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

/** Validates a theme name from the server, falling back to a default. */
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

/** Converts editor layers to their wire form. */
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

/** Rebuilds the palette from its wire form. */
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
            ...(p.repeat !== null && p.repeat !== undefined ? { repeat: p.repeat } : {}),
          },
    );
  }
  return out;
}

/** Editor op ⇒ wire op (map.meta layers carry `gm_only`). */
export function toWireOp(op: MapOp): WireMapOp {
  if (op.type === 'object.add') return { ...op, object: wireObject(op.object) };
  if (op.type === 'object.update' && op.patch.props !== undefined) {
    return { ...op, patch: { ...op.patch, props: wireProps(op.patch.props) } };
  }
  if (op.type !== 'map.meta') return op;
  return {
    type: 'map.meta',
    ...(op.layers !== undefined ? { layers: layersToWire(op.layers) } : {}),
    ...(op.theme !== undefined ? { theme: op.theme } : {}),
    ...(op.ambient !== undefined ? { ambient: op.ambient } : {}),
  };
}

/** Props without the read-side hints of a link (`broken`, `map_name`): the server computes them. */
function wireProps<P extends MapObject['props']>(props: P): P {
  const link = (props as { link?: Link }).link;
  if (link === undefined || (link.broken === undefined && link.map_name === undefined))
    return props;
  const { broken: _broken, map_name: _name, ...clean } = link;
  return { ...props, link: clean };
}

function wireObject(object: MapObject): MapObject {
  const props = wireProps(object.props);
  return props === object.props ? object : ({ ...object, props } as MapObject);
}

/** Token definition of the game (GET /games/{id}/tokens) as seen by the engine and tools. */
export function tokenDefFromWire(token: Token): TokenDefView {
  return {
    id: token.id,
    name: token.name,
    imageUrl: token.image?.full ?? null,
    sizeW: token.size_w > 0 ? token.size_w : 1,
    sizeH: token.size_h > 0 ? token.size_h : 1,
    ringColor: token.ring_color,
    kind: token.kind,
    vision: {
      enabled: token.vision.enabled,
      range: token.vision.range,
      dark: token.vision.dark,
    },
    light: token.light === null ? null : { ...token.light },
  };
}
