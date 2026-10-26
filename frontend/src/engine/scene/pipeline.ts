/**
 * Render pipeline order (projet.md 14.1, bottom → top). The engine builds its stage from this
 * list; world-space layers share the camera transform, screen-space ones are drawn in CSS px.
 */

export const RENDER_PIPELINE = [
  /** 1. Map background (theme colour), world space. */
  'background',
  /** 2-4. Tile layers ground / terrain / decor (chunk cache), world space. */
  'tiles',
  /** 5. Cast shadows (option), screen-space render texture. */
  'shadows',
  /** 6. Objects: walls, doors, windows (by object layer), world space. */
  'objects',
  /** 7. Placed tokens, world space. */
  'tokens',
  /** 8. Lightmap × ambient (multiply), screen-space render texture. */
  'lighting',
  /** 9. Fog: GM veil (world space) or player mask (multiply, screen-space render texture). */
  'fog',
  /** 11. Grid lines and map border, screen space. */
  'grid',
  'border',
  /** GM light gizmos, screen space (above the lighting so they stay readable). */
  'gizmos',
  /** 12. Edit overlay, screen space. */
  'overlay',
] as const;

export type PipelineLayer = (typeof RENDER_PIPELINE)[number];

/** Layers whose content is drawn in world coordinates (camera transform applied). */
export const WORLD_LAYERS: ReadonlySet<PipelineLayer> = new Set([
  'background',
  'tiles',
  'objects',
  'tokens',
  'fog',
]);

export function pipelineIndex(layer: PipelineLayer): number {
  return RENDER_PIPELINE.indexOf(layer);
}
