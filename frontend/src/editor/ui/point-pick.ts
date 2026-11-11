/** Arrival point picked with the mouse on the preview of a map (pure). */
export interface PreviewBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Cell position under a pointer on a preview that covers the whole map, rounded to `step` cells and
 * clamped to the map. Null for an empty preview or a map without size.
 */
export function pickPoint(
  box: PreviewBox,
  clientX: number,
  clientY: number,
  grid: { readonly width: number; readonly height: number },
  step = 0.5,
): [number, number] | null {
  if (box.width <= 0 || box.height <= 0 || grid.width <= 0 || grid.height <= 0) return null;
  const q = (v: number, max: number): number =>
    Math.min(max, Math.max(0, Math.round(v / step) * step));
  const x = ((clientX - box.left) / box.width) * grid.width;
  const y = ((clientY - box.top) / box.height) * grid.height;
  return [q(x, grid.width), q(y, grid.height)];
}
