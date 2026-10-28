/**
 * Applies a generation result to the edited map: one command (= ONE undo entry, D12) built by
 * `bindResult`, whose ops go to the sync queue like any tool's (History.onOps). Pack assets used
 * are then registered in the palette catalog so the engine can draw the new entries.
 */
import type { CellRect, MapView, SceneView } from '../../editor/contracts';
import type { EditorSession } from '../../editor/ui/session';
import { bindResult, type BindTarget } from '../../procgen/bind';
import { newObjectUid } from '../../editor/util/uid';
import { fallbackKey } from '../../procgen/pack-keys';
import type { GenResult, PackKey } from '../../procgen/types';
import type { Pack } from './pack';

export interface ApplyInput {
  result: GenResult;
  pack: Pick<Pack, 'assets'>;
  /** map: replaces the whole floor (tiles and objects); selection: replaces `rect` only. */
  target: 'map' | 'selection';
  /** Required for the selection target (cells, inside the grid). */
  rect?: CellRect;
}

export interface ApplyReport {
  /** Pack keys without asset, even after fallback (cells left empty). */
  missing: PackKey[];
  /** Tile cells in the result (ground + terrain + decor). */
  cells: number;
  /** Objects added (walls, doors, windows, lights). */
  objects: number;
}

/** No tile on the three layers and no object on the floor (confirmation before replacing). */
export function isMapEmpty(doc: MapView & SceneView, floor: string): boolean {
  for (const layer of ['ground', 'terrain', 'decor'] as const) {
    if (doc.chunkKeys(layer).length > 0) return false;
  }
  return !doc.objects().some((o) => o.floor === floor);
}

export function applyGeneration(
  session: EditorSession,
  gen: ApplyInput,
  newUid?: () => string,
): ApplyReport {
  const doc = session.doc;
  const floor = doc.floor;
  const { result } = gen;
  const f = result.floors[0];
  if (f === undefined) throw new Error('applyGeneration: empty result');
  let tiles: CellRect;
  let offset: { x: number; y: number };
  let objects: 'all' | 'inside';
  if (gen.target === 'selection') {
    if (gen.rect === undefined) throw new Error('applyGeneration: rect required for a selection');
    tiles = gen.rect;
    offset = { x: gen.rect.x, y: gen.rect.y };
    objects = 'inside';
  } else {
    tiles = { x: 0, y: 0, w: doc.grid.width, h: doc.grid.height };
    offset = { x: 0, y: 0 };
    objects = 'all';
  }
  const uid = newUid ?? (() => newObjectUid());
  const target: BindTarget = {
    floor,
    offset,
    view: doc,
    scene: doc,
    pack: gen.pack.assets,
    replace: { tiles, objects },
    fallback: fallbackKey,
  };
  const { command, missing } = bindResult(result, target, uid);
  session.history.execute(command);

  // Make the used pack assets drawable: url + name on the palette entries, catalog entry.
  const used = new Set<PackKey>();
  for (const layer of [f.ground, f.terrain, f.decor]) for (const c of layer) used.add(c.key);
  for (const key of used) {
    const fb = fallbackKey(key);
    const asset = gen.pack.assets[key] ?? (fb === null ? undefined : gen.pack.assets[fb]);
    if (asset === undefined || asset.url === null) continue;
    doc.updatePaletteAsset(asset.asset_id, { url: asset.url, name: asset.name });
    session.catalog.rememberEntry(asset.asset_id, {
      name: asset.name,
      full: asset.url,
      thumb: asset.url,
    });
  }
  session.refreshPalette();
  return {
    missing,
    cells: f.ground.length + f.terrain.length + f.decor.length,
    objects: f.walls.length + f.doors.length + f.windows.length + f.lights.length,
  };
}
