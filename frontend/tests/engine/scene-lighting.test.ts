import { describe, expect, it } from 'vitest';
import type { Ambient, VisibleScene } from '../../src/editor/contracts';
import { GM_DARKNESS_SCALE, SHADOW_LENGTH_PER_HEIGHT } from '../../src/scene/style';
import { AMBIENT_TRANSITION_MS } from '../../src/vision/ambient';
import { TOKEN_FLICKER, flickerFactor, hashSeed } from '../../src/vision/flicker';
import {
  AmbientAnimator,
  NEUTRAL_AMBIENT,
  isNeutral,
  rgbToHex,
  viewAmbient,
} from '../../src/engine/scene/ambient-state';
import {
  PROFILE_STEPS,
  TOKEN_LIGHT_PREFIX,
  circleIntersectsRect,
  collectLights,
  fanGeometry,
  isFlickering,
  lightLevel,
  meanFlicker,
  nearestLights,
  needsFlickerFrames,
  profileIndex,
  profileValue,
  scaledColor,
  type LightSource,
} from '../../src/engine/scene/lights';
import { shadowQuads, shadowSegments } from '../../src/engine/scene/shadows';
import {
  BRIGHT_DARKNESS,
  EmitThrottle,
  lightLimited,
  pointInPolygon,
  pointVisible,
} from '../../src/engine/scene/visibility';
import { door, light, square, token, tokenDef, wall } from './scene-fixtures';

const torch = { type: 'torch', amp: 0.4, speed: 2 } as const;

function src(id: string, x: number, y: number, extra: Partial<LightSource> = {}): LightSource {
  return {
    id,
    x,
    y,
    radius: 1,
    dim: 3,
    color: 0xffffff,
    intensity: 1,
    flicker: { type: 'none', amp: 0, speed: 1 },
    cone: null,
    seed: 1,
    ...extra,
  };
}

