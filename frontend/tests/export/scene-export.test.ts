import { describe, expect, it } from 'vitest';
import type {
  Ambient,
  ChunkKey,
  MapObject,
  PlacedToken,
  SceneView,
  TokenDefView,
} from '../../src/editor/contracts';
import { MapDocument } from '../../src/editor/model/MapDocument';
import { gridTheme } from '../../src/engine/grid-themes';
import { defaultForm, evaluateForm } from '../../src/export/form';
import { NO_TOKEN_IMAGES, loadTokenImages, type TileImages } from '../../src/export/images';
import { runExport, type Surface } from '../../src/export/job';
import { DEFAULT_PRINT } from '../../src/export/print-layout';
import { ExportScene } from '../../src/export/renderer';
import { buildSnapshot, type ExportOptions, type MapSnapshot } from '../../src/export/scene';
import { buildSceneSnapshot, type SceneContentOptions } from '../../src/export/scene-snapshot';
import { fogRasterizers } from '../../src/vision';
import { TOKEN_RING_COLORS, WALL_COLORS } from '../../src/scene/style';
import { door, light, wall } from '../vision/helpers';
import { FakeContext, fakeImage } from './fake-canvas';
import { collector, decodePng } from './png-decode';

const NIGHT: Ambient = {
  darkness: 1,
  tint: '#000000',
  time_of_day: null,
  weather: { type: 'none', intensity: 0 },
};

const DEFS: Record<string, TokenDefView> = {
  hero: {
    id: 'hero',
    name: 'Héra Brave',
    imageUrl: null,
    sizeW: 1,
    sizeH: 1,
    ringColor: null,
    kind: 'pc',
    vision: { enabled: true, range: 10, dark: 0 },
    light: { radius: 1, dim_radius: 2, color: '#ff0000', intensity: 1, flicker: true },
  },
  orc: {
    id: 'orc',
    name: 'Orc',
    imageUrl: '/files/orc',
    sizeW: 2,
    sizeH: 2,
    ringColor: '#00ff00',
    kind: 'monster',
    vision: { enabled: false, range: 0, dark: 0 },
    light: null,
  },
};

function placed(uid: string, token_id: string, x: number, y: number, hidden = false): PlacedToken {
  return {
    uid,
    floor: 'f1',
    token_id,
    x,
    y,
    rotation: 0,
    scale: 1,
    hidden,
    light_override: null,
    rev: 1,
  };
}

function fakeScene(
  objects: MapObject[],
  tokens: PlacedToken[] = [],
  ambient: Ambient = NIGHT,
  fog: Map<ChunkKey, Uint8Array> = new Map(),
): SceneView {
  return {
    floor: 'f1',
    sceneRevision: 1,
    objects: () => objects,
    object: (uid) => objects.find((o) => o.uid === uid),
    tokens: () => tokens,
    token: (uid) => tokens.find((t) => t.uid === uid),
    tokenDef: (id) => DEFS[id] ?? null,
    ambient,
    fogKeys: () => [...fog.keys()],
    fogChunk: (key) => fog.get(key) ?? null,
    onSceneChanged: () => () => undefined,
  };
}

const ALL: SceneContentOptions = { tokens: true, lighting: true, fog: true };
/** Everything but the fog (no fog chunk = all black). */
const LIT: SceneContentOptions = { tokens: true, lighting: true, fog: false };
const W = 30;
const H = 30;

function mapDoc(): MapDocument {
  return new MapDocument({
    grid: { width: W, height: H, cellPx: 10, unitLabel: 'ft', unitPerCell: 5 },
    palette: [null],
    theme: 'light',
  });
}

function snapshotOf(scene: SceneView, content: SceneContentOptions = ALL): MapSnapshot {
  const d = mapDoc();
  return buildSnapshot(d, { x: 0, y: 0, w: W, h: H }, [], 'http://jdr.test/', {
    view: scene,
    content,
  }).snapshot;
}

const noTiles: TileImages = { tile: () => assertNever(), failed: [], close: () => undefined };
function assertNever(): never {
  throw new Error('no tile expected');
}

