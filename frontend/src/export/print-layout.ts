/**
 * Print mode (projet.md 17, 2.8): 1 cell = N mm gives the PNG density (pHYs); optional split
 * into pages (A4 / A3 / Letter, portrait / landscape, margins, 5 mm overlap, crop marks), one PNG
 * per page (`name_p01.png`…) in a ZIP. Pure functions.
 *
 * Each page PNG is the whole sheet at the print density, so printing it at 100 % (actual size)
 * gives exactly N mm per cell: the map part sits inside the margins, crop marks in the margins.
 */

export type PaperId = 'a4' | 'a3' | 'letter';
export type Orientation = 'portrait' | 'landscape';

/** Portrait sizes in millimetres. */
export const PAPERS: Readonly<Record<PaperId, { readonly w: number; readonly h: number }>> =
  Object.freeze({
    a4: { w: 210, h: 297 },
    a3: { w: 297, h: 420 },
    letter: { w: 215.9, h: 279.4 },
  });

export const PAPER_IDS: readonly PaperId[] = ['a4', 'a3', 'letter'];

export interface PrintOptions {
  /** Millimetres per cell on paper. */
  readonly mmPerCell: number;
  /** Split into pages (else one PNG with the density only). */
  readonly paging: boolean;
  readonly paper: PaperId;
  readonly orientation: Orientation;
  readonly marginMm: number;
  readonly overlapMm: number;
  readonly cropMarks: boolean;
}

export const DEFAULT_PRINT: PrintOptions = Object.freeze({
  mmPerCell: 25,
  paging: true,
  paper: 'a4',
  orientation: 'portrait',
  marginMm: 10,
  overlapMm: 5,
  cropMarks: true,
});

export const PRINT_LIMITS = Object.freeze({
  minMmPerCell: 1,
  maxMmPerCell: 500,
  maxMarginMm: 50,
  maxPages: 999,
});

/** pHYs density: px/m = px_per_cell / (mm_per_cell / 1000). */
export function pixelsPerMeter(pxPerCell: number, mmPerCell: number): number {
  return Math.round(pxPerCell / (mmPerCell / 1000));
}

/** Print resolution in dots per inch (for display). */
export function dpi(pxPerCell: number, mmPerCell: number): number {
  return (pxPerCell / mmPerCell) * 25.4;
}

export interface PageRect {
  /** 1-based page number (row-major). */
  readonly number: number;
  readonly col: number;
  readonly row: number;
  /** Part of the full image shown on this page (image pixels). */
  readonly srcX: number;
  readonly srcY: number;
  readonly srcW: number;
  readonly srcH: number;
}

export interface PageLayout {
  readonly pageWidth: number;
  readonly pageHeight: number;
  /** Margin in pixels (the map part starts at (margin, margin)). */
  readonly margin: number;
  readonly printableWidth: number;
  readonly printableHeight: number;
  readonly overlap: number;
  readonly columns: number;
  readonly rows: number;
  readonly pages: readonly PageRect[];
}

export type PrintError = 'invalid' | 'margins' | 'too_many_pages';

function count(total: number, printable: number, step: number): number {
  return total <= printable ? 1 : 1 + Math.ceil((total - printable) / step);
}

/** Page grid for an image of `imageW` × `imageH` pixels at `pxPerCell`. */
export function layoutPages(
  imageW: number,
  imageH: number,
  pxPerCell: number,
  print: PrintOptions,
): PageLayout | PrintError {
  if (
    !(
      print.mmPerCell >= PRINT_LIMITS.minMmPerCell && print.mmPerCell <= PRINT_LIMITS.maxMmPerCell
    ) ||
    !(print.marginMm >= 0 && print.marginMm <= PRINT_LIMITS.maxMarginMm) ||
    !(print.overlapMm >= 0) ||
    !(pxPerCell > 0)
  ) {
    return 'invalid';
  }
  const pxPerMm = pxPerCell / print.mmPerCell;
  const paper = PAPERS[print.paper];
  const landscape = print.orientation === 'landscape';
  const wMm = landscape ? paper.h : paper.w;
  const hMm = landscape ? paper.w : paper.h;
  const pageWidth = Math.round(wMm * pxPerMm);
  const pageHeight = Math.round(hMm * pxPerMm);
  const margin = Math.round(print.marginMm * pxPerMm);
  const overlap = Math.round(print.overlapMm * pxPerMm);
  const printableWidth = pageWidth - 2 * margin;
  const printableHeight = pageHeight - 2 * margin;
  if (printableWidth - overlap < 1 || printableHeight - overlap < 1) return 'margins';
  const stepX = printableWidth - overlap;
  const stepY = printableHeight - overlap;
  const columns = count(imageW, printableWidth, stepX);
  const rows = count(imageH, printableHeight, stepY);
  if (columns * rows > PRINT_LIMITS.maxPages) return 'too_many_pages';
  const pages: PageRect[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const srcX = col * stepX;
      const srcY = row * stepY;
      pages.push({
        number: pages.length + 1,
        col,
        row,
        srcX,
        srcY,
        srcW: Math.min(printableWidth, imageW - srcX),
        srcH: Math.min(printableHeight, imageH - srcY),
      });
    }
  }
  return {
    pageWidth,
    pageHeight,
    margin,
    printableWidth,
    printableHeight,
    overlap,
    columns,
    rows,
    pages,
  };
}

export interface MarkRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Crop marks of a page: at each corner of the map part, two short lines in the margin along
 * its edges (gap of 1 mm from the corner, at most 5 mm long, 0.25 mm thick, ≥ 1 px).
 */
export function cropMarks(layout: PageLayout, page: PageRect, pxPerMm: number): MarkRect[] {
  const m = layout.margin;
  const gap = Math.max(1, Math.round(pxPerMm));
  const len = Math.min(Math.round(5 * pxPerMm), m - gap);
  if (len < 1) return [];
  const t = Math.max(1, Math.round(0.25 * pxPerMm));
  const x0 = m;
  const y0 = m;
  const x1 = m + page.srcW;
  const y1 = m + page.srcH;
  const marks: MarkRect[] = [];
  for (const x of [x0, x1]) {
    // Vertical marks above and below, aligned on the vertical edge.
    marks.push({ x: x - (x === x1 ? t : 0), y: y0 - gap - len, w: t, h: len });
    marks.push({ x: x - (x === x1 ? t : 0), y: y1 + gap, w: t, h: len });
  }
  for (const y of [y0, y1]) {
    marks.push({ x: x0 - gap - len, y: y - (y === y1 ? t : 0), w: len, h: t });
    marks.push({ x: x1 + gap, y: y - (y === y1 ? t : 0), w: len, h: t });
  }
  return marks;
}

/** `name_p01.png` (2 digits, 3 beyond 99 pages). */
export function pageFileName(base: string, number: number, total: number): string {
  const digits = total > 99 ? 3 : 2;
  return `${base}_p${String(number).padStart(digits, '0')}.png`;
}