describe('light sources', () => {
  it('collects light objects (following tokens) and token lights', () => {
    const def = tokenDef({
      light: { radius: 2, dim_radius: 5, color: '#00ff00', intensity: 0.5, flicker: true },
    });
    const t1 = token('t1', 4, 4);
    const t2 = token('t2', 6, 6, {
      light_override: { radius: 1, dim_radius: 2, color: '#0000ff', intensity: 1, flicker: false },
    });
    const hiddenTok = token('t3', 8, 8, { hidden: true });
    const objects = [
      light('a', 1, 1, { follows_token: 't1', flicker: torch }),
      light('b', 2, 2, { enabled: false }),
      light('c', 3, 3, { radius: 9, dim_radius: 4 }),
      wall('w', [
        [0, 0],
        [1, 0],
      ]),
    ];
    const tokens = [t1, t2, hiddenTok];
    const find = (uid: string) => tokens.find((t) => t.uid === uid);
    const gm = collectLights(objects, tokens, find, () => def, 'gm');
    expect(gm.map((l) => l.id)).toEqual(['a', 'c', 'token:t1', 'token:t2', 'token:t3']);
    expect(gm[0]).toMatchObject({ x: 4, y: 4, color: 0xff8800, seed: hashSeed('a') });
    // radius never exceeds dim_radius.
    expect(gm[1]).toMatchObject({ radius: 4, dim: 4 });
    expect(gm[2]).toMatchObject({ color: 0x00ff00, intensity: 0.5, flicker: TOKEN_FLICKER });
    expect(gm[3]).toMatchObject({ color: 0x0000ff, dim: 2, cone: null });
    expect(gm[3]!.flicker.type).toBe('none');
    const player = collectLights(objects, tokens, find, () => def, 'player');
    expect(player.map((l) => l.id)).not.toContain(TOKEN_LIGHT_PREFIX + 't3');
  });

  it('flickers deterministically, frozen at the mean intensity', () => {
    const l = src('l', 0, 0, { flicker: torch, intensity: 0.8, seed: 42 });
    expect(isFlickering(l)).toBe(true);
    expect(isFlickering(src('n', 0, 0))).toBe(false);
    expect(lightLevel(l, 1234, false)).toBeCloseTo(0.8 * flickerFactor(torch, 42, 1234));
    expect(lightLevel(l, 1234, true)).toBeCloseTo(0.8 * (1 - 0.2));
    expect(lightLevel(l, 99, true)).toBe(lightLevel(l, 5000, true));
    expect(meanFlicker({ type: 'none', amp: 1, speed: 1 })).toBe(1);
  });

  it('animates only for flickering lights in view, lighting on, not frozen', () => {
    const rect = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const near = src('a', 5, 5, { flicker: torch });
    const far = src('b', 50, 50, { flicker: torch });
    const still = src('c', 5, 5);
    const on = { lighting: true, frozen: false };
    expect(needsFlickerFrames([near], rect, on)).toBe(true);
    expect(needsFlickerFrames([far, still], rect, on)).toBe(false);
    expect(needsFlickerFrames([near], rect, { lighting: false, frozen: false })).toBe(false);
    expect(needsFlickerFrames([near], rect, { lighting: true, frozen: true })).toBe(false);
    expect(circleIntersectsRect(12, 5, 2.5, rect)).toBe(true);
    expect(circleIntersectsRect(13, 13, 3, rect)).toBe(false);
  });

  it('picks the nearest lights for shadows (distance to their outer circle)', () => {
    const lights = [src('a', 10, 0, { dim: 9 }), src('b', 3, 0, { dim: 1 }), src('c', 30, 0)];
    expect(nearestLights(lights, 0, 0, 2).map((l) => l.id)).toEqual(['a', 'b']);
    expect(nearestLights(lights, 0, 0, 0)).toEqual([]);
  });

  it('scales colours and builds the radial profile', () => {
    expect(scaledColor(0xff8040, 0.5)).toBe(0x804020);
    expect(scaledColor(0xffffff, 2)).toBe(0xffffff);
    expect(profileIndex(2, 4)).toBe(PROFILE_STEPS / 2);
    expect(profileIndex(5, 0)).toBe(0);
    expect(profileValue(0.5, 0.3)).toBe(1);
    expect(profileValue(0.5, 0.75)).toBeCloseTo(0.5);
    expect(profileValue(0.5, 1)).toBe(0);
  });

  it('builds a triangle fan with uvs spanning the outer circle', () => {
    const fan = fanGeometry(square(5, 5, 2), 5, 5, 2, 10);
    expect(fan).not.toBeNull();
    expect(Array.from(fan!.positions.slice(0, 4))).toEqual([50, 50, 30, 30]);
    expect(Array.from(fan!.uvs.slice(0, 4))).toEqual([0.5, 0.5, 0, 0]);
    expect(Array.from(fan!.indices)).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]);
    expect(fanGeometry(new Float32Array([0, 0, 1, 1]), 0, 0, 1, 1)).toBeNull();
  });
});

describe('shadows', () => {
  it('casts from light-blocking walls and closed doors only', () => {
    const segs = shadowSegments(
      [
        wall('w', [
          [0, 0],
          [2, 0],
          [2, 2],
        ]),
        wall(
          'n',
          [
            [0, 0],
            [1, 0],
          ],
          { blocks_light: false },
        ),
        wall(
          'i',
          [
            [0, 0],
            [1, 0],
          ],
          { kind: 'invisible' },
        ),
        wall(
          'h',
          [
            [0, 0],
            [1, 0],
          ],
          { height: 3 },
        ),
        door('d', [5, 0], [6, 0]),
        door('o', [5, 0], [6, 0], { state: 'open' }),
        door('s', [5, 0], [6, 0], { state: 'open', secret: true }),
      ],
      'player',
    );
    expect(segs.map((s) => s.height)).toEqual([1, 1, 3, 1, 1]);
  });

  it('projects quads away from the light, bounded by its outer radius', () => {
    const quads = shadowQuads({ x: 0, y: 0, dim: 10 }, [{ seg: [-1, 2, 1, 2], height: 1 }]);
    expect(quads).toHaveLength(1);
    const q = Array.from(quads[0]!);
    expect(q.slice(0, 4)).toEqual([-1, 2, 1, 2]);
    const len = Math.hypot(q[4]! - 1, q[5]! - 2);
    expect(len).toBeCloseTo(SHADOW_LENGTH_PER_HEIGHT);
    expect(q[5]!).toBeGreaterThan(2);
    // Out of range, or the light on the segment line: no shadow.
    expect(shadowQuads({ x: 0, y: 0, dim: 1 }, [{ seg: [-1, 2, 1, 2], height: 1 }])).toEqual([]);
    expect(shadowQuads({ x: 3, y: 2, dim: 9 }, [{ seg: [-1, 2, 1, 2], height: 1 }])).toEqual([]);
    const short = shadowQuads({ x: 0, y: 0, dim: 2.5 }, [{ seg: [-1, 2, 1, 2], height: 4 }]);
    const sq = Array.from(short[0]!);
    expect(Math.hypot(sq[4]!, sq[5]!)).toBeCloseTo(2.5);
  });
});