function render(
  snapshot: MapSnapshot,
  content: SceneContentOptions = LIT,
  options: { transparent?: boolean; ppc?: number; tokenImages?: typeof NO_TOKEN_IMAGES } = {},
): FakeContext {
  const ppc = options.ppc ?? 4;
  const scene = new ExportScene(
    snapshot,
    { x: 0, y: 0, w: W, h: H },
    ppc,
    { grid: false, transparent: options.transparent ?? false, scene: content },
    noTiles,
    {
      tokenImages: options.tokenImages ?? NO_TOKEN_IMAGES,
      lightSurface: () => new FakeContext(W * ppc, H * ppc),
    },
  );
  const ctx = new FakeContext(W * ppc, H * ppc);
  scene.draw(ctx, 0, 0, W * ppc, H * ppc);
  return ctx;
}

/** Pixel at the centre of cell coordinates (x, y), ppc 4. */
const at = (ctx: FakeContext, x: number, y: number, ppc = 4): number[] =>
  ctx.pixel(Math.floor(x * ppc), Math.floor(y * ppc));

const BG = gridTheme('light').background;
const BG_RGB = [(BG >> 16) & 255, (BG >> 8) & 255, BG & 255];

describe('scene snapshot (export view = GM view without GM elements)', () => {
  it('filters gm objects, invisible walls, hidden tokens; keeps occluders players receive', () => {
    const visible = wall([
      [1, 1],
      [5, 1],
    ]);
    const gmWall = {
      ...wall([
        [1, 2],
        [5, 2],
      ]),
      layer: 'gm' as const,
    };
    const secretWall = {
      ...wall([
        [1, 3],
        [5, 3],
      ]),
      visibility: 'gm' as const,
    };
    const invisible = wall(
      [
        [1, 4],
        [5, 4],
      ],
      false,
      { kind: 'invisible' },
    );
    const lamp = light(3, 3);
    const off = light(4, 4, { enabled: false });
    const follower = light(0, 0, { follows_token: 't1' });
    const gmLamp = { ...light(6, 6), layer: 'gm' as const };
    const scene = fakeScene(
      [visible, gmWall, secretWall, invisible, lamp, off, follower, gmLamp],
      [placed('t1', 'hero', 7, 8), placed('t2', 'orc', 9, 9, true), placed('t3', 'orc', 2, 2)],
    );
    const { scene: snap } = buildSceneSnapshot(
      scene,
      [],
      { width: W, height: H },
      { x: 0, y: 0, w: W, h: H },
      ALL,
      'http://jdr.test/app/',
    );
    expect(snap.objects).toEqual([visible]);
    expect(snap.occluders).toEqual([visible, invisible]);
    expect(snap.lights.map((l) => [l.x, l.y])).toEqual([
      [3, 3],
      [7, 8],
      [7, 8],
    ]);
    // Token light: P3 flicker flag ⇒ mean intensity 1 − 0.15 / 2.
    expect(snap.lights[2]).toMatchObject({ radius: 1, dim: 2, color: 0xff0000, level: 0.925 });
    expect(snap.tokens.map((t) => t.uid)).toEqual(['t1', 't3']);
    expect(snap.tokens[0]).toMatchObject({ ring: TOKEN_RING_COLORS.pc, image: null, w: 1 });
    expect(snap.tokens[1]).toMatchObject({ ring: 0x00ff00, image: 0, w: 2, h: 2 });
    expect(snap.tokenImages).toEqual([{ index: 0, name: 'Orc', url: 'http://jdr.test/files/orc' }]);
  });

  it('copies only the switched-on content, fog chunks of the extent only', () => {
    const fog = new Map<ChunkKey, Uint8Array>([
      ['0:0', new Uint8Array(2048).fill(1)],
      ['5:5', new Uint8Array(2048).fill(2)],
    ]);
    const scene = fakeScene([light(3, 3)], [placed('t1', 'hero', 1, 1)], NIGHT, fog);
    const none = buildSceneSnapshot(
      scene,
      [],
      { width: W, height: H },
      { x: 0, y: 0, w: W, h: H },
      { tokens: false, lighting: false, fog: false },
    );
    expect([none.scene.tokens, none.scene.lights, none.scene.fog]).toEqual([[], [], []]);
    const all = buildSceneSnapshot(
      scene,
      [],
      { width: W, height: H },
      { x: 0, y: 0, w: W, h: H },
      ALL,
    );
    expect(all.scene.fog.map(([k]) => k)).toEqual(['0:0']);
    expect(all.transfer).toHaveLength(1);
    all.scene.fog[0]![1].fill(0);
    expect(fog.get('0:0')![0]).toBe(1);
  });

  it('no scene ⇒ P4 snapshot (scene null)', () => {
    expect(buildSnapshot(mapDoc(), { x: 0, y: 0, w: 2, h: 2 }, []).snapshot.scene).toBeNull();
  });
});

