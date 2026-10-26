/**
 * Entry point of the vision module (contract: ./types.ts; projet.md 13.4, 14.2). The engine and
 * the editor import from here only.
 *
 * - occluders.ts: walls split around doors / windows, joints welded and split, collinear
 *   segments merged, map border; spatial-grid.ts: 8-cell grid.
 * - visibility.ts: angular sweep, 64-gon circle clip, cones.
 * - core.ts: synchronous VisionCore with its polygon cache.
 * - service.ts + workers/vision.worker.ts: asynchronous VisionService with same-thread fallback.
 * - fog-raster.ts: fog rasterisers (scanline, 4×4 sub-cells, room flood fill).
 */
import { CHUNK_SIZE } from '../editor/contracts';
import { VisionCoreImpl } from './core';
import type { VisionCore } from './types';

export type * from './types';
export { fogRasterizers } from './fog-raster';
export { createVisionService, type VisionServiceOptions } from './service';
export { CIRCLE_SEGMENTS } from './visibility';
export { EPS as VISION_EPS, MIN_THICKNESS as WALL_MIN_THICKNESS } from './occluders';

/** Same-thread, synchronous core (worker, fallback, PNG export, tests). */
export function createVisionCore(): VisionCore {
  return new VisionCoreImpl();
}

/** Chunk size reminder for callers (32 cells, 128 sub-cells per side). */
export const FOG_CHUNK_CELLS = CHUNK_SIZE;
