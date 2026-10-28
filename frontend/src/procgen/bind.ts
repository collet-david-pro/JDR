/** GenResult => Command binding (D2, D11, D12): uids, palette indices and offset live here. */
import type {
  CellRect,
  Command,
  DoorObject,
  LightObject,
  MapObject,
  MapOp,
  MapView,
  Point,
  SceneView,
  TileCell,
  TileLayerId,
  WallObject,
  WindowObject,
} from '../editor/contracts';
import { LIGHT_PRESETS } from '../editor/tools/object-common';
import { DEFAULT_OBJECT_SETTINGS } from '../editor/tools/types';
import { round3 } from './geometry';
import type { GenCell, GenFloor, GenResult, PackKey } from './types';

export interface PackAsset {
  asset_id: string;
  url: string | null;
  name: string;
}
export interface BindTarget {
  /** Id of the target floor. */
  floor: string;
  /** (0, 0) except for the selection target. */
  offset: { x: number; y: number };
  view: MapView;
  /** Existing objects of the floor; null = new map. */
  scene: SceneView | null;
  pack: Readonly<Record<PackKey, PackAsset>>;
  replace: { tiles: CellRect; objects: 'all' | 'inside' | 'none' };
  /** D4: substitute key of the same family. */
  fallback?: (key: PackKey) => PackKey | null;
}

export const MAX_PALETTE = 4096;
export const TILE_OP_CHUNK = 5000;
const LAYERS: readonly TileLayerId[] = ['ground', 'terrain', 'decor'];

function bbox(o: MapObject): [number, number, number, number] {
  switch (o.type) {
    case 'wall': {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of o.geometry.points) {
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]);
        y1 = Math.max(y1, p[1]);
      }
      return [x0, y0, x1, y1];
    }
    case 'door':
    case 'window': {
      const { a, b } = o.geometry;
      return [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1]),
      ];
    }
    case 'light':
      return [o.geometry.x, o.geometry.y, o.geometry.x, o.geometry.y];
  }
}

function chunked(
  floor: string,
  layer: TileLayerId,
  cells: readonly TileCell[],
): Extract<MapOp, { type: 'tiles.set' }>[] {
  const ops: Extract<MapOp, { type: 'tiles.set' }>[] = [];
  for (let i = 0; i < cells.length; i += TILE_OP_CHUNK) {
    ops.push({ type: 'tiles.set', floor, layer, cells: cells.slice(i, i + TILE_OP_CHUNK) });
  }
  return ops;
}

