/** Minimap maths (pure): projection between the reduced map and world cells. */

export interface MinimapGrid {
  readonly width: number;
  readonly height: number;
  readonly cellPx: number;
}

export interface MinimapCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface MinimapLayout {
  /** CSS pixels of the minimap. */
  readonly width: number;
  readonly height: number;
  /** Minimap pixels per cell. */
  readonly scale: number;
}

export interface MinimapRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Fits the whole map in a maxW x maxH box, keeping the aspect ratio. */
export function minimapLayout(grid: MinimapGrid, maxW: number, maxH: number): MinimapLayout {
  const gw = Math.max(1, grid.width);
  const gh = Math.max(1, grid.height);
  const scale = Math.min(Math.max(1, maxW) / gw, Math.max(1, maxH) / gh);
  return {
    width: Math.max(1, Math.round(gw * scale)),
    height: Math.max(1, Math.round(gh * scale)),
    scale,
  };
}

/** Rectangle of the current view on the minimap, clipped to the minimap. */
export function viewRect(
  camera: MinimapCamera,
  viewport: { readonly width: number; readonly height: number },
  grid: MinimapGrid,
  layout: MinimapLayout,
): MinimapRect {
  const cellScreen = Math.max(1e-6, grid.cellPx * camera.zoom);
  const w = (viewport.width / cellScreen) * layout.scale;
  const h = (viewport.height / cellScreen) * layout.scale;
  const x0 = camera.x * layout.scale - w / 2;
  const y0 = camera.y * layout.scale - h / 2;
  const x = Math.min(Math.max(x0, 0), layout.width);
  const y = Math.min(Math.max(y0, 0), layout.height);
  const x1 = Math.min(Math.max(x0 + w, 0), layout.width);
  const y1 = Math.min(Math.max(y0 + h, 0), layout.height);
  return { x, y, width: x1 - x, height: y1 - y };
}

/** Camera centre (cells) for a point of the minimap, clamped to the map. */
export function minimapPointToWorld(
  px: number,
  py: number,
  grid: MinimapGrid,
  layout: MinimapLayout,
): { x: number; y: number } {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  return {
    x: clamp(px / layout.scale, grid.width),
    y: clamp(py / layout.scale, grid.height),
  };
}
