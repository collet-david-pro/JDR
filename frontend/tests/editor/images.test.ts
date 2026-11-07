import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../src/editor/contracts';
import type { ImageObject } from '../../src/editor/contracts-images';
import {
  calibratedGeometry,
  calibrationOf,
  fitToMap,
  mapFromImage,
  mapSizeFor,
} from '../../src/editor/images/calibration';
import { imagePatch, watchImageAssets } from '../../src/editor/images/library';
import {
  imageHandleAt,
  imageHandlePoints,
  moveImage,
  nativeSize,
  placeImage,
  resizeImage,
  rotateImage,
} from '../../src/editor/images/transform';
import { MapDocument } from '../../src/editor/model/MapDocument';
import {
  imageBBox,
  imageContains,
  imageGeometry,
  normalizeRotation,
} from '../../src/editor/model/image-values';
import { normalizeObject } from '../../src/editor/model/scene-values';
import { createImageTool, imageAt } from '../../src/editor/tools/image';
import type { ToolResult } from '../../src/editor/tools/types';
import { buildSceneSnapshot } from '../../src/export/scene-snapshot';
import { applyEvent, createSessionState } from '../../src/lib/sessions';
import { event, snapshot } from '../sessions/fixtures';
import { ev, grid, palette, settings } from './helpers';

const MAP = { width: 20, height: 10 };

function image(uid: string, over: Partial<ImageObject> = {}): ImageObject {
  return {
    uid,
    floor: 'f1',
    type: 'image',
    layer: 'props',
    geometry: { x: 2, y: 2, w: 4, h: 2, rotation: 0 },
    props: { asset_id: '5', opacity: 1, flip_h: false, flip_v: false, placement: 'above' },
    visibility: 'all',
    locked: false,
    sort_order: 0,
    rev: 1,
    ...over,
  };
}

describe('image values', () => {
  it('normalizes like the server: rotation in [0, 360), bounds of twice the map', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(360)).toBe(0);
    expect(imageGeometry({ x: -5, y: 0, w: 40, h: 3, rotation: -45 }, MAP)).toEqual({
      x: -5,
      y: 0,
      w: 40,
      h: 3,
      rotation: 315,
    });
    expect(() => imageGeometry({ x: 0, y: 0, w: 41, h: 1, rotation: 0 }, MAP)).toThrow();
    expect(() => imageGeometry({ x: -3, y: 0, w: 3, h: 1, rotation: 0 }, MAP)).toThrow();
    const o = normalizeObject(image('i1') as MapObject, MAP);
    expect(o).toMatchObject({ type: 'image', props: { asset_id: '5', placement: 'above' } });
    expect(() =>
      normalizeObject(
        { ...image('i2'), props: { ...image('i2').props, placement: 'x' } } as never,
        MAP,
      ),
    ).toThrow();
  });

  it('rotated box and hit test', () => {
    const g = { x: 0, y: 0, w: 4, h: 2, rotation: 90 };
    const [x0, y0, x1, y1] = imageBBox(g);
    expect([x0, y0, x1, y1].map((v) => Math.round(v * 1000) / 1000)).toEqual([1, -1, 3, 3]);
    expect(imageContains(g, 2, 2.5)).toBe(true);
    expect(imageContains(g, 0.2, 0.5)).toBe(false);
  });
});

