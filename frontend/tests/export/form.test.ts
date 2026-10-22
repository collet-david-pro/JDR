import { describe, expect, it } from 'vitest';
import { MapDocument } from '../../src/editor/model/MapDocument';
import { defaultForm, evaluateForm, parseNumber, type ExportForm } from '../../src/export/form';
import type { ExportSource } from '../../src/export/types';

function source(over: Partial<ExportSource> = {}): ExportSource {
  const view = new MapDocument({
    grid: { width: 40, height: 30, cellPx: 70, unitLabel: 'ft', unitPerCell: 5 },
    palette: [null, { assetId: 'a', url: null, name: 'Dalle perdue' }],
  });
  view.setCells('ground', [[1, 1, 1, 0, 0]]);
  return { view, name: 'Crypte / basse', selection: null, viewport: null, ...over };
}

describe('export form', () => {
  it('parses decimal inputs (comma accepted)', () => {
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber(' 70 ')).toBe(70);
    expect(parseNumber('')).toBeNaN();
    expect(parseNumber('-3')).toBeNaN();
    expect(parseNumber('1e3')).toBeNaN();
  });

  it('defaults: whole map ×1, visible tile layers, grid, opaque; selection preferred', () => {
    const s = source();
    const form = defaultForm(s);
    expect(form.extent).toBe('map');
    expect(form.layers).toEqual({ ground: true, terrain: true, decor: true });
    const ev = evaluateForm(form, s);
    expect(ev.size).toMatchObject({ width: 2800, height: 2100, error: null });
    expect(ev.fileName).toBe('Crypte _ basse.png');
    expect(ev.mime).toBe('image/png');
    expect(ev.missing).toEqual([{ index: 1, name: 'Dalle perdue' }]);
    expect(ev.options).toMatchObject({
      extent: { x: 0, y: 0, w: 40, h: 30 },
      pxPerCell: 70,
      grid: true,
      transparent: false,
      print: null,
      title: 'Crypte / basse',
    });
    const withSel = source({ selection: { x: 2, y: 3, w: 4, h: 5 } });
    expect(defaultForm(withSel).extent).toBe('selection');
    expect(evaluateForm(defaultForm(withSel), withSel).size).toMatchObject({
      width: 280,
      height: 350,
    });
  });

  it('reports errors: unavailable extent, nothing to draw, bad size, bad print settings', () => {
    const s = source();
    const base = defaultForm(s);
    const ev = (over: Partial<ExportForm>) => evaluateForm({ ...base, ...over }, s);
    expect(ev({ extent: 'view' }).errors).toEqual(['no_extent']);
    expect(
      ev({ layers: { ground: false, terrain: false, decor: false }, grid: false }).errors,
    ).toEqual(['no_layers']);
    expect(ev({ mode: 'cell', cellPx: 'abc' }).errors).toEqual(['size_invalid']);
    expect(ev({ mode: 'cell', cellPx: '1000' }).errors).toEqual(['size_too_large']);
    expect(ev({ print: true, mmPerCell: '0' }).errors).toEqual(['print_invalid']);
    expect(ev({ print: true, marginMm: '50', paper: 'a4' }).errors).toEqual([]);
    expect(ev({ print: true, overlapMm: '400' }).errors).toEqual(['print_margins']);
    expect(ev({ extent: 'view' }).options).toBeNull();
  });

  it('print mode: pages in a ZIP, or a single PNG with the density only', () => {
    const s = source();
    const form = { ...defaultForm(s), print: true, mode: 'cell' as const, cellPx: '100' };
    const zip = evaluateForm(form, s);
    expect(zip.fileName).toBe('Crypte _ basse.zip');
    expect(zip.mime).toBe('application/zip');
    expect(zip.layout?.pages.length).toBeGreaterThan(1);
    expect(zip.options?.print).toMatchObject({ mmPerCell: 25, paging: true, overlapMm: 5 });
    const single = evaluateForm({ ...form, paging: false }, s);
    expect(single.fileName).toBe('Crypte _ basse.png');
    expect(single.layout).toBeNull();
    expect(single.options?.print?.paging).toBe(false);
  });
});