describe('visibility rule', () => {
  const viewer = { uid: 'v', x: 0, y: 0, polygon: square(0, 0, 10), dark: 2 };
  const scene = (darkness: number, lights: VisibleScene['lights'] = []): VisibleScene => ({
    floor: '1',
    sceneRevision: 1,
    darkness,
    viewers: [viewer],
    lights,
  });

  it('tests points in polygons', () => {
    expect(pointInPolygon(square(0, 0, 1), 0.5, 0.5)).toBe(true);
    expect(pointInPolygon(square(0, 0, 1), 1.5, 0)).toBe(false);
  });

  it('sees everything in the polygon in bright light', () => {
    expect(pointVisible(scene(BRIGHT_DARKNESS - 0.01), 8, 8)).toBe(true);
    expect(pointVisible(scene(0), 11, 0)).toBe(false);
    expect(lightLimited(0.29)).toBe(false);
    expect(lightLimited(0.3)).toBe(true);
  });

  it('needs light or darkvision in the dark', () => {
    const lit = scene(0.8, [{ x: 6, y: 6, polygon: square(6, 6, 2), dimRadius: 2 }]);
    expect(pointVisible(lit, 1, 1)).toBe(true); // darkvision 2
    expect(pointVisible(lit, 5, 0)).toBe(false);
    expect(pointVisible(lit, 6.5, 6.5)).toBe(true);
    expect(pointVisible(lit, 7.9, 7.9)).toBe(false); // in the polygon, beyond dimRadius
  });

  it('throttles emissions to one per interval', () => {
    const t = new EmitThrottle(100);
    expect(t.delay(1000)).toBe(0);
    t.mark(1000);
    expect(t.delay(1030)).toBe(70);
    expect(t.delay(1100)).toBe(0);
    t.reset();
    expect(t.delay(1001)).toBe(0);
  });
});

describe('ambient', () => {
  const amb = (darkness: number, tint = '#000000'): Ambient => ({
    darkness,
    tint,
    time_of_day: null,
    weather: { type: 'none', intensity: 0 },
  });

  it('jumps on the first scene and animates later changes over 2 s', () => {
    const a = new AmbientAnimator();
    a.set(amb(0.8), 0, false);
    expect(a.at(0).darkness).toBeCloseTo(0.8);
    expect(a.active(0)).toBe(false);
    a.set(amb(0.2), 1000, true);
    expect(a.active(1000)).toBe(true);
    expect(a.at(1000).darkness).toBeCloseTo(0.8);
    expect(a.at(1000 + AMBIENT_TRANSITION_MS / 2).darkness).toBeCloseTo(0.5);
    expect(a.at(1000 + AMBIENT_TRANSITION_MS).darkness).toBeCloseTo(0.2);
    expect(a.active(1000 + AMBIENT_TRANSITION_MS)).toBe(false);
    expect(a.target.darkness).toBeCloseTo(0.2);
    // Same target: no new transition.
    a.set(amb(0.2), 5000, true);
    expect(a.active(5000)).toBe(false);
  });

  it('scales the darkness in the GM view and is neutral without lighting', () => {
    const e = { darkness: 0.5, tint: [0.5, 1, 1] as [number, number, number] };
    const gm = viewAmbient(e, 'gm', true);
    expect(gm.darkness).toBeCloseTo(0.5 * GM_DARKNESS_SCALE);
    expect(gm.tint[0]).toBeCloseTo(1 - 0.5 * GM_DARKNESS_SCALE);
    expect(viewAmbient(e, 'player', true)).toBe(e);
    expect(viewAmbient(e, 'player', false)).toBe(NEUTRAL_AMBIENT);
    expect(isNeutral(NEUTRAL_AMBIENT)).toBe(true);
    expect(isNeutral(e)).toBe(false);
    expect(rgbToHex([1, 0.5, 0])).toBe(0xff8000);
  });
});
