/**
 * PNG export pipeline, independent of where it runs (export.worker.ts, or the main thread as a
 * fallback): plans the output files (one PNG, or one PNG per print page in a ZIP), renders each
 * file band by band (256 rows, split into columns on very wide images) with the Canvas 2D
 * renderer, and streams the rows through the PNG encoder (and the ZIP writer) to a byte sink.
 *
 * Rendering choice (projet.md 13.4/17 "Pixi sur OffscreenCanvas, à vérifier"): Canvas 2D on an
 * OffscreenCanvas. Pixi 8.22 can run in a worker (DOMAdapter.set(WebWorkerAdapter)), but it
 * would need a second GPU context in the worker (WebGPU / WebGL2 OffscreenCanvas support and
 * limits vary between Chromium, Firefox and WebKit), its eval-free mode and its texture loader
 * (whose worker path already breaks under connect-src 'self', engine/pixi.ts), GPU read-back of
 * every band, and ~200 KB more in the worker chunk. The P4 preview only draws tiles and the
 * grid, which Canvas 2D reproduces with the engine's own rules (cell-render.ts), at exact pixel
 * positions and with bounded memory. P5+ layers (lighting, fog) will need revisiting this.
 */
import type { DeflateStreamOptions, ByteSink } from '../formats/png-encoder';
import { PngEncoder } from '../formats/png-encoder';
import { ZipWriter } from '../formats/zip-writer';
import { outputSize } from './dimensions';
import type { TileImages } from './images';
import {
  cropMarks,
  layoutPages,
  pageFileName,
  pixelsPerMeter,
  type MarkRect,
  type PageLayout,
  type PageRect,
  type PrintError,
} from './print-layout';
import { ExportScene, type Ctx2D } from './renderer';
import type { ExportOptions, MapSnapshot, SnapshotPaletteEntry } from './scene';

/** Band height (projet.md 17). */
export const BAND_HEIGHT = 256;
/** Widest canvas used for one band; wider images are rendered in columns. */
export const MAX_SURFACE_WIDTH = 16_384;

export interface FilePlan {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly page: PageRect | null;
}

export interface ExportPlan {
  readonly kind: 'png' | 'zip';
  readonly fileName: string;
  readonly mime: string;
  readonly files: readonly FilePlan[];
  readonly layout: PageLayout | null;
  /** Band columns to render in total (progress unit). */
  readonly steps: number;
}

export interface BandTile {
  readonly y: number;
  readonly h: number;
  readonly x: number;
  readonly w: number;
}

/** Bands of BAND_HEIGHT rows, each cut into columns of at most `maxWidth` pixels. */
export function planBands(
  width: number,
  height: number,
  maxWidth = MAX_SURFACE_WIDTH,
): BandTile[][] {
  const bands: BandTile[][] = [];
  const columns = Math.max(1, Math.ceil(width / maxWidth));
  const colW = Math.ceil(width / columns);
  for (let y = 0; y < height; y += BAND_HEIGHT) {
    const h = Math.min(BAND_HEIGHT, height - y);
    const band: BandTile[] = [];
    for (let x = 0; x < width; x += colW) band.push({ y, h, x, w: Math.min(colW, width - x) });
    bands.push(band);
  }
  return bands;
}

export function planExport(
  options: ExportOptions,
  maxWidth = MAX_SURFACE_WIDTH,
): ExportPlan | PrintError {
  const { width, height } = outputSize(options.extent, options.pxPerCell);
  const print = options.print;
  if (print !== null && print.paging) {
    const layout = layoutPages(width, height, options.pxPerCell, print);
    if (typeof layout === 'string') return layout;
    const total = layout.pages.length;
    const files = layout.pages.map((page) => ({
      name: pageFileName(options.baseName, page.number, total),
      width: layout.pageWidth,
      height: layout.pageHeight,
      page,
    }));
    return {
      kind: 'zip',
      fileName: `${options.baseName}.zip`,
      mime: 'application/zip',
      files,
      layout,
      steps: files.reduce((n, f) => n + planBands(f.width, f.height, maxWidth).flat().length, 0),
    };
  }
  return {
    kind: 'png',
    fileName: `${options.baseName}.png`,
    mime: 'image/png',
    files: [{ name: `${options.baseName}.png`, width, height, page: null }],
    layout: null,
    steps: planBands(width, height, maxWidth).flat().length,
  };
}

/** A drawing surface of a fixed maximum size (OffscreenCanvas or canvas). */
export interface Surface {
  readonly ctx: Ctx2D;
  /** RGBA pixels (not premultiplied) of the top-left w × h area. */
  read(w: number, h: number): Uint8ClampedArray;
  release?(): void;
}

export interface ExportProgress {
  readonly done: number;
  readonly total: number;
}

export interface ExportDeps {
  readonly images: TileImages;
  readonly createSurface: (width: number, height: number) => Surface;
  readonly sink: ByteSink;
  readonly signal: AbortSignal;
  /** Called after each rendered band column (progress, output flush, yielding). */
  readonly onStep?: (progress: ExportProgress) => void | Promise<void>;
  readonly deflate?: DeflateStreamOptions;
  /** Widest surface (tests); default MAX_SURFACE_WIDTH. */
  readonly maxSurfaceWidth?: number;
}

export interface ExportResult {
  readonly files: number;
  readonly failed: readonly SnapshotPaletteEntry[];
}