describe('scene rendering', () => {
  const divider = wall([
    [10, 0],
    [10, 30],
  ]);

  it('draws walls with the engine colours', () => {
    const ctx = render(snapshotOf(fakeScene([divider], [], { ...NIGHT, darkness: 0 })));
    const c = WALL_COLORS.stone;
    expect(at(ctx, 10, 15)).toEqual([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255]);
    expect(at(ctx, 5, 15)).toEqual([...BG_RGB, 255]);
  });

  it('a wall stops the light: dark behind it, lit in front', () => {
    const lamp = light(6, 15, { radius: 4, dim_radius: 9 });
    const blocked = render(snapshotOf(fakeScene([divider, lamp])));
    const open = render(snapshotOf(fakeScene([lamp])));
    // In front: full light ⇒ background colour.
    expect(at(blocked, 7, 15)).toEqual([...BG_RGB, 255]);
    // Behind the wall (distance 6 < dim radius 9): lit without the wall, black with it.
    expect(at(open, 12, 15)[0]).toBeGreaterThan(40);
    expect(at(blocked, 12, 15)).toEqual([0, 0, 0, 255]);
    // Far away: darkness 1 ⇒ black.
    expect(at(open, 25, 25)).toEqual([0, 0, 0, 255]);
  });

  it('a closed door blocks, an open one lets the light through', () => {
    const lamp = light(6, 15, { radius: 4, dim_radius: 9 });
    const closed = render(snapshotOf(fakeScene([divider, door([10, 14], [10, 16]), lamp])));
    const opened = render(
      snapshotOf(
        fakeScene([divider, door([10, 14], [10, 16], { state: 'open', swing: 'a' }), lamp]),
      ),
    );
    expect(at(closed, 12, 15)).toEqual([0, 0, 0, 255]);
    expect(at(opened, 12, 15.2)[0]).toBeGreaterThan(40);
  });

  it('ambient darkness and tint multiply the scene', () => {
    const half = render(snapshotOf(fakeScene([], [], { ...NIGHT, darkness: 0.5 })));
    const p = at(half, 15, 15);
    expect(p[0]).toBeCloseTo(Math.round(BG_RGB[0]! * (128 / 255)), -0.5);
    const blue = render(
      snapshotOf(fakeScene([], [], { ...NIGHT, darkness: 0.5, tint: '#0000ff' })),
    );
    const q = at(blue, 15, 15);
    expect(q[2]).toBeGreaterThan(q[0]!);
  });

  it('lighting off or darkness 0 leaves the image unchanged', () => {
    const lamp = light(6, 15);
    const off = render(snapshotOf(fakeScene([lamp])), {
      tokens: true,
      lighting: false,
      fog: false,
    });
    expect(at(off, 25, 25)).toEqual([...BG_RGB, 255]);
    const day = render(snapshotOf(fakeScene([lamp], [], { ...NIGHT, darkness: 0 })));
    expect(at(day, 25, 25)).toEqual([...BG_RGB, 255]);
  });

  it('fog: unexplored sub-cells black, explored ones untouched', () => {
    const fog = new Map(fogRasterizers.rect(0, 0, 12.5, 30, W, H));
    const ctx = render(snapshotOf(fakeScene([], [], { ...NIGHT, darkness: 0 }, fog)), ALL);
    expect(at(ctx, 5, 5)).toEqual([...BG_RGB, 255]);
    expect(at(ctx, 12.3, 5)).toEqual([...BG_RGB, 255]);
    expect(at(ctx, 12.6, 5)).toEqual([0, 0, 0, 255]);
    expect(at(ctx, 25, 25)).toEqual([0, 0, 0, 255]);
    // Fog option off: nothing black.
    const off = render(snapshotOf(fakeScene([], [], { ...NIGHT, darkness: 0 }, fog)), {
      tokens: true,
      lighting: false,
      fog: false,
    });
    expect(at(off, 25, 25)).toEqual([...BG_RGB, 255]);
  });

  it('draws tokens: image, or disc of the ring colour with initials; hidden tokens skipped', async () => {
    const scene = fakeScene(
      [],
      [placed('t1', 'hero', 5, 5), placed('t2', 'orc', 15, 15), placed('t3', 'orc', 25, 25, true)],
      { ...NIGHT, darkness: 0 },
    );
    const snapshot = snapshotOf(scene);
    const tokenImages = await loadTokenImages(
      snapshot.scene!.tokenImages,
      new AbortController().signal,
      async () => fakeImage(8, 8, () => [200, 10, 30, 255]) as unknown as ImageBitmap,
    );
    const ctx = render(snapshot, LIT, { ppc: 8, tokenImages });
    // Hero: disc in the pc ring colour, alpha 0.92 over the background.
    const pc = TOKEN_RING_COLORS.pc;
    const disc = at(ctx, 5.2, 5.2, 8);
    expect(disc[2]).toBeCloseTo(Math.round((pc & 255) * 0.92 + BG_RGB[2]! * 0.08), -0.5);
    expect(ctx.calls.some((c) => c.startsWith('fillText HB'))).toBe(true);
    // Orc: image in the middle, green ring at the edge.
    expect(at(ctx, 15, 15, 8)).toEqual([200, 10, 30, 255]);
    expect(at(ctx, 14.05, 15, 8)).toEqual([0, 255, 0, 255]);
    // Hidden token: nothing.
    expect(at(ctx, 25, 25, 8)).toEqual([...BG_RGB, 255]);
    // Tokens off.
    const none = render(
      snapshot,
      { tokens: false, lighting: false, fog: false },
      { ppc: 8, tokenImages },
    );
    expect(at(none, 15, 15, 8)).toEqual([...BG_RGB, 255]);
  });

  it('a failed token image falls back to the disc and is reported', async () => {
    const snapshot = snapshotOf(fakeScene([], [placed('t2', 'orc', 15, 15)]));
    const tokenImages = await loadTokenImages(
      snapshot.scene!.tokenImages,
      new AbortController().signal,
      async () => {
        throw new Error('404');
      },
    );
    expect(tokenImages.failed).toEqual([
      { index: -1, name: 'Orc', url: 'http://jdr.test/files/orc' },
    ]);
    expect(tokenImages.get(0)).toBeNull();
  });

  it('transparent background: lighting keeps transparent pixels transparent', () => {
    const ctx = render(snapshotOf(fakeScene([divider, light(6, 15)])), LIT, {
      transparent: true,
    });
    expect(at(ctx, 25, 25)[3]).toBe(0);
    // Drawn pixels (the wall) stay opaque.
    expect(at(ctx, 10, 2)[3]).toBe(255);
  });
});

