import { describe, expect, it } from 'vitest';
import type { Ambient, MapObject, SceneView } from '../../src/editor/contracts';
import { MapDocument } from '../../src/editor/model/MapDocument';
import { gridTheme } from '../../src/engine/grid-themes';
import { NO_TOKEN_IMAGES, type TileImages } from '../../src/export/images';
import { ExportScene } from '../../src/export/renderer';
import { buildSnapshot, type MapSnapshot } from '../../src/export/scene';
import { buildSceneSnapshot, type SceneContentOptions } from '../../src/export/scene-snapshot';
import { WALL_COLORS } from '../../src/scene/style';
import { passage, pin, secretRoom, trap, zone } from '../editor/note-helpers';
import { FakeContext } from './fake-canvas';

const DAY: Ambient = {
  darkness: 0,
  tint: '#000000',
  time_of_day: null,
  weather: { type: 'none', intensity: 0 },
};
const W = 30;
const H = 30;
const NONE: SceneContentOptions = { tokens: false, lighting: false, fog: false };

function fakeScene(objects: MapObject[]): SceneView {
  return {
    floor: 'f1',
    sceneRevision: 1,
    objects: () => objects,
    object: (uid) => objects.find((o) => o.uid === uid),
    tokens: () => [],
    token: () => undefined,
    tokenDef: () => null,
    ambient: DAY,
    fogKeys: () => [],
    fogChunk: () => null,
    onSceneChanged: () => () => undefined,
  };
}

const gmObjects: MapObject[] = [
  pin('pin', 5, 5),
  { ...pin('pinvis', 7, 5), visibility: 'all' },
  zone('zone', [
    [10, 10],
    [20, 10],
    [20, 20],
    [10, 20],
  ]),
  trap('trap', 8, 8),
  secretRoom('room', [
    [22, 22],
    [26, 22],
    [26, 26],
  ]),
  passage('passage', [2, 15], [8, 15]),
];

const noTiles: TileImages = {
  tile: () => {
    throw new Error('no tile expected');
  },
  failed: [],
  close: () => undefined,
};

function render(objects: MapObject[]): FakeContext {
  const doc = new MapDocument({
    grid: { width: W, height: H, cellPx: 10, unitLabel: 'ft', unitPerCell: 5 },
    palette: [null],
    theme: 'light',
  });
  const snapshot: MapSnapshot = buildSnapshot(
    doc,
    { x: 0, y: 0, w: W, h: H },
    [],
    'http://jdr.test/',
    {
      view: fakeScene(objects),
      content: NONE,
    },
  ).snapshot;
  const ppc = 4;
  const scene = new ExportScene(
    snapshot,
    { x: 0, y: 0, w: W, h: H },
    ppc,
    { grid: false, transparent: false, scene: NONE },
    noTiles,
    { tokenImages: NO_TOKEN_IMAGES, lightSurface: () => new FakeContext(W * ppc, H * ppc) },
  );
  const ctx = new FakeContext(W * ppc, H * ppc);
  scene.draw(ctx, 0, 0, W * ppc, H * ppc);
  return ctx;
}

const at = (ctx: FakeContext, x: number, y: number): number[] => ctx.pixel(x * 4, y * 4);
const BG = gridTheme('light').background;
const BG_RGB = [(BG >> 16) & 255, (BG >> 8) & 255, BG & 255, 255];

describe('PNG export of the notes family (player view)', () => {
  it('keeps no GM pin, zone, trap nor secret room; the passage is a wall and an occluder', () => {
    const { scene } = buildSceneSnapshot(
      fakeScene(gmObjects),
      [],
      { width: W, height: H },
      { x: 0, y: 0, w: W, h: H },
      NONE,
    );
    expect(scene.objects.map((o) => o.uid).sort()).toEqual(['passage', 'pinvis']);
    expect(scene.occluders.map((o) => o.uid)).toEqual(['passage']);
  });

  it('draws the passage with the wall colour and nothing for the GM elements', () => {
    const ctx = render(gmObjects);
    const c = WALL_COLORS.stone;
    expect(at(ctx, 5, 15)).toEqual([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255]);
    // Where the GM pin, zone and trap are: the plain background.
    expect(at(ctx, 5, 5)).toEqual(BG_RGB);
    expect(at(ctx, 15, 15)).toEqual(BG_RGB);
    expect(at(ctx, 8, 8)).toEqual(BG_RGB);
    expect(at(ctx, 24, 24)).toEqual(BG_RGB);
  });
});
