/**
 * Fog gestures of the GM console as session actions (`fog.reveal` / `fog.hide`, blocks of
 * 32×32 cells, ≤ 200 per action). Same rasterizers and wire format as the editor fog tool
 * (editor/tools/fog.ts, editor/model/fog-wire.ts); only the bits that change the fog shown
 * by the scene are sent.
 */
import type { ChunkKey, FogBitmap, Point } from '../../../editor/contracts';
import { effectiveFog, fogOps, mergeFog, type FogOpType } from '../../../editor/model/fog-wire';
import { fogRasterizers } from '../../../vision/index';
import type { SessionAction } from '../types';

export type FogAction = Extract<SessionAction, { type: 'fog.reveal' | 'fog.hide' }>;

export interface FogGrid {
  readonly floor: string;
  readonly width: number;
  readonly height: number;
  /** Fog bitmap currently shown for a block. */
  readonly fogChunk: (key: ChunkKey) => FogBitmap | null;
}

/** Actions carrying only the bits of `raster` that change the current fog. */
export function fogActionsFor(
  type: FogOpType,
  grid: FogGrid,
  raster: ReadonlyMap<ChunkKey, FogBitmap>,
): FogAction[] {
  const changes = effectiveFog(type, raster, grid.fogChunk);
  return fogOps(type, grid.floor, changes).flatMap((op) =>
    op.type === 'fog.reveal' || op.type === 'fog.hide'
      ? [{ type: op.type, floor: op.floor, chunks: op.chunks }]
      : [],
  );
}

/** Discs along the segment `from` ⇒ `to` (a disc every half radius). */
export function brushRaster(
  grid: Pick<FogGrid, 'width' | 'height'>,
  from: Point,
  to: Point,
  radius: number,
): Map<ChunkKey, FogBitmap> {
  const out = new Map<ChunkKey, FogBitmap>();
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(1, Math.ceil(d / (radius / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from[0] + (to[0] - from[0]) * t;
    const y = from[1] + (to[1] - from[1]) * t;
    mergeFog(out, fogRasterizers.disc(x, y, radius, grid.width, grid.height));
  }
  return out;
}

/** Rectangle between two points (cells, float). */
export function rectRaster(
  grid: Pick<FogGrid, 'width' | 'height'>,
  a: Point,
  b: Point,
): Map<ChunkKey, FogBitmap> | null {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  const w = Math.abs(b[0] - a[0]);
  const h = Math.abs(b[1] - a[1]);
  if (w <= 0 || h <= 0) return null;
  return new Map(fogRasterizers.rect(x, y, w, h, grid.width, grid.height));
}
