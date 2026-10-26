import { describe, expect, it } from 'vitest';
import type {
  MapObject,
  PlacedToken,
  SceneChangedEvent,
  TokenDefView,
} from '../../src/editor/contracts';
import { FOG_RAW_BYTES, createFogBitmap, setFogBit } from '../../src/formats/fog-codec';
import {
  FOG_TEXTURE_BYTES,
  fogFrame,
  fogPixels,
  mapChunkKeys,
} from '../../src/engine/scene/fog-pixels';
import { isOccluder, planSceneChange, type PlanContext } from '../../src/engine/scene/scene-diff';
import { DARK_SOURCE_PREFIX, ViewerSet } from '../../src/engine/scene/viewers';
import { isSceneOverlay, tokenCorners } from '../../src/engine/overlay-scene';
import { door, light, square, token, tokenDef, wall } from './scene-fixtures';

function event(partial: Partial<SceneChangedEvent>): SceneChangedEvent {
  return { objects: [], tokens: [], fog: [], ambient: false, tokenDefs: false, ...partial };
}

function context(
  prev: { objects?: MapObject[]; tokens?: PlacedToken[] },
  next: { objects?: MapObject[]; tokens?: PlacedToken[] },
  extra: Partial<PlanContext> = {},
  def: TokenDefView | null = tokenDef(),
): PlanContext {
  const find =
    <T extends { uid: string }>(list: T[] | undefined) =>
    (uid: string) =>
      list?.find((o) => o.uid === uid);
  return {
    prevObject: find(prev.objects),
    nextObject: find(next.objects),
    prevToken: find(prev.tokens),
    nextToken: find(next.tokens),
    tokenDef: () => def,
    viewers: new Set(),
    followed: new Set(),
    ...extra,
  };
}

describe('incremental scene updates', () => {
  it('opening a door recomputes lights and vision, redrawing only that door', () => {
    const closed = door('d', [0, 0], [1, 0]);
    const open = door('d', [0, 0], [1, 0], { state: 'open' });
    const plan = planSceneChange(
      event({ objects: ['d', 'd'] }),
      context({ objects: [closed] }, { objects: [open] }),
    );
    expect(plan).toMatchObject({
      redrawObjects: ['d'],
      removeObjects: [],
      occluders: true,
      lights: true,
      vision: true,
      tokenVisibility: true,
    });
  });

  it('a moved light recomputes lights but not the occluders', () => {
    const plan = planSceneChange(
      event({ objects: ['l'] }),
      context({ objects: [light('l', 0, 0)] }, { objects: [light('l', 1, 0)] }),
    );
    expect(plan).toMatchObject({ occluders: false, lights: true, vision: false });
  });

  it('removed objects are removed, unchanged ones skipped', () => {
    const w = wall('w', [
      [0, 0],
      [1, 0],
    ]);
    const removed = planSceneChange(event({ objects: ['w'] }), context({ objects: [w] }, {}));
    expect(removed.removeObjects).toEqual(['w']);
    expect(removed.occluders).toBe(true);
    const same = planSceneChange(
      event({ objects: ['w'] }),
      context({ objects: [w] }, { objects: [w] }),
    );
    expect(same).toMatchObject({ redrawObjects: [], occluders: false, lights: false });
    expect(isOccluder(light('l', 0, 0))).toBe(false);
    expect(isOccluder(w)).toBe(true);
  });

  it('a token without light or vision moving recomputes nothing', () => {
    const plan = planSceneChange(
      event({ tokens: ['t'] }),
      context({ tokens: [token('t', 0, 0)] }, { tokens: [token('t', 1, 0)] }),
    );
    expect(plan).toMatchObject({
      redrawTokens: ['t'],
      lights: false,
      vision: false,
      occluders: false,
      tokenVisibility: true,
    });
  });

  it('a viewer, a token with a light or a followed token trigger recomputations', () => {
    const before = { tokens: [token('t', 0, 0)] };
    const after = { tokens: [token('t', 2, 0)] };
    const viewer = planSceneChange(
      event({ tokens: ['t'] }),
      context(before, after, { viewers: new Set(['t']) }),
    );
    expect(viewer).toMatchObject({ vision: true, lights: false });
    const followed = planSceneChange(
      event({ tokens: ['t'] }),
      context(before, after, { followed: new Set(['t']) }),
    );
    expect(followed.lights).toBe(true);
    const lit = tokenDef({
      light: { radius: 1, dim_radius: 3, color: '#ffffff', intensity: 1, flicker: false },
    });
    expect(planSceneChange(event({ tokens: ['t'] }), context(before, after, {}, lit)).lights).toBe(
      true,
    );
    const removed = planSceneChange(event({ tokens: ['t'] }), context(before, {}));
    expect(removed.removeTokens).toEqual(['t']);
  });

  it('token definitions redraw every token; ambient only rebuilds the visibility', () => {
    const defs = planSceneChange(event({ tokenDefs: true }), context({}, {}));
    expect(defs).toMatchObject({ allTokens: true, lights: true, vision: true });
    const amb = planSceneChange(event({ ambient: true, fog: ['0:0', '0:0'] }), context({}, {}));
    expect(amb).toMatchObject({ ambient: true, vision: false, lights: false });
    expect(amb.tokenVisibility).toBe(true);
    expect(amb.fog).toEqual(['0:0']);
  });
});