export function bindResult(
  r: GenResult,
  t: BindTarget,
  newUid: () => string,
): { command: Command; missing: PackKey[] } {
  if (r.floors.length !== 1) {
    throw new Error(`bindResult: exactly one floor expected, got ${r.floors.length}`);
  }
  const f: GenFloor = r.floors[0]!;
  const { offset: off } = t;
  const g = t.view.grid;
  // Rectangle of replaced cells, clipped to the grid.
  const x0 = Math.max(0, t.replace.tiles.x);
  const y0 = Math.max(0, t.replace.tiles.y);
  const x1 = Math.min(g.width, t.replace.tiles.x + t.replace.tiles.w);
  const y1 = Math.min(g.height, t.replace.tiles.y + t.replace.tiles.h);

  // ---- palette ----
  const palette = t.view.palette;
  const indexOfAsset = new Map<string, number>();
  palette.forEach((p, i) => {
    if (i > 0 && p !== null && !indexOfAsset.has(p.assetId)) indexOfAsset.set(p.assetId, i);
  });
  let nextIndex = palette.length;
  const paletteOps: MapOp[] = [];
  const keyIndex = new Map<PackKey, number | null>();
  const missing = new Set<PackKey>();
  const resolve = (key: PackKey): number | null => {
    const known = keyIndex.get(key);
    if (known !== undefined) return known;
    let asset = t.pack[key];
    if (asset === undefined && t.fallback !== undefined) {
      const fb = t.fallback(key);
      if (fb !== null) asset = t.pack[fb];
    }
    let index: number | null = null;
    if (asset === undefined) missing.add(key);
    else {
      index = indexOfAsset.get(asset.asset_id) ?? null;
      if (index === null) {
        if (nextIndex >= MAX_PALETTE) throw new Error(`Palette full (${MAX_PALETTE} entries)`);
        index = nextIndex++;
        indexOfAsset.set(asset.asset_id, index);
        paletteOps.push({ type: 'palette.add', index, asset_id: asset.asset_id });
      }
    }
    keyIndex.set(key, index);
    return index;
  };
  // Deterministic order: keys sorted, so palette indices do not depend on the cell order.
  const used = new Set<PackKey>();
  for (const l of LAYERS) for (const c of f[l]) used.add(c.key);
  for (const key of [...used].sort()) resolve(key);

  // ---- tiles ----
  const tileOps: MapOp[] = [];
  const tileInverse: MapOp[] = [];
  for (const layer of LAYERS) {
    const produced = new Map<number, GenCell>();
    for (const c of f[layer]) produced.set((c.y + off.y) * g.width + (c.x + off.x), c);
    const next: TileCell[] = [];
    const before: TileCell[] = [];
    let changed = false;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const c = produced.get(y * g.width + x);
        const idx = c === undefined ? null : (keyIndex.get(c.key) ?? null);
        const n: TileCell =
          c === undefined || idx === null
            ? [x, y, 0, 0, 0]
            : [x, y, idx, c.variant ?? 0, c.flags ?? 0];
        const old = t.view.getCell(layer, x, y);
        before.push([x, y, old.index, old.variant, old.flags]);
        next.push(n);
        if (old.index !== n[2] || old.variant !== n[3] || old.flags !== n[4]) changed = true;
      }
    }
    if (!changed) continue;
    tileOps.push(...chunked(t.floor, layer, next));
    tileInverse.push(...chunked(t.floor, layer, before));
  }

  // ---- objects ----
  const removed: MapObject[] = [];
  if (t.scene !== null && t.replace.objects !== 'none') {
    for (const o of t.scene.objects()) {
      if (t.replace.objects === 'all') removed.push(o);
      else {
        const [a, b, c, d] = bbox(o);
        if (
          a >= t.replace.tiles.x &&
          b >= t.replace.tiles.y &&
          c <= t.replace.tiles.x + t.replace.tiles.w &&
          d <= t.replace.tiles.y + t.replace.tiles.h
        ) {
          removed.push(o);
        }
      }
    }
  }
  const pt = (p: readonly [number, number]): Point => [round3(p[0] + off.x), round3(p[1] + off.y)];
  const base = (layer: 'walls' | 'lighting') => ({
    uid: newUid(),
    floor: t.floor,
    layer,
    visibility: 'all' as const,
    locked: false,
    sort_order: 0,
    rev: 1,
  });
  const added: MapObject[] = [];
  for (const w of f.walls) {
    const o: WallObject = {
      ...base('walls'),
      type: 'wall',
      geometry: { points: w.points.map(pt), closed: w.closed },
      props: {
        kind: w.kind,
        thickness: DEFAULT_OBJECT_SETTINGS.wallThickness,
        blocks_vision: true,
        blocks_light: true,
        blocks_move: true,
        texture_asset: null,
        height: null,
      },
    };
    added.push(o);
  }
  for (const d of f.doors) {
    const o: DoorObject = {
      ...base('walls'),
      type: 'door',
      geometry: { a: pt(d.a), b: pt(d.b) },
      props: {
        state: 'closed',
        locked: d.locked,
        secret: d.secret,
        asset_open: null,
        asset_closed: null,
        swing: d.swing,
      },
    };
    added.push(o);
  }
  for (const w of f.windows) {
    const o: WindowObject = {
      ...base('walls'),
      type: 'window',
      geometry: { a: pt(w.a), b: pt(w.b) },
      props: { kind: w.kind },
    };
    added.push(o);
  }
  for (const l of f.lights) {
    const p = LIGHT_PRESETS[l.preset];
    const o: LightObject = {
      ...base('lighting'),
      type: 'light',
      geometry: { x: round3(l.x + off.x), y: round3(l.y + off.y) },
      props: {
        radius: p.radius,
        dim_radius: p.dim_radius,
        color: p.color,
        intensity: p.intensity,
        flicker: { ...p.flicker },
        cone: null,
        enabled: true,
        follows_token: null,
      },
    };
    added.push(o);
  }

  const ops: MapOp[] = [
    ...removed.map((o): MapOp => ({ type: 'object.remove', uid: o.uid })),
    ...paletteOps,
    ...tileOps,
    ...added.map((o): MapOp => ({ type: 'object.add', object: o })),
  ];
  // palette.add has no inverse: an unused palette entry is harmless.
  const inverseOps: MapOp[] = [
    ...[...added].reverse().map((o): MapOp => ({ type: 'object.remove', uid: o.uid })),
    ...tileInverse,
    ...removed.map((o): MapOp => ({ type: 'object.add', object: o })),
  ];
  return {
    command: { label: 'editor.command.generate', ops, inverseOps },
    missing: [...missing].sort(),
  };
}
