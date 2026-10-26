/**
 * PNG export dialog model (pure): form values (strings for the number inputs) ⇒ extent, live
 * size, print layout, missing assets and the final ExportOptions.
 */
import type { CellRect, TileLayerId } from '../editor/contracts';
import {
  RESOLUTION_FACTORS,
  resolveExtent,
  safeFileName,
  sizeReport,
  type ExtentKind,
  type ResolutionMode,
  type SizeReport,
} from './dimensions';
import {
  DEFAULT_PRINT,
  layoutPages,
  type Orientation,
  type PageLayout,
  type PaperId,
  type PrintError,
  type PrintOptions,
} from './print-layout';
import {
  TILE_LAYERS,
  defaultLayers,
  missingAssets,
  type ExportOptions,
  type MissingAsset,
} from './scene';
import { DEFAULT_SCENE_CONTENT } from './scene-snapshot';
import type { ExportSource } from './types';

export interface ExportForm {
  extent: ExtentKind;
  layers: Record<TileLayerId, boolean>;
  grid: boolean;
  transparent: boolean;
  /** P5 scene content (only used when the source has a scene). */
  tokens: boolean;
  lighting: boolean;
  fog: boolean;
  mode: ResolutionMode;
  factor: string;
  cellPx: string;
  width: string;
  height: string;
  scale: string;
  print: boolean;
  mmPerCell: string;
  paging: boolean;
  paper: PaperId;
  orientation: Orientation;
  marginMm: string;
  overlapMm: string;
  cropMarks: boolean;
}

export const SOFTWARE = 'JDR';

/** Decimal input ("12,5" accepted); NaN when empty or invalid. */
export function parseNumber(value: string): number {
  const v = value.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(v)) return Number.NaN;
  return Number(v);
}

export function defaultForm(source: ExportSource): ExportForm {
  const visible = new Set(defaultLayers(source.view));
  const layers = Object.fromEntries(TILE_LAYERS.map((id) => [id, visible.has(id)])) as Record<
    TileLayerId,
    boolean
  >;
  const cellPx = source.view.grid.cellPx;
  return {
    extent: source.selection !== null ? 'selection' : 'map',
    layers,
    grid: true,
    transparent: false,
    tokens: DEFAULT_SCENE_CONTENT.tokens,
    lighting: DEFAULT_SCENE_CONTENT.lighting,
    fog: DEFAULT_SCENE_CONTENT.fog,
    mode: 'factor',
    factor: '1',
    cellPx: String(cellPx),
    width: String(source.view.grid.width * cellPx),
    height: String(source.view.grid.height * cellPx),
    scale: '1',
    print: false,
    mmPerCell: String(DEFAULT_PRINT.mmPerCell),
    paging: DEFAULT_PRINT.paging,
    paper: DEFAULT_PRINT.paper,
    orientation: DEFAULT_PRINT.orientation,
    marginMm: String(DEFAULT_PRINT.marginMm),
    overlapMm: String(DEFAULT_PRINT.overlapMm),
    cropMarks: DEFAULT_PRINT.cropMarks,
  };
}

export type FormError =
  | 'no_extent'
  | 'no_layers'
  | 'size_invalid'
  | 'size_too_small'
  | 'size_too_large'
  | 'size_png_limit'
  | 'print_invalid'
  | 'print_margins'
  | 'print_too_many_pages';

export interface FormEvaluation {
  readonly extent: CellRect | null;
  readonly layers: readonly TileLayerId[];
  /** The source has a P5 scene (objects, tokens, lighting, fog options shown). */
  readonly hasScene: boolean;
  readonly size: SizeReport | null;
  readonly print: PrintOptions | null;
  readonly layout: PageLayout | null;
  readonly errors: readonly FormError[];
  readonly missing: readonly MissingAsset[];
  readonly fileName: string;
  readonly mime: string;
  /** Null while the form has errors. */
  readonly options: ExportOptions | null;
}

export function evaluateForm(form: ExportForm, source: ExportSource): FormEvaluation {
  const view = source.view;
  const errors: FormError[] = [];
  const extent = resolveExtent(form.extent, view.grid, source.selection, source.viewport);
  if (extent === null) errors.push('no_extent');
  const order = view.layers.map((l) => l.id);
  const layers = TILE_LAYERS.filter((id) => form.layers[id]).sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
  );
  const hasScene = source.scene != null;
  if (layers.length === 0 && !form.grid && !hasScene) errors.push('no_layers');

  const factor = Number(form.factor);
  const size =
    extent === null
      ? null
      : sizeReport(
          {
            mode: form.mode,
            factor: RESOLUTION_FACTORS.includes(factor) ? factor : Number.NaN,
            cellPx: parseNumber(form.cellPx),
            width: parseNumber(form.width),
            height: parseNumber(form.height),
            scale: parseNumber(form.scale),
          },
          extent,
          view.grid.cellPx,
        );
  if (size?.error) errors.push(`size_${size.error}` as FormError);

  let print: PrintOptions | null = null;
  let layout: PageLayout | null = null;
  if (form.print) {
    print = {
      mmPerCell: parseNumber(form.mmPerCell),
      paging: form.paging,
      paper: form.paper,
      orientation: form.orientation,
      marginMm: parseNumber(form.marginMm),
      overlapMm: parseNumber(form.overlapMm),
      cropMarks: form.cropMarks,
    };
    if (size !== null && size.error === null) {
      const result: PageLayout | PrintError = layoutPages(
        size.width,
        size.height,
        size.pxPerCell,
        print,
      );
      if (typeof result === 'string') errors.push(`print_${result}`);
      else if (print.paging) layout = result;
    }
  }

  const base = safeFileName(source.name);
  const zip = print !== null && print.paging;
  const missing = extent === null ? [] : missingAssets(view, extent, layers);
  const options: ExportOptions | null =
    errors.length === 0 && extent !== null && size !== null
      ? {
          extent,
          pxPerCell: size.pxPerCell,
          grid: form.grid,
          transparent: form.transparent,
          print,
          baseName: base,
          title: source.name,
          software: SOFTWARE,
          ...(hasScene
            ? { scene: { tokens: form.tokens, lighting: form.lighting, fog: form.fog } }
            : {}),
        }
      : null;
  return {
    extent,
    layers,
    hasScene,
    size,
    print,
    layout,
    errors,
    missing,
    fileName: `${base}.${zip ? 'zip' : 'png'}`,
    mime: zip ? 'application/zip' : 'image/png',
    options,
  };
}