describe('background calibration', () => {
  const img = { width: 1400, height: 700 };

  it('size of a cell in the image or cells across, offset', () => {
    expect(
      calibratedGeometry(
        { mode: 'cell_px', cellPx: 70, cellsWide: 0, offsetX: 1, offsetY: -0.5 },
        img,
        MAP,
      ),
    ).toEqual({ x: 1, y: -0.5, w: 20, h: 10, rotation: 0 });
    expect(
      calibratedGeometry(
        { mode: 'cells_wide', cellPx: 0, cellsWide: 10, offsetX: 0, offsetY: 0 },
        img,
        MAP,
      ),
    ).toEqual({ x: 0, y: 0, w: 10, h: 5, rotation: 0 });
    expect(
      calibratedGeometry(
        { mode: 'cell_px', cellPx: 0, cellsWide: 0, offsetX: 0, offsetY: 0 },
        img,
        MAP,
      ),
    ).toBeNull();
    expect(calibrationOf({ x: 1, y: 2, w: 20, h: 10, rotation: 0 }, img)).toMatchObject({
      cellPx: 70,
      offsetX: 1,
      offsetY: 2,
    });
  });

  it('fit to the map, map size for the image, new map from an image', () => {
    const fit = fitToMap({ width: 1000, height: 1000 }, MAP);
    expect(calibratedGeometry(fit, { width: 1000, height: 1000 }, MAP)).toEqual({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      rotation: 0,
    });
    expect(mapSizeFor({ x: 0.5, y: 0, w: 20.2, h: 9.9, rotation: 0 })).toEqual({
      width: 21,
      height: 10,
    });
    expect(mapFromImage({ width: 2100, height: 1400 }, 70)).toEqual({
      width: 30,
      height: 20,
      cellPx: 70,
      geometry: { x: 0, y: 0, w: 30, h: 20, rotation: 0 },
    });
    expect(mapFromImage({ width: 100, height: 100 }, 8)?.cellPx).toBe(16);
    expect(mapFromImage({ width: 100, height: 100 }, 0)).toBeNull();
  });
});

describe('image transforms', () => {
  const g = grid(20, 10);

  it('native size at the map cell size, else one cell; placed centred, snapped', () => {
    expect(nativeSize({ width: 140, height: 70 }, g)).toEqual({ w: 2, h: 1 });
    expect(nativeSize(null, g)).toEqual({ w: 1, h: 1 });
    expect(nativeSize({ width: 7000, height: 70 }, g)).toEqual({ w: 40, h: 0.4 });
    expect(placeImage({ width: 140, height: 70 }, [5.2, 5.2], g, false)).toEqual({
      x: 4,
      y: 4.5,
      w: 2,
      h: 1,
      rotation: 0,
    });
  });

  it('move (snapped unless free), corner resize (Shift keeps the ratio), rotation by 15°', () => {
    const base = { x: 2, y: 2, w: 4, h: 2, rotation: 0 };
    expect(moveImage(base, 1.3, 0.2, false, MAP)).toMatchObject({ x: 3.5, y: 2 });
    expect(moveImage(base, 1.3, 0.2, true, MAP)).toMatchObject({ x: 3.3, y: 2.2 });
    expect(resizeImage(base, 2, [8, 5], false, false, MAP)).toEqual({
      x: 2,
      y: 2,
      w: 6,
      h: 3,
      rotation: 0,
    });
    expect(resizeImage(base, 2, [8, 3], true, false, MAP)).toEqual({
      x: 2,
      y: 2,
      w: 6,
      h: 3,
      rotation: 0,
    });
    expect(resizeImage(base, 0, [1, 1], false, false, MAP)).toEqual({
      x: 1,
      y: 1,
      w: 5,
      h: 3,
      rotation: 0,
    });
    const turned = rotateImage(base, [4, 0], [7, 3], false);
    expect(turned.rotation).toBe(90);
    expect(rotateImage(base, [4, 0], [5, 0.1], true).rotation).not.toBe(0);
  });

  it('handles: corners and the rotation handle above the top edge', () => {
    const base = { x: 2, y: 2, w: 4, h: 2, rotation: 0 };
    const h = imageHandlePoints(base, 0.05);
    expect(h.rotate[0]).toBe(4);
    expect(h.rotate[1]).toBeCloseTo(0.8);
    expect(imageHandleAt(base, [6, 4], 0.2, 0.05)).toEqual({ kind: 'corner', index: 2 });
    expect(imageHandleAt(base, [4, 0.8], 0.2, 0.05)).toEqual({ kind: 'rotate' });
    expect(imageHandleAt(base, [4, 3], 0.2, 0.05)).toBeNull();
  });
});