describe('fog textures', () => {
  it('turns bitmaps into premultiplied white masks', () => {
    const bits = createFogBitmap();
    setFogBit(bits, 0, 0);
    setFogBit(bits, 9, 1);
    for (let i = 0; i < 8; i++) setFogBit(bits, 16 + i, 0); // a full byte
    const explored = fogPixels(bits, 'explored');
    expect(explored.length).toBe(FOG_TEXTURE_BYTES);
    expect(Array.from(explored.slice(0, 8))).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
    expect(explored[(128 + 9) * 4 + 3]).toBe(255);
    expect(explored[(16 + 7) * 4]).toBe(255);
    expect(explored[24 * 4]).toBe(0);
    const veil = fogPixels(bits, 'unexplored');
    expect(veil[3]).toBe(0);
    expect(veil[7]).toBe(255);
    expect(fogPixels(null, 'unexplored').every((v) => v === 255)).toBe(true);
    expect(fogPixels(new Uint8Array(FOG_RAW_BYTES - 1), 'explored').every((v) => v === 0)).toBe(
      true,
    );
  });

  it('crops edge chunks to the map and lists every chunk', () => {
    expect(fogFrame(0, 0, 40, 40)).toEqual({ w: 128, h: 128 });
    expect(fogFrame(1, 0, 40, 40)).toEqual({ w: 32, h: 128 });
    expect(fogFrame(2, 0, 40, 40).w).toBe(0);
    expect(mapChunkKeys(40, 20)).toEqual(['0:0', '1:0']);
  });
});

describe('viewers', () => {
  it('keeps tokens with vision and adds darkvision sources', () => {
    const set = new ViewerSet();
    const tokens = [token('a', 1, 1), token('b', 2, 2, { token_id: 'blind' }), token('c', 3, 3)];
    const defs: Record<string, TokenDefView> = {
      def: tokenDef({ vision: { enabled: true, range: 8, dark: 20 } }),
      blind: tokenDef({ id: 'blind', vision: { enabled: false, range: 8, dark: 0 } }),
    };
    const infos = set.collect(
      ['a', 'b', 'missing'],
      (uid) => tokens.find((t) => t.uid === uid),
      (id) => defs[id] ?? null,
    );
    expect(infos).toEqual([{ uid: 'a', x: 1, y: 1, range: 8, dark: 8 }]);
    const sources = ViewerSet.sources(infos);
    expect(sources.map((s) => s.id)).toEqual(['a', DARK_SOURCE_PREFIX + 'a']);
    set.update(
      infos,
      new Map([
        ['a', square(1, 1, 8)],
        [DARK_SOURCE_PREFIX + 'a', square(1, 1, 8)],
      ]),
    );
    expect(set.visible()).toHaveLength(1);
    expect(set.visible()[0]).toMatchObject({ uid: 'a', dark: 8 });
    expect(set.darkPolygons()).toHaveLength(1);
    set.clear();
    expect(set.visible()).toEqual([]);
  });
});

describe('P5 overlays', () => {
  it('recognises the scene overlays', () => {
    expect(isSceneOverlay({ kind: 'snap', x: 0, y: 0 })).toBe(true);
    expect(isSceneOverlay({ kind: 'objects', objects: [], tokens: [] })).toBe(true);
    expect(isSceneOverlay({ kind: 'rect', x: 0, y: 0, w: 1, h: 1 })).toBe(false);
    expect(isSceneOverlay({ kind: 'group', items: [] })).toBe(false);
  });

  it('rotates token boxes around their centre', () => {
    expect(tokenCorners(5, 5, 2, 2, 0)).toEqual([
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
    ]);
    const r = tokenCorners(0, 0, 2, 4, 90);
    expect(r[0]![0]).toBeCloseTo(2);
    expect(r[0]![1]).toBeCloseTo(-1);
  });
});