function pngText(options: ExportOptions): { keyword: string; value: string }[] {
  const e = options.extent;
  const parts = [
    `scale=${+options.pxPerCell.toFixed(4)}px/cell`,
    `cells=${e.x},${e.y},${e.w}x${e.h}`,
    'seed=-',
  ];
  if (options.print !== null) parts.push(`print=${options.print.mmPerCell}mm/cell`);
  return [
    { keyword: 'Title', value: options.title },
    { keyword: 'Software', value: options.software },
    { keyword: 'Comment', value: parts.join('; ') },
  ];
}

export async function runExport(
  snapshot: MapSnapshot,
  options: ExportOptions,
  deps: ExportDeps,
): Promise<ExportResult> {
  const maxWidth = deps.maxSurfaceWidth ?? MAX_SURFACE_WIDTH;
  const plan = planExport(options, maxWidth);
  if (typeof plan === 'string') throw new Error(`Invalid print layout: ${plan}`);
  const scene = new ExportScene(snapshot, options.extent, options.pxPerCell, options, deps.images);
  const surfaceW = Math.min(maxWidth, Math.max(...plan.files.map((f) => f.width)));
  const surfaceH = Math.min(BAND_HEIGHT, Math.max(...plan.files.map((f) => f.height)));
  const surface = deps.createSurface(surfaceW, surfaceH);
  const ppm =
    options.print === null ? null : pixelsPerMeter(options.pxPerCell, options.print.mmPerCell);
  const marks =
    options.print?.cropMarks === true && plan.layout !== null
      ? (page: PageRect) =>
          cropMarks(plan.layout!, page, options.pxPerCell / options.print!.mmPerCell)
      : null;
  const text = pngText(options);
  const zip = plan.kind === 'zip' ? new ZipWriter(deps.sink, deps.deflate) : null;
  let done = 0;
  let encoder: PngEncoder | null = null;
  try {
    for (const file of plan.files) {
      deps.signal.throwIfAborted();
      const entry = zip === null ? null : await zip.open(file.name);
      const sink: ByteSink = entry === null ? deps.sink : (bytes) => entry.write(bytes);
      encoder = new PngEncoder(
        {
          width: file.width,
          height: file.height,
          alpha: options.transparent,
          pixelsPerMeter: ppm,
          text,
          ...(deps.deflate === undefined ? {} : { deflate: deps.deflate }),
        },
        sink,
      );
      await encoder.begin();
      for (const band of planBands(file.width, file.height, maxWidth)) {
        let rows: Uint8ClampedArray | null = null;
        for (const tile of band) {
          deps.signal.throwIfAborted();
          drawTile(surface.ctx, scene, tile, file, plan.layout, marks, options.transparent);
          const pixels = surface.read(tile.w, tile.h);
          if (band.length === 1) rows = pixels;
          else {
            rows ??= new Uint8ClampedArray(file.width * tile.h * 4);
            for (let r = 0; r < tile.h; r++) {
              rows.set(
                pixels.subarray(r * tile.w * 4, (r + 1) * tile.w * 4),
                (r * file.width + tile.x) * 4,
              );
            }
          }
          done++;
          if (tile !== band[band.length - 1]) await deps.onStep?.({ done, total: plan.steps });
        }
        await encoder.writeRows(rows!, band[0]!.h);
        await deps.onStep?.({ done, total: plan.steps });
      }
      await encoder.end();
      encoder = null;
      await entry?.close();
    }
    await zip?.finish();
    await deps.onStep?.({ done, total: plan.steps });
  } catch (error) {
    encoder?.abort(error);
    throw error;
  } finally {
    surface.release?.();
  }
  return { files: plan.files.length, failed: deps.images.failed };
}

/** Renders one band column of a file into the surface (top-left aligned). */
function drawTile(
  ctx: Ctx2D,
  scene: ExportScene,
  tile: BandTile,
  file: FilePlan,
  layout: PageLayout | null,
  marks: ((page: PageRect) => MarkRect[]) | null,
  transparent: boolean,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, tile.w, tile.h);
  const page = file.page;
  if (page === null || layout === null) {
    scene.draw(ctx, tile.x, tile.y, tile.w, tile.h);
    return;
  }
  if (!transparent) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tile.w, tile.h);
  }
  // Map part of the page: [m, m + srcW) × [m, m + srcH), intersected with the tile.
  const m = layout.margin;
  const x0 = Math.max(tile.x, m);
  const y0 = Math.max(tile.y, m);
  const x1 = Math.min(tile.x + tile.w, m + page.srcW);
  const y1 = Math.min(tile.y + tile.h, m + page.srcH);
  if (x1 > x0 && y1 > y0) {
    scene.draw(
      ctx,
      page.srcX + x0 - m,
      page.srcY + y0 - m,
      x1 - x0,
      y1 - y0,
      x0 - tile.x,
      y0 - tile.y,
    );
  }
  ctx.fillStyle = '#000000';
  for (const mark of marks?.(page) ?? []) {
    const mx0 = Math.max(mark.x, tile.x);
    const my0 = Math.max(mark.y, tile.y);
    const mx1 = Math.min(mark.x + mark.w, tile.x + tile.w);
    const my1 = Math.min(mark.y + mark.h, tile.y + tile.h);
    if (mx1 > mx0 && my1 > my0) ctx.fillRect(mx0 - tile.x, my0 - tile.y, mx1 - mx0, my1 - my0);
  }
}