describe('image tool', () => {
  function setup(assetId: string | null = '9') {
    const doc = new MapDocument({ grid: grid(20, 10), palette: palette(2) });
    doc.setImageAssets([{ assetId: '9', name: 'Table', url: '/f/9', width: 140, height: 70 }]);
    const s = settings({ imageAssetId: assetId, imagePlacement: 'above', imageLayer: 'props' });
    const ctx = {
      doc,
      settings: s,
      rng: () => 0.5,
      newUid: () => 'img1',
      pixelSize: () => 0.05,
    } as never;
    return { doc, s, tool: createImageTool(ctx) };
  }
  const run = (doc: MapDocument, r: ToolResult): void => {
    if (r.command !== undefined) doc.apply(r.command.ops);
  };

  it('places the chosen image at its native size, selects it, then moves it (one op)', () => {
    const { doc, tool } = setup();
    const placed = tool.onPointer(ev('down', 5, 5));
    const op = placed.command?.ops[0];
    expect(op).toMatchObject({
      type: 'object.add',
      object: {
        type: 'image',
        layer: 'props',
        geometry: { x: 4, y: 4.5, w: 2, h: 1, rotation: 0 },
        props: { asset_id: '9', placement: 'above', opacity: 1 },
        locked: false,
      },
    });
    expect(placed.objectSelection).toEqual({ objects: ['img1'], tokens: [] });
    run(doc, placed);
    tool.onPointer(ev('up', 5, 5));
    // Drag the selected image.
    tool.onPointer(ev('down', 5, 5));
    tool.onPointer(ev('move', 7, 6));
    const moved = tool.onPointer(ev('up', 7, 6));
    expect(moved.command?.ops).toEqual([
      {
        type: 'object.update',
        uid: 'img1',
        rev: 1,
        patch: { geometry: { x: 6, y: 5.5, w: 2, h: 1, rotation: 0 } },
      },
    ]);
  });

  it('without an image chosen: notice; a locked image is selected, not moved', () => {
    const { doc, tool } = setup(null);
    expect(tool.onPointer(ev('down', 1, 1)).notice).toEqual({ code: 'no_image' });
    doc.apply([{ type: 'object.add', object: image('bg', { locked: true }) }]);
    const r = tool.onPointer(ev('down', 3, 3));
    expect(r.objectSelection).toEqual({ objects: ['bg'], tokens: [] });
    tool.onPointer(ev('move', 6, 6));
    expect(tool.onPointer(ev('up', 6, 6)).command).toBeUndefined();
    expect(tool.onAction?.('delete').notice).toEqual({ code: 'object_locked' });
  });

  it('picks the topmost image; a background image places new images over it', () => {
    const objects = [
      image('a', { props: { ...image('a').props, placement: 'background' } }),
      image('b'),
    ];
    expect(imageAt(objects, [3, 3])?.uid).toBe('b');
    const { doc, tool } = setup();
    doc.apply([{ type: 'object.add', object: objects[0]! }]);
    const r = tool.onPointer(ev('down', 3, 3));
    expect(r.command?.ops[0]?.type).toBe('object.add');
  });

  it('image patch keeps the opacity in [0, 1]', () => {
    expect(imagePatch(image('i'), { opacity: 2, flip_h: true })).toEqual({
      props: { asset_id: '5', opacity: 1, flip_h: true, flip_v: false, placement: 'above' },
    });
    expect(imagePatch({ ...image('i'), type: 'wall' } as never, { opacity: 1 })).toBeNull();
  });
});

