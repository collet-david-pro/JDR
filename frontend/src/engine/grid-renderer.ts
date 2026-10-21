/**
 * Map background (world space) and square grid + map border (screen space, constant
 * thickness, redrawn when the camera changes; a few hundred rectangles at most).
 */

import type { CameraState, GridSpec, GridTheme } from '../editor/contracts';
import type { Viewport } from './camera';
import { GRID_BORDER_PX, GRID_LINE_PX, computeGridLines, mapScreenRect, snap } from './grid-lines';
import { DEFAULT_GRID_THEME, gridTheme, type GridThemeDef } from './grid-themes';
import { Graphics } from './pixi';

export class GridRenderer {
  /** World space, under the tiles. */
  readonly background = new Graphics();
  /** Screen space, above the tiles. */
  readonly lines = new Graphics();
  readonly border = new Graphics();

  private themeDef: GridThemeDef = gridTheme(DEFAULT_GRID_THEME);
  private visible = true;

  get theme(): GridThemeDef {
    return this.themeDef;
  }

  setTheme(theme: GridTheme): void {
    this.themeDef = gridTheme(theme);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.lines.visible = visible;
  }

  drawBackground(grid: GridSpec | null): void {
    const g = this.background;
    g.clear();
    if (grid === null || grid.width <= 0 || grid.height <= 0) return;
    g.rect(0, 0, grid.width * grid.cellPx, grid.height * grid.cellPx).fill({
      color: this.themeDef.background,
    });
  }

  drawScreen(camera: CameraState, viewport: Viewport, grid: GridSpec | null, dpr: number): void {
    this.lines.clear();
    this.border.clear();
    if (grid === null || grid.width <= 0 || grid.height <= 0) return;
    const t = this.themeDef;

    if (this.visible) {
      const gl = computeGridLines(camera, viewport, grid, dpr);
      if (gl.clip !== null && gl.fade > 0 && (gl.xs.length > 0 || gl.ys.length > 0)) {
        const th = Math.max(1 / dpr, snap(GRID_LINE_PX, dpr));
        const half = snap(th / 2, dpr);
        for (const x of gl.xs) this.lines.rect(x - half, gl.clip.y, th, gl.clip.h);
        for (const y of gl.ys) this.lines.rect(gl.clip.x, y - half, gl.clip.w, th);
        this.lines.fill({ color: t.line, alpha: t.lineAlpha * gl.fade });
      }
    }

    // Border just outside the map, always visible (also when the grid is hidden).
    const r = mapScreenRect(camera, viewport, grid);
    const bw = Math.max(1 / dpr, snap(GRID_BORDER_PX, dpr));
    const x0 = snap(r.x, dpr);
    const y0 = snap(r.y, dpr);
    const x1 = snap(r.x + r.w, dpr);
    const y1 = snap(r.y + r.h, dpr);
    this.border
      .rect(x0 - bw, y0 - bw, x1 - x0 + 2 * bw, bw)
      .rect(x0 - bw, y1, x1 - x0 + 2 * bw, bw)
      .rect(x0 - bw, y0, bw, y1 - y0)
      .rect(x1, y0, bw, y1 - y0)
      .fill({ color: t.border, alpha: t.borderAlpha });
  }

  destroy(): void {
    this.background.destroy();
    this.lines.destroy();
    this.border.destroy();
  }
}
