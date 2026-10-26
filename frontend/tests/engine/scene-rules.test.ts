import { describe, expect, it } from 'vitest';
import type { LayerDef } from '../../src/editor/contracts';
import { HIDDEN_TOKEN_ALPHA, SLIDE_OFFSET, SLIDE_OPEN_FRACTION } from '../../src/scene/style';
import {
  doorShape,
  initials,
  lightPosition,
  objectHandles,
  parseColor,
  polylineSegments,
  strokeWidthPx,
  tokenBox,
  tokenRingColor,
  zoomBucket,
} from '../../src/engine/scene/object-geometry';
import {
  DEFAULT_VIEW,
  GM_HIDDEN_OBJECT_ALPHA,
  doorDrawnAsWall,
  lightIncluded,
  mergeView,
  needsVisibility,
  objectAlpha,
  objectLayerOrder,
  objectLayerState,
  objectShown,
  tokenAlpha,
  tokenShown,
  viewerKind,
  viewsEqual,
} from '../../src/engine/scene/view-rules';
import { RENDER_PIPELINE, WORLD_LAYERS, pipelineIndex } from '../../src/engine/scene/pipeline';
import { door, light, token, tokenDef, wall } from './scene-fixtures';

describe('view options', () => {
  it('defaults to the GM view with lighting and fog, no shadows', () => {
    expect(DEFAULT_VIEW).toEqual({
      mode: 'gm',
      viewers: [],
      lighting: true,
      fog: true,
      shadows: false,
    });
  });

  it('merges patches, ignores invalid values and de-duplicates viewers', () => {
    const v = mergeView(DEFAULT_VIEW, { mode: 'player', viewers: ['a', 'b', 'a', ''] });
    expect(v).toEqual({ ...DEFAULT_VIEW, mode: 'player', viewers: ['a', 'b'] });
    const bad = mergeView(v, { mode: 'nope' as never, shadows: 1 as never });
    expect(bad).toEqual(v);
    expect(viewsEqual(v, mergeView(v, {}))).toBe(true);
    expect(viewsEqual(v, mergeView(v, { fog: false }))).toBe(false);
  });

  it('computes the visibility in player / display views and when exploring', () => {
    expect(needsVisibility(DEFAULT_VIEW)).toBe(false);
    expect(needsVisibility({ ...DEFAULT_VIEW, viewers: ['t'] })).toBe(true);
    expect(needsVisibility({ ...DEFAULT_VIEW, mode: 'display' })).toBe(true);
    expect(viewerKind('gm')).toBe('gm');
    expect(viewerKind('player')).toBe('player');
    expect(viewerKind('display')).toBe('player');
  });
});

describe('GM / player rules', () => {
  const plain = wall('w', [
    [0, 0],
    [2, 0],
  ]);
  const gmLayer = wall(
    'g',
    [
      [0, 0],
      [1, 0],
    ],
    {},
    { layer: 'gm' },
  );
  const hidden = wall(
    'h',
    [
      [0, 0],
      [1, 0],
    ],
    {},
    { visibility: 'hidden_until_revealed' },
  );
  const invisible = wall(
    'i',
    [
      [0, 0],
      [1, 0],
    ],
    { kind: 'invisible' },
  );

  it('shows everything to the GM, fading what players never receive', () => {
    for (const o of [plain, gmLayer, hidden, invisible]) expect(objectShown(o, 'gm')).toBe(true);
    expect(objectAlpha(plain, 'gm')).toBe(1);
    expect(objectAlpha(gmLayer, 'gm')).toBe(GM_HIDDEN_OBJECT_ALPHA);
    expect(objectAlpha(hidden, 'gm')).toBe(GM_HIDDEN_OBJECT_ALPHA);
  });

  it('hides gm objects, invisible walls and light objects from players', () => {
    expect(objectShown(plain, 'player')).toBe(true);
    expect(objectShown(gmLayer, 'player')).toBe(false);
    expect(objectShown(hidden, 'display')).toBe(false);
    expect(objectShown(invisible, 'player')).toBe(false);
    expect(objectShown(light('l', 0, 0), 'player')).toBe(false);
    expect(objectAlpha(gmLayer, 'player')).toBe(1);
  });

  it('draws a secret door as a wall for players only', () => {
    const secret = door('d', [0, 0], [1, 0], { secret: true });
    expect(doorDrawnAsWall(secret, 'gm')).toBe(false);
    expect(doorDrawnAsWall(secret, 'player')).toBe(true);
    expect(doorDrawnAsWall(door('e', [0, 0], [1, 0]), 'player')).toBe(false);
  });

  it('includes enabled lights, gm-only ones in the GM view only', () => {
    expect(lightIncluded(light('a', 0, 0), 'player')).toBe(true);
    expect(lightIncluded(light('b', 0, 0, { enabled: false }), 'gm')).toBe(false);
    expect(lightIncluded(light('c', 0, 0, { dim_radius: 0, radius: 0 }), 'gm')).toBe(false);
    const gmOnly = light('d', 0, 0, {}, { layer: 'gm' });
    expect(lightIncluded(gmOnly, 'gm')).toBe(true);
    expect(lightIncluded(gmOnly, 'player')).toBe(false);
  });

  it('fades hidden tokens for the GM and removes them for players', () => {
    const t = token('t', 1, 1, { hidden: true });
    expect(tokenShown(t, 'gm')).toBe(true);
    expect(tokenAlpha(t, 'gm')).toBe(HIDDEN_TOKEN_ALPHA);
    expect(tokenShown(t, 'player')).toBe(false);
    expect(tokenShown(token('u', 1, 1), 'display')).toBe(true);
  });

  it('applies object layer visibility / opacity and hides the gm layer for players', () => {
    const layers: LayerDef[] = [
      { id: 'ground', kind: 'tiles', visible: true, locked: false, opacity: 1 },
      { id: 'lighting', kind: 'objects', visible: true, locked: false, opacity: 0.5 },
      { id: 'walls', kind: 'objects', visible: false, locked: false, opacity: 1 },
      { id: 'gm', kind: 'objects', visible: true, locked: false, opacity: 1, gmOnly: true },
    ];
    expect(objectLayerState(layers, 'walls', 'gm').visible).toBe(false);
    expect(objectLayerState(layers, 'lighting', 'gm')).toEqual({ visible: true, alpha: 0.5 });
    expect(objectLayerState(layers, 'gm', 'gm').visible).toBe(true);
    expect(objectLayerState(layers, 'gm', 'player').visible).toBe(false);
    expect(objectLayerState(layers, 'props', 'player')).toEqual({ visible: true, alpha: 1 });
    expect(objectLayerOrder(layers)).toEqual(['lighting', 'walls', 'gm', 'props', 'labels']);
  });
});

