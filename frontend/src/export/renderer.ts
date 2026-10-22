/**
 * Canvas 2D renderer of the export (OffscreenCanvas in the worker, or a canvas on the main
 * thread): background of the grid theme (unless transparent), tile layers bottom → top with
 * their opacity, then the grid. Draws any pixel region of the full export image, so the image
 * can be produced band by band (and column by column) with bounded memory.
 *
 * Why Canvas 2D and not Pixi on an OffscreenCanvas (projet.md 13.4, "à vérifier"): see job.ts.
 */
import { CHUNK_SIZE, type CellRect, type ChunkKey } from '../editor/contracts';
import { colorToCss } from '../engine/fallback-color';
import { gridTheme } from '../engine/grid-themes';
import { cellDraw, gridLinePlan, type GridLinePlan } from './cell-render';
import { outputSize } from './dimensions';
import type { TileImages } from './images';
import type { MapSnapshot } from './scene';

/** The subset of CanvasRenderingContext2D / OffscreenCanvasRenderingContext2D we use. */
export interface Ctx2D {
  globalAlpha: number;
  fillStyle: string | CanvasGradient | CanvasPattern;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
}

interface PreparedLayer {
  readonly opacity: number;
  readonly chunks: ReadonlyMap<ChunkKey, Uint16Array>;
}

/** Everything needed to draw the export image (prepared once per export). */
export class ExportScene {
  readonly width: number;
  readonly height: number;
  readonly background: string | null;
  private readonly layers: readonly PreparedLayer[];
  private readonly lines: GridLinePlan | null;

  constructor(
    snapshot: MapSnapshot,
    readonly extent: CellRect,
    readonly ppc: number,
    options: { readonly grid: boolean; readonly transparent: boolean },
    private readonly images: TileImages,
  ) {
    const size = outputSize(extent, ppc);
    this.width = size.width;
    this.height = size.height;
    const theme = gridTheme(snapshot.theme);
    this.background = options.transparent ? null : colorToCss(theme.background);
    this.layers = snapshot.layers
      .filter((l) => l.opacity > 0)
      .map((l) => ({ opacity: l.opacity, chunks: new Map(l.chunks) }));
    const grid = { ...snapshot.grid, unitLabel: '', unitPerCell: 1 };
    this.lines = options.grid ? gridLinePlan(extent, grid, ppc, theme) : null;
  }

  /**
   * Draws the image region whose top-left pixel is (x, y), `w` × `h` pixels, at (dx, dy) of the
   * context. The context area is not cleared (the caller does); drawing is clipped to the
   * region.
   */
  draw(ctx: Ctx2D, x: number, y: number, w: number, h: number, dx = 0, dy = 0): void {
    const ox = dx - x;
    const oy = dy - y;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(dx, dy, w, h);
    ctx.clip();
    ctx.globalAlpha = 1;
    if (this.background !== null) {
      ctx.fillStyle = this.background;
      ctx.fillRect(dx, dy, w, h);
    }
    ctx.imageSmoothingQuality = 'high';
    const { extent, ppc } = this;
    // Cells overlapping the region (one cell of margin for rounding).
    const c0 = Math.max(0, Math.floor(x / ppc) - 1);
    const c1 = Math.min(extent.w - 1, Math.floor((x + w) / ppc) + 1);
    const r0 = Math.max(0, Math.floor(y / ppc) - 1);
    const r1 = Math.min(extent.h - 1, Math.floor((y + h) / ppc) + 1);
    for (const layer of this.layers) {
      ctx.globalAlpha = layer.opacity;
      let lastKey = '';
      let cells: Uint16Array | undefined;
      for (let row = r0; row <= r1; row++) {
        const my = extent.y + row;
        for (let col = c0; col <= c1; col++) {
          const mx = extent.x + col;
          const key = `${Math.floor(mx / CHUNK_SIZE)}:${Math.floor(my / CHUNK_SIZE)}`;
          if (key !== lastKey) {
            lastKey = key;
            cells = layer.chunks.get(key as ChunkKey);
          }
          if (cells === undefined) continue;
          const i = ((my % CHUNK_SIZE) * CHUNK_SIZE + (mx % CHUNK_SIZE)) * 4;
          const index = cells[i]!;
          if (index === 0) continue;
          this.drawCell(ctx, col, row, index, cells[i + 1]!, cells[i + 2]!, ox, oy);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const lines = this.lines;
    if (lines !== null) {
      ctx.globalAlpha = lines.alpha;
      ctx.fillStyle = lines.color;
      // One rectangle per line, like the engine (crossings are blended twice there too).
      for (const lx of lines.xs) {
        if (lx + lines.thickness > x && lx < x + w) {
          ctx.fillRect(lx + ox, dy, lines.thickness, h);
        }
      }
      for (const ly of lines.ys) {
        if (ly + lines.thickness > y && ly < y + h) {
          ctx.fillRect(dx, ly + oy, w, lines.thickness);
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  private drawCell(
    ctx: Ctx2D,
    col: number,
    row: number,
    index: number,
    variant: number,
    flags: number,
    ox: number,
    oy: number,
  ): void {
    const d = cellDraw(col, row, this.ppc, flags);
    if (d.w <= 0 || d.h <= 0) return;
    const tile = this.images.tile(index, variant);
    ctx.imageSmoothingEnabled = tile.smooth;
    if (d.identity) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(tile.image, tile.sx, tile.sy, tile.sw, tile.sh, d.x + ox, d.y + oy, d.w, d.h);
      return;
    }
    const t = d.transform;
    ctx.setTransform(t.a, t.b, t.c, t.d, t.e + ox, t.f + oy);
    ctx.drawImage(tile.image, tile.sx, tile.sy, tile.sw, tile.sh, -d.dw / 2, -d.dh / 2, d.dw, d.dh);
  }
}