describe('runExport with a scene', () => {
  const objects = [
    wall([
      [10, 0],
      [10, 30],
    ]),
    door([10, 14], [10, 17], { state: 'open', swing: 'b' }),
    light(8, 16, { radius: 3, dim_radius: 12, color: '#ffcc88' }),
    light(20, 6, { radius: 2, dim_radius: 10, cone: { angle: 120, direction: 90 } }),
  ];
  const fog = new Map(
    fogRasterizers.polygon(
      [
        [0, 0],
        [24, 0],
        [18, 30],
        [0, 30],
      ],
      W,
      H,
    ),
  );
  const scene = fakeScene(
    objects,
    [placed('t1', 'hero', 9, 20), placed('t2', 'orc', 13, 12)],
    {
      ...NIGHT,
      darkness: 0.8,
      tint: '#3040a0',
    },
    fog,
  );
  const ppc = 10;
  const extent = { x: 0, y: 0, w: W, h: H };
  const options: ExportOptions = {
    extent,
    pxPerCell: ppc,
    grid: true,
    transparent: false,
    print: null,
    baseName: 'nuit',
    title: 'Nuit',
    software: 'JDR test',
    scene: ALL,
  };
  const surfaces = (w: number, h: number): Surface => {
    const ctx = new FakeContext(w, h);
    return { ctx, read: (rw, rh) => ctx.getImageData(rw, rh) };
  };
  const images = (): Promise<typeof NO_TOKEN_IMAGES> =>
    loadTokenImages(
      [{ index: 0, name: 'Orc', url: 'x' }],
      new AbortController().signal,
      async () => fakeImage(4, 4, (x) => [x * 60, 90, 200, 255]) as unknown as ImageBitmap,
    );

  it('bands and columns join seamlessly (identical to a single full render)', async () => {
    const snapshot = buildSnapshot(mapDoc(), extent, [], undefined, {
      view: scene,
      content: ALL,
    }).snapshot;
    const tokenImages = await images();
    const out = collector();
    await runExport(snapshot, options, {
      images: noTiles,
      tokenImages,
      createSurface: surfaces,
      sink: out.sink,
      signal: new AbortController().signal,
      maxSurfaceWidth: 128,
    });
    const png = decodePng(out.bytes());
    expect([png.width, png.height]).toEqual([300, 300]);
    const full = new ExportScene(snapshot, extent, ppc, options, noTiles, {
      tokenImages,
      lightSurface: () => new FakeContext(300, 300),
    });
    const ctx = new FakeContext(300, 300);
    full.draw(ctx, 0, 0, 300, 300);
    const expected = ctx.getImageData(300, 300);
    let diff = 0;
    for (let i = 0; i < expected.length; i++) if (expected[i] !== png.rgba[i]) diff++;
    expect(diff).toBe(0);
    // Sanity: something lit, something black (fog), something dark.
    const px = (x: number, y: number): number[] => [
      ...png.rgba.subarray((y * 300 + x) * 4, (y * 300 + x) * 4 + 3),
    ];
    expect(px(285, 285)).toEqual([0, 0, 0]);
    expect(px(75, 165)[0]).toBeGreaterThan(px(30, 280)[0]!);
  });

  it('print pages render the scene too', async () => {
    const snapshot = buildSnapshot(mapDoc(), extent, [], undefined, {
      view: scene,
      content: ALL,
    }).snapshot;
    const out = collector();
    const result = await runExport(
      snapshot,
      { ...options, print: { ...DEFAULT_PRINT, mmPerCell: 25, marginMm: 10 } },
      {
        images: noTiles,
        tokenImages: await images(),
        createSurface: surfaces,
        sink: out.sink,
        signal: new AbortController().signal,
      },
    );
    expect(result.files).toBeGreaterThan(1);
    expect(Buffer.from(out.bytes()).readUInt32LE(0)).toBe(0x04034b50);
  });
});

describe('export form with a scene', () => {
  it('shows the scene options only with a scene; defaults tokens on, lighting / fog off', () => {
    const view = mapDoc();
    const base = { view, name: 'Nuit', selection: null, viewport: null };
    const plain = evaluateForm(defaultForm(base), base);
    expect(plain.hasScene).toBe(false);
    expect(plain.options).not.toHaveProperty('scene');
    const withScene = { ...base, scene: fakeScene([]) };
    const form = defaultForm(withScene);
    expect([form.tokens, form.lighting, form.fog]).toEqual([true, false, false]);
    const ev = evaluateForm({ ...form, lighting: true }, withScene);
    expect(ev.hasScene).toBe(true);
    expect(ev.options?.scene).toEqual({ tokens: true, lighting: true, fog: false });
    // No tile layer and no grid: the objects are still exported.
    const empty = evaluateForm(
      { ...form, grid: false, layers: { ground: false, terrain: false, decor: false } },
      withScene,
    );
    expect(empty.errors).toEqual([]);
  });
});