describe('object geometry', () => {
  it('keeps a minimal on-screen wall width', () => {
    expect(strokeWidthPx(0.2, 70, 1)).toBeCloseTo(14);
    expect(strokeWidthPx(0.05, 70, 0.1)).toBeCloseTo(20); // 2 px / 0.1
    expect(zoomBucket(1)).toBe(1);
    expect(zoomBucket(1.1)).toBe(1);
    expect(zoomBucket(1.5)).toBeCloseTo(Math.SQRT2);
    expect(zoomBucket(0)).toBe(1);
  });

  it('splits polylines into segments (closed adds the last edge)', () => {
    const pts: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 0],
      [2, 2],
    ];
    expect(polylineSegments(pts, false)).toEqual([
      [0, 0, 2, 0],
      [2, 0, 2, 2],
    ]);
    expect(polylineSegments(pts, true)).toHaveLength(3);
    expect(polylineSegments([[1, 1]], true)).toEqual([]);
  });

  it('turns open doors by 90° on the same side for both hinges', () => {
    const closed = door('d', [0, 0], [1, 0]);
    expect(doorShape(closed)).toEqual({ leaf: [0, 0, 1, 0], gap: null });
    const a = doorShape(door('d', [0, 0], [1, 0], { state: 'open', swing: 'a' }));
    expect(a.leaf).toEqual([0, 0, 0, 1]);
    expect(a.gap).toEqual([0, 0, 1, 0]);
    const b = doorShape(door('d', [0, 0], [1, 0], { state: 'open', swing: 'b' }));
    expect(b.leaf).toEqual([1, 0, 1, 1]);
    const s = doorShape(door('d', [0, 0], [2, 0], { state: 'open', swing: 'slide' }));
    expect(s.leaf[0]).toBeCloseTo(2 * SLIDE_OPEN_FRACTION);
    expect(s.leaf[1]).toBeCloseTo(SLIDE_OFFSET);
    expect(s.leaf[2] - s.leaf[0]).toBeCloseTo(2);
  });

  it('sizes tokens, picks the ring colour and initials', () => {
    const def = tokenDef({ sizeW: 2, sizeH: 3 });
    expect(tokenBox(token('t', 0, 0, { scale: 1.5 }), def)).toEqual({ w: 3, h: 4.5 });
    expect(tokenBox(token('t', 0, 0), null)).toEqual({ w: 1, h: 1 });
    expect(tokenRingColor(tokenDef({ ringColor: '#123456' }))).toBe(0x123456);
    expect(tokenRingColor(tokenDef({ ringColor: 'bad' }))).toBe(0xd9453b);
    expect(parseColor('#00ff00')).toBe(0x00ff00);
    expect(initials('Gobelin archer')).toBe('GA');
    expect(initials('  élise  ')).toBe('É');
    expect(initials('Jean-Luc Picard')).toBe('JL');
    expect(initials('')).toBe('');
  });

  it('places edit handles (light radius handle on the dim circle)', () => {
    const l = light('l', 2, 3, { radius: 1, dim_radius: 5 });
    expect(objectHandles(l)).toEqual([
      { kind: 'centre', at: [2, 3] },
      { kind: 'radius', at: [7, 3] },
    ]);
    expect(objectHandles(door('d', [0, 0], [1, 0])).map((h) => h.kind)).toEqual(['end', 'end']);
    expect(
      objectHandles(
        wall('w', [
          [0, 0],
          [1, 0],
          [1, 1],
        ]),
      ),
    ).toHaveLength(3);
  });

  it('moves a light with the token it follows', () => {
    const l = light('l', 1, 1, { follows_token: 't' });
    const t = token('t', 9, 8);
    expect(lightPosition(l, (uid) => (uid === 't' ? t : undefined))).toEqual([9, 8]);
    expect(lightPosition(l, () => undefined)).toEqual([1, 1]);
  });
});

describe('render pipeline', () => {
  it('follows projet.md 14.1 bottom → top', () => {
    const order = [
      'background',
      'tiles',
      'shadows',
      'objects',
      'tokens',
      'lighting',
      'fog',
      'grid',
      'overlay',
    ] as const;
    for (let i = 1; i < order.length; i++) {
      expect(pipelineIndex(order[i]!)).toBeGreaterThan(pipelineIndex(order[i - 1]!));
    }
    expect(new Set(RENDER_PIPELINE).size).toBe(RENDER_PIPELINE.length);
    expect(pipelineIndex('gizmos')).toBeGreaterThan(pipelineIndex('fog'));
    expect(WORLD_LAYERS.has('tokens')).toBe(true);
    expect(WORLD_LAYERS.has('lighting')).toBe(false);
  });
});
