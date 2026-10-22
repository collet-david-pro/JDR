import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { MapDocument } from '../../src/editor/model/MapDocument';
import type { PaletteEntry } from '../../src/editor/contracts';
import { loadTileImages, type TileImages } from '../../src/export/images';
import { runExport, type Surface } from '../../src/export/job';
import {
  DEFAULT_PRINT,
  layoutPages,
  pageFileName,
  type PageLayout,
} from '../../src/export/print-layout';
import { ExportScene } from '../../src/export/renderer';
import {
  buildSnapshot,
  defaultLayers,
  missingAssets,
  type ExportOptions,
  type MapSnapshot,
} from '../../src/export/scene';
import { FakeContext, fakeImage } from './fake-canvas';
import { collector, decodePng } from './png-decode';

const palette: (PaletteEntry | null)[] = [
  null,
  { assetId: 'a1', url: '/files/a1', name: 'Dalles' },
  { assetId: 'a2', url: null, name: 'Sans image' },
  { assetId: 'a3', url: '/files/broken', name: 'Cassée' },
];

function doc(): MapDocument {
  const d = new MapDocument({
    grid: { width: 40, height: 35, cellPx: 8, unitLabel: 'ft', unitPerCell: 5 },
    palette,
    theme: 'slate',
  });
  const cells: [number, number, number, number, number][] = [];
  for (let y = 0; y < 35; y++) {
    for (let x = 0; x < 40; x++)
      if ((x + y) % 3 !== 0) cells.push([x, y, 1 + ((x + 2 * y) % 3), x % 2, (x + y) % 16]);
  }
  d.setCells('ground', cells);
  d.setCells('decor', [
    [5, 5, 1, 0, 1],
    [33, 34, 2, 1, 0],
  ]);
  return d;
}

/** 4×2 strip (2 square frames) for a1; a3 fails. */
async function tileImages(snapshot: MapSnapshot): Promise<TileImages> {
  return loadTileImages(
    snapshot.palette,
    new AbortController().signal,
    async (url) => {
      if (url.includes('broken')) throw new Error('404');
      return fakeImage(4, 2, (x, y) => [x * 60, y * 120, 200, 255]) as unknown as ImageBitmap;
    },
    async (pixels) => ({ width: 2, height: 2, pixels }) as unknown as CanvasImageSource,
  );
}

function surfaces(): (w: number, h: number) => Surface {
  return (w, h) => {
    const ctx = new FakeContext(w, h);
    return { ctx, read: (rw, rh) => ctx.getImageData(rw, rh) };
  };
}

const base: ExportOptions = {
  extent: { x: 3, y: 2, w: 33, h: 31 },
  pxPerCell: 10,
  grid: true,
  transparent: false,
  print: null,
  baseName: 'crypte',
  title: 'Crypte',
  software: 'JDR test',
};

describe('snapshot', () => {
  it('copies the chunks of the extent, the used palette and lists missing assets', () => {
    const d = doc();
    const layers = defaultLayers(d);
    expect(layers).toEqual(['ground', 'terrain', 'decor']);
    const { snapshot, transfer } = buildSnapshot(d, base.extent, layers, 'http://jdr.test/app/');
    expect(snapshot.layers.map((l) => l.id)).toEqual(['ground', 'terrain', 'decor']);
    expect(snapshot.layers[0]!.chunks.length).toBe(4);
    expect(transfer.length).toBe(4 + 0 + 2);
    expect(snapshot.palette.map((p) => p.url)).toEqual([
      'http://jdr.test/files/a1',
      null,
      'http://jdr.test/files/broken',
    ]);
    // A copy: changing it does not touch the document.
    snapshot.layers[0]!.chunks[0]![1].fill(0);
    expect(d.getCell('ground', 1, 0).index).not.toBe(0);
    expect(missingAssets(d, base.extent, layers)).toEqual([{ index: 2, name: 'Sans image' }]);
    // Outside the extent: (33, 34) is excluded by a smaller extent.
    expect(missingAssets(d, { x: 0, y: 0, w: 2, h: 1 }, ['decor'])).toEqual([]);
  });
});