describe('image assets of the document', () => {
  it('setImageAssets emits a scene change; unknown assets are fetched once', async () => {
    const doc = new MapDocument({ grid: grid(20, 10), palette: palette(2) });
    const events: boolean[] = [];
    doc.onSceneChanged((e) => events.push(e.images === true));
    const asked: string[] = [];
    const api = {
      get: (path: string) => {
        asked.push(path);
        return Promise.resolve({
          data: {
            id: '5',
            name: 'Plan',
            urls: { full: '/f/5', thumb: '/t/5' },
            width: 10,
            height: 20,
          },
        });
      },
    } as never;
    const stop = watchImageAssets(doc, api);
    doc.apply([{ type: 'object.add', object: image('i1') }]);
    doc.apply([{ type: 'object.add', object: image('i2') }]);
    doc.flush();
    await Promise.resolve();
    await Promise.resolve();
    doc.flush();
    expect(asked).toEqual(['/assets/5']);
    expect(doc.imageAsset('5')).toMatchObject({ url: '/f/5', width: 10, height: 20 });
    expect(events).toContain(true);
    stop();
  });
});

describe('export and session', () => {
  it('the export keeps the visible images apart, with their URL in the shared image list', () => {
    const doc = new MapDocument({ grid: grid(20, 10), palette: palette(2) });
    doc.setImageAssets([{ assetId: '5', name: 'Plan', url: '/files/5', width: 10, height: 10 }]);
    doc.apply([
      {
        type: 'object.add',
        object: image('vis', { props: { ...image('vis').props, opacity: 0.5 } }),
      },
      { type: 'object.add', object: image('gm', { layer: 'gm' }) },
    ]);
    const { scene } = buildSceneSnapshot(
      doc,
      [],
      { width: 20, height: 10 },
      { x: 0, y: 0, w: 20, h: 10 },
      { tokens: false, lighting: false, fog: false },
      'http://jdr.test/',
    );
    expect(scene.objects).toEqual([]);
    expect(scene.images).toEqual([
      {
        geometry: { x: 2, y: 2, w: 4, h: 2, rotation: 0 },
        opacity: 0.5,
        flipH: false,
        flipV: false,
        placement: 'above',
        image: 0,
      },
    ]);
    expect(scene.tokenImages).toEqual([{ index: 0, name: 'Plan', url: 'http://jdr.test/files/5' }]);
  });

  it('a player receiving an image whose URL he does not have reloads the snapshot', () => {
    const state = createSessionState(snapshot('player'), '7');
    const r = applyEvent(
      state,
      event(101, 'map.ops.public', {
        map_id: '34',
        revision: 9,
        objects: { upsert: [image('new')], remove: [] },
        chunks: [],
        reload: false,
      }),
    );
    expect(r.effects).toEqual([{ kind: 'reload.snapshot', reason: 'unknown_image' }]);
    const known = createSessionState(
      snapshot('player', {
        map: {
          ...snapshot('player').map!,
          images: [
            {
              asset_id: '5',
              name: '',
              url: '/f',
              thumb_url: '/t',
              width: 1,
              height: 1,
              animated: false,
            },
          ],
        },
      }),
      '7',
    );
    const r2 = applyEvent(
      known,
      event(102, 'map.ops.public', {
        map_id: '34',
        revision: 9,
        objects: { upsert: [image('new')], remove: [] },
        chunks: [],
        reload: false,
      }),
    );
    expect(r2.effects).toEqual([]);
    expect(r2.state.objects['new']).toBeDefined();
  });
});

describe('image history', () => {
  it('a move is undone and redone', async () => {
    const { History } = await import('../../src/editor/history/History');
    const doc = new MapDocument({ grid: grid(20, 10), palette: palette(2) });
    const history = new History(doc);
    history.execute({
      label: 'a',
      ops: [{ type: 'object.add', object: image('i1') }],
      inverseOps: [],
    });
    history.execute({
      label: 'b',
      ops: [
        {
          type: 'object.update',
          uid: 'i1',
          rev: 1,
          patch: { geometry: { x: 5, y: 5, w: 4, h: 2, rotation: 0 } },
        },
      ],
      inverseOps: [],
    });
    expect(doc.object('i1')?.geometry).toMatchObject({ x: 5 });
    expect(history.undo()).toBe(true);
    expect(doc.object('i1')?.geometry).toMatchObject({ x: 2, y: 2 });
    expect(history.redo()).toBe(true);
    expect(doc.object('i1')?.geometry).toMatchObject({ x: 5 });
  });
});
