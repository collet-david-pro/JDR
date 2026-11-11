/**
 * Canvas 2D renderer of the export (OffscreenCanvas in the worker, or a canvas on the main
 * thread): background of the grid theme (unless transparent), tile layers bottom → top with
 * their opacity, then the P5 scene (objects, tokens, lighting, fog: scene-render.ts) when the
 * snapshot has one, then the grid (above everything, projet.md 14.1). Draws any pixel region of the full export image, so the image
 * can be produced band by band (and column by column) with bounded memory.
 *
 * Why Canvas 2D and not Pixi on an OffscreenCanvas (projet.md 13.4, "à vérifier"): see job.ts.
 */
import { CHUNK_SIZE, type CellRect, type ChunkKey } from '../editor/contracts';
import { colorToCss } from '../engine/fallback-color';
import { gridTheme } from '../engine/grid-themes';
import { gridStrokes } from '../engine/grid-lines';
import { edgeMask, edgeStrips, SIDE_E, SIDE_N, SIDE_S } from '../engine/soft-edges';
import { cellDraw, gridLinePlan, type GridLinePlan } from './cell-render';
import { outputSize } from './dimensions';
import type { TileImages, TokenImages } from './images';
import type { MapSnapshot } from './scene';
import { ScenePainter } from './scene-render';
import { DEFAULT_SCENE_CONTENT, type SceneContentOptions } from './scene-snapshot';

/** Optional inputs of the P5 scene layers. */
export interface ExportSceneExtras {
  readonly tokenImages?: TokenImages | null;
  /** Second surface for the lightmap (created on first use, at least one band large). */
  readonly lightSurface?: (() => Ctx2D) | null;
}

/** The subset of CanvasRenderingContext2D / OffscreenCanvasRenderingContext2D we use. */
export interface Ctx2D {
  /** The drawing surface (OffscreenCanvas / canvas): drawn back with drawImage. */
  readonly canvas: unknown;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
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
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
  ): void;
  clip(): void;
  fill(): void;
  stroke(): void;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
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
  private readonly painter: ScenePainter | null;
  private readonly transparent: boolean;
  private lightCtx: Ctx2D | null = null;

  constructor(
    snapshot: MapSnapshot,
    readonly extent: CellRect,
    readonly ppc: number,
    options: {
      readonly grid: boolean;
      readonly transparent: boolean;
      readonly scene?: SceneContentOptions;
    },
    private readonly images: TileImages,
    private readonly extras: ExportSceneExtras = {},
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
    this.transparent = options.transparent;
    this.painter =
      snapshot.scene == null
        ? null
        : new ScenePainter(
            snapshot.scene,
            extent,
            ppc,
            options.scene ?? DEFAULT_SCENE_CONTENT,
            extras.tokenImages ?? null,
          );
  }

  /** True when draw() needs the lightmap surface. */
  get needsLightSurface(): boolean {
    return this.painter?.drawLighting === true;
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
    if (this.painter !== null) {
      // P14: background images right after the theme background, under the tiles.
      this.painter.images(ctx, 'background', x, y, w, h, ox, oy);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    // Cells overlapping the region (one cell of margin for rounding).
    const c0 = Math.max(0, Math.floor(x / ppc) - 1);
    const c1 = Math.min(extent.w - 1, Math.floor((x + w) / ppc) + 1);
    const r0 = Math.max(0, Math.floor(y / ppc) - 1);
    const r1 = Math.min(extent.h - 1, Math.floor((y + h) / ppc) + 1);
    const softOf = this.images.soft?.bind(this.images);
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
          this.drawCell(ctx, col, row, index, cells[i + 1]!, cells[i + 2]!, ox, oy, mx, my);
          if (softOf !== undefined && softOf(index)) {
            this.drawSoftEdges(ctx, layer, col, row, index, mx, my, ox, oy, softOf);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    const painter = this.painter;
    if (painter !== null) {
      painter.objects(ctx, x, y, w, h, ox, oy);
      painter.images(ctx, 'above', x, y, w, h, ox, oy);
      painter.tokens(ctx, x, y, w, h, ox, oy);
      if (painter.drawLighting) {
        this.lightCtx ??= this.extras.lightSurface?.() ?? null;
        if (this.lightCtx !== null) {
          painter.lighting(ctx, this.lightCtx, x, y, w, h, dx, dy, this.transparent);
        }
      }
      painter.fogLayer(ctx, x, y, w, h, ox, oy);
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const lines = this.lines;
    if (lines !== null) {
      ctx.globalAlpha = lines.alpha;
      ctx.fillStyle = lines.color;
      // Same rectangles as the engine (crossings are blended twice there too); image coordinates.
      const strokes = gridStrokes({
        style: lines.style,
        xs: lines.xs,
        ys: lines.ys,
        xStart: lines.xStart,
        yStart: lines.yStart,
        th: lines.thickness,
        clip: { x, y, w, h },
        major: lines.major,
      });
      for (const r of strokes.base) ctx.fillRect(r.x + ox, r.y + oy, r.w, r.h);
      if (strokes.strong.length > 0) {
        ctx.globalAlpha = Math.min(1, (lines.alpha / 1) * 1.8);
        for (const r of strokes.strong) ctx.fillRect(r.x + ox, r.y + oy, r.w, r.h);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** Soft edges (l14): strips of the neighbours' images with a decreasing opacity. */
  private drawSoftEdges(
    ctx: Ctx2D,
    layer: PreparedLayer,
    col: number,
    row: number,
    index: number,
    mx: number,
    my: number,
    ox: number,
    oy: number,
    soft: (index: number) => boolean,
  ): void {
    const at = (x: number, y: number): number => {
      if (x < 0 || y < 0) return 0;
      const cells = layer.chunks.get(
        `${Math.floor(x / CHUNK_SIZE)}:${Math.floor(y / CHUNK_SIZE)}` as ChunkKey,
      );
      return cells === undefined
        ? 0
        : (cells[((y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)) * 4] ?? 0);
    };
    const north = at(mx, my - 1);
    const east = at(mx + 1, my);
    const south = at(mx, my + 1);
    const west = at(mx - 1, my);
    const mask = edgeMask(index, north, east, south, west, soft);
    if (mask === 0) return;
    const ppc = this.ppc;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const strip of edgeStrips(mask)) {
      const n =
        strip.side === SIDE_N
          ? north
          : strip.side === SIDE_E
            ? east
            : strip.side === SIDE_S
              ? south
              : west;
      const tile = this.images.tile(n, 0, mx, my);
      ctx.imageSmoothingEnabled = tile.smooth;
      ctx.globalAlpha = layer.opacity * strip.alpha;
      ctx.drawImage(
        tile.image,
        tile.sx + strip.x * tile.sw,
        tile.sy + strip.y * tile.sh,
        strip.w * tile.sw,
        strip.h * tile.sh,
        (col + strip.x) * ppc + ox,
        (row + strip.y) * ppc + oy,
        strip.w * ppc,
        strip.h * ppc,
      );
    }
    ctx.globalAlpha = layer.opacity;
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
    mx: number,
    my: number,
  ): void {
    // World-aligned textures (P14) ignore the rotation / variant of the cell.
    if (this.images.worldAligned?.(index)) {
      variant = 0;
      flags = 0;
    }
    const d = cellDraw(col, row, this.ppc, flags);
    if (d.w <= 0 || d.h <= 0) return;
    const tile = this.images.tile(index, variant, mx, my);
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