describe('runExport', () => {
  it('streams a PNG identical to a full render, in bands and columns', async () => {
    const d = doc();
    const { snapshot } = buildSnapshot(d, base.extent, defaultLayers(d));
    const images = await tileImages(snapshot);
    expect(images.failed.map((f) => f.index)).toEqual([3]);
    const out = collector();
    const progress: number[] = [];
    const result = await runExport(snapshot, base, {
      images,
      createSurface: surfaces(),
      sink: out.sink,
      signal: new AbortController().signal,
      maxSurfaceWidth: 128,
      onStep: (p) => {
        progress.push(p.done);
        expect(p.total).toBe(6);
      },
    });
    expect(result.files).toBe(1);
    const png = decodePng(out.bytes());
    expect([png.width, png.height, png.colorType]).toEqual([330, 310, 2]);
    expect(progress.at(-1)).toBe(6);

    const scene = new ExportScene(snapshot, base.extent, 10, base, images);
    const full = new FakeContext(330, 310);
    scene.draw(full, 0, 0, 330, 310);
    const expected = full.getImageData(330, 310);
    expect(Buffer.from(png.rgba).equals(Buffer.from(expected))).toBe(true);
    const text = png.chunks
      .filter((c) => c.type === 'tEXt')
      .map((c) => Buffer.from(c.data).toString('latin1'));
    expect(text).toEqual([
      'Title\0Crypte',
      'Software\0JDR test',
      'Comment\0scale=10px/cell; cells=3,2,33x31; seed=-',
    ]);
    expect(png.chunks.some((c) => c.type === 'pHYs')).toBe(false);
  });

  it('transparent background ⇒ RGBA', async () => {
    const d = doc();
    const { snapshot } = buildSnapshot(d, base.extent, ['decor']);
    const out = collector();
    await runExport(
      snapshot,
      { ...base, transparent: true, grid: false },
      {
        images: await tileImages(snapshot),
        createSurface: surfaces(),
        sink: out.sink,
        signal: new AbortController().signal,
      },
    );
    const png = decodePng(out.bytes());
    expect(png.colorType).toBe(6);
    expect(png.rgba[3]).toBe(0);
  });

  it('print mode: ZIP of numbered A4 pages with pHYs, white margins and crop marks', async () => {
    const d = doc();
    const { snapshot } = buildSnapshot(d, base.extent, defaultLayers(d));
    const options: ExportOptions = {
      ...base,
      pxPerCell: 10,
      print: { ...DEFAULT_PRINT, mmPerCell: 25, marginMm: 10 },
    };
    const out = collector();
    await runExport(snapshot, options, {
      images: await tileImages(snapshot),
      createSurface: surfaces(),
      sink: out.sink,
      signal: new AbortController().signal,
    });
    const zip = Buffer.from(out.bytes());
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    // Walk local entries (stored, data descriptor): find PNG signatures.
    const layout = layoutPages(330, 310, 10, options.print!) as PageLayout;
    expect(layout.pages.length).toBe(15);
    const names: string[] = [];
    let o = 0;
    const pages: ReturnType<typeof decodePng>[] = [];
    while (zip.readUInt32LE(o) === 0x04034b50) {
      const nameLen = zip.readUInt16LE(o + 26);
      names.push(zip.subarray(o + 30, o + 30 + nameLen).toString('utf8'));
      const start = o + 30 + nameLen;
      const iend = zip.indexOf(Buffer.from('IEND'), start) + 8;
      pages.push(decodePng(new Uint8Array(zip.subarray(start, iend))));
      o = iend + 16;
    }
    expect(names).toEqual(layout.pages.map((p) => pageFileName('crypte', p.number, 15)));
    const p1 = pages[0]!;
    expect([p1.width, p1.height]).toEqual([layout.pageWidth, layout.pageHeight]);
    const phys = p1.chunks.find((c) => c.type === 'pHYs')!.data;
    expect(Buffer.from(phys).readUInt32BE(0)).toBe(400); // 10 px / 25 mm
    const at = (x: number, y: number): number[] => [
      ...p1.rgba.subarray((y * p1.width + x) * 4, (y * p1.width + x) * 4 + 4),
    ];
    expect(at(0, 0)).toEqual([255, 255, 255, 255]);
    // Map part starts at the margin.
    expect(at(layout.margin + 1, layout.margin + 1)).not.toEqual([255, 255, 255, 255]);
    expect(inflateRawSync).toBeTypeOf('function');
  });

  it('stops on abort and aborts the encoder', async () => {
    const d = doc();
    const { snapshot } = buildSnapshot(d, base.extent, defaultLayers(d));
    const controller = new AbortController();
    const run = runExport(snapshot, base, {
      images: await tileImages(snapshot),
      createSurface: surfaces(),
      sink: () => undefined,
      signal: controller.signal,
      onStep: (p) => {
        if (p.done === 1) controller.abort(new DOMException('stop', 'AbortError'));
      },
    });
    await expect(run).rejects.toThrow('stop');
  });
});
