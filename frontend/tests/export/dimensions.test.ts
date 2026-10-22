import { describe, expect, it } from 'vitest';
import {
  EXPORT_LIMITS,
  clampToMap,
  outputSize,
  resolveExtent,
  safeFileName,
  sizeReport,
  type ResolutionInput,
} from '../../src/export/dimensions';
import {
  DEFAULT_PRINT,
  cropMarks,
  dpi,
  layoutPages,
  pageFileName,
  pixelsPerMeter,
  type PageLayout,
} from '../../src/export/print-layout';
import { BAND_HEIGHT, MAX_SURFACE_WIDTH, planBands, planExport } from '../../src/export/job';
import type { ExportOptions } from '../../src/export/scene';

const grid = { width: 40, height: 30, cellPx: 70, unitLabel: 'ft', unitPerCell: 5 };
const res = (over: Partial<ResolutionInput>): ResolutionInput => ({
  mode: 'factor',
  factor: 1,
  cellPx: 70,
  width: 1000,
  height: 1000,
  scale: 1,
  ...over,
});

describe('extent', () => {
  it('resolves map, selection and view, clamped to the map', () => {
    expect(resolveExtent('map', grid, null, null)).toEqual({ x: 0, y: 0, w: 40, h: 30 });
    expect(resolveExtent('selection', grid, null, null)).toBeNull();
    expect(resolveExtent('selection', grid, { x: 38, y: -2, w: 5, h: 4 }, null)).toEqual({
      x: 38,
      y: 0,
      w: 2,
      h: 2,
    });
    // Fractional viewport: whole cells covering it.
    expect(resolveExtent('view', grid, null, { x: 2.5, y: 3.2, w: 10, h: 5 })).toEqual({
      x: 2,
      y: 3,
      w: 11,
      h: 6,
    });
    expect(clampToMap({ x: 50, y: 0, w: 3, h: 3 }, grid)).toBeNull();
  });
});

describe('sizeReport', () => {
  const map = { x: 0, y: 0, w: 40, h: 30 };
  it('×1 / ×2 / ×4 give cells × cell_px × factor', () => {
    for (const factor of [1, 2, 4]) {
      const r = sizeReport(res({ factor }), map, 70);
      expect([r.width, r.height]).toEqual([40 * 70 * factor, 30 * 70 * factor]);
      expect(r.error).toBeNull();
    }
  });

  it('px per cell, target width / height, custom scale', () => {
    expect(sizeReport(res({ mode: 'cell', cellPx: 25 }), map, 70)).toMatchObject({
      width: 1000,
      height: 750,
    });
    const w = sizeReport(res({ mode: 'width', width: 8000 }), { x: 0, y: 0, w: 100, h: 100 }, 70);
    expect([w.width, w.height, w.pxPerCell]).toEqual([8000, 8000, 80]);
    // Non-integer px per cell: rounded edges, exact target width.
    const odd = sizeReport(res({ mode: 'width', width: 1000 }), { x: 0, y: 0, w: 37, h: 11 }, 70);
    expect(odd.width).toBe(1000);
    expect(odd.height).toBe(Math.round((11 * 1000) / 37));
    const h = sizeReport(res({ mode: 'height', height: 600 }), map, 70);
    expect([h.width, h.height]).toEqual([800, 600]);
    expect(sizeReport(res({ mode: 'custom', scale: 1.5 }), map, 70)).toMatchObject({
      width: 4200,
      height: 3150,
    });
    expect(sizeReport(res({ mode: 'custom', scale: 0 }), map, 70).error).toBe('invalid');
  });

  it('warns from 100 Mpx, refuses beyond 400 Mpx, flags sides > 65 535', () => {
    const big = { x: 0, y: 0, w: 400, h: 400 };
    // 400 × 25 = 10 000 px → 100 Mpx exactly: warning.
    const warn = sizeReport(res({ mode: 'cell', cellPx: 25 }), big, 70);
    expect(warn.megapixels).toBe(100);
    expect(warn.warnings).toEqual(['large']);
    expect(warn.error).toBeNull();
    expect(sizeReport(res({ mode: 'cell', cellPx: 50 }), big, 70).error).toBeNull();
    expect(sizeReport(res({ mode: 'cell', cellPx: 51 }), big, 70).error).toBe('too_large');
    expect(sizeReport(res({ mode: 'cell', cellPx: 51 }), big, 70, 1000).error).toBeNull();
    const wide = sizeReport(res({ mode: 'cell', cellPx: 200 }), { x: 0, y: 0, w: 400, h: 1 }, 70);
    expect(wide.warnings).toContain('viewer_limit');
    expect(sizeReport(res({ mode: 'cell', cellPx: 0.5 }), map, 70).error).toBe('too_small');
    expect(sizeReport(res({ mode: 'width', width: Number.NaN }), map, 70).error).toBe('invalid');
    expect(EXPORT_LIMITS.maxMegapixels).toBe(400);
  });

  it('outputSize matches the rounded cell edges', () => {
    expect(outputSize({ x: 3, y: 4, w: 7, h: 3 }, 10.4)).toEqual({ width: 73, height: 31 });
  });

  it('safeFileName strips separators and control characters', () => {
    expect(safeFileName('Crypte / niveau: 2 ')).toBe('Crypte _ niveau_ 2');
    expect(safeFileName('..\u0001')).toBe('_');
    expect(safeFileName('   ')).toBe('map');
  });
});

describe('print layout', () => {
  it('pHYs density and dpi', () => {
    expect(pixelsPerMeter(70, 25)).toBe(2800);
    expect(pixelsPerMeter(100, 25.4)).toBe(3937);
    expect(dpi(100, 25.4)).toBeCloseTo(100);
  });

  it('splits an image into A4 pages with margins and a 5 mm overlap', () => {
    // 4 px per mm: A4 portrait = 840 × 1188 px, margin 40, printable 760 × 1108, overlap 20.
    const l = layoutPages(2000, 1500, 100, { ...DEFAULT_PRINT, mmPerCell: 25 }) as PageLayout;
    expect([l.pageWidth, l.pageHeight, l.margin, l.overlap]).toEqual([840, 1188, 40, 20]);
    expect([l.columns, l.rows]).toEqual([3, 2]);
    expect(l.pages).toHaveLength(6);
    const last = l.pages[5]!;
    expect([last.srcX, last.srcY]).toEqual([2 * 740, 1088]);
    expect([last.srcW, last.srcH]).toEqual([2000 - 1480, 1500 - 1088]);
    // Every image column / row is covered.
    for (const p of l.pages) {
      expect(p.srcW).toBeGreaterThan(0);
      expect(p.srcX + p.srcW).toBeLessThanOrEqual(2000);
    }
    expect(Math.max(...l.pages.map((p) => p.srcX + p.srcW))).toBe(2000);
  });

  it('landscape swaps the sheet; one page when it fits; bad margins refused', () => {
    const l = layoutPages(1000, 700, 100, {
      ...DEFAULT_PRINT,
      orientation: 'landscape',
    }) as PageLayout;
    expect([l.pageWidth, l.pageHeight, l.pages.length]).toEqual([1188, 840, 1]);
    expect(layoutPages(100, 100, 100, { ...DEFAULT_PRINT, marginMm: 50, paper: 'a4' })).not.toBe(
      'margins',
    );
    expect(layoutPages(100, 100, 100, { ...DEFAULT_PRINT, mmPerCell: 0 })).toBe('invalid');
    expect(layoutPages(1e6, 1e6, 100, DEFAULT_PRINT)).toBe('too_many_pages');
  });

  it('crop marks stay in the margins of the sheet', () => {
    const l = layoutPages(2000, 1500, 100, DEFAULT_PRINT) as PageLayout;
    for (const page of l.pages) {
      const marks = cropMarks(l, page, 4);
      expect(marks).toHaveLength(8);
      for (const m of marks) {
        expect(m.x).toBeGreaterThanOrEqual(0);
        expect(m.y).toBeGreaterThanOrEqual(0);
        expect(m.x + m.w).toBeLessThanOrEqual(l.pageWidth);
        expect(m.y + m.h).toBeLessThanOrEqual(l.pageHeight);
        const inside =
          m.x < l.margin + page.srcW &&
          m.x + m.w > l.margin &&
          m.y < l.margin + page.srcH &&
          m.y + m.h > l.margin;
        expect(inside).toBe(false);
      }
    }
  });

  it('page file names', () => {
    expect(pageFileName('crypte', 1, 6)).toBe('crypte_p01.png');
    expect(pageFileName('crypte', 12, 120)).toBe('crypte_p012.png');
  });
});

describe('bands', () => {
  it('cover the image exactly with 256-row bands and bounded columns', () => {
    for (const [w, h] of [
      [1, 1],
      [8000, 8000],
      [40_000, 300],
      [16_385, 257],
    ] as const) {
      const bands = planBands(w, h);
      expect(bands).toHaveLength(Math.ceil(h / BAND_HEIGHT));
      let rows = 0;
      for (const band of bands) {
        expect(band[0]!.y).toBe(rows);
        rows += band[0]!.h;
        expect(band.reduce((s, t) => s + t.w, 0)).toBe(w);
        for (const t of band) {
          expect(t.w).toBeLessThanOrEqual(MAX_SURFACE_WIDTH);
          expect(t.h).toBeLessThanOrEqual(BAND_HEIGHT);
        }
      }
      expect(rows).toBe(h);
    }
  });

  it('plans one PNG, or a ZIP of numbered pages in print mode', () => {
    const base: ExportOptions = {
      extent: { x: 0, y: 0, w: 20, h: 15 },
      pxPerCell: 100,
      grid: true,
      transparent: false,
      print: null,
      baseName: 'crypte',
      title: 'Crypte',
      software: 'JDR',
    };
    const png = planExport(base);
    expect(png).toMatchObject({ kind: 'png', fileName: 'crypte.png', steps: 6 });
    const zip = planExport({ ...base, print: DEFAULT_PRINT });
    if (typeof zip === 'string') throw new Error(zip);
    expect(zip.kind).toBe('zip');
    expect(zip.files.map((f) => f.name)).toEqual([
      'crypte_p01.png',
      'crypte_p02.png',
      'crypte_p03.png',
      'crypte_p04.png',
      'crypte_p05.png',
      'crypte_p06.png',
    ]);
    expect(zip.steps).toBe(6 * Math.ceil(1188 / 256));
    const single = planExport({ ...base, print: { ...DEFAULT_PRINT, paging: false } });
    expect(single).toMatchObject({ kind: 'png' });
  });
});
