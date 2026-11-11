import { describe, expect, it } from 'vitest';
import type { ImageObject } from '../src/editor/contracts-images';
import { imageProps } from '../src/editor/model/image-values';
import {
  tileGeometry,
  tileGroupOf,
  tileObjects,
  tiledOfGroup,
  type TiledImage,
} from '../src/editor/images/tiles';

const tiled: TiledImage = {
  group: 'grp1',
  width: 5000,
  height: 4100,
  parts: [
    { assetId: '1', rect: { x: 0, y: 0, w: 4096, h: 4096 } },
    { assetId: '2', rect: { x: 4095, y: 0, w: 905, h: 4096 } },
    { assetId: '3', rect: { x: 0, y: 4095, w: 4096, h: 5 } },
    { assetId: '4', rect: { x: 4095, y: 4095, w: 905, h: 5 } },
  ],
};
const whole = { x: 2, y: 3, w: 50, h: 41, rotation: 0 };

describe('tile geometry', () => {
  it('places the pieces edge to edge inside the whole rectangle', () => {
    const uids = ['a', 'b', 'c', 'd'];
    const objects = tileObjects('f1', whole, tiled, () => uids.shift()!);
    expect(objects).toHaveLength(4);
    const right = objects[1]!.geometry;
    expect(right.x + right.w).toBeCloseTo(52, 3);
    const bottom = objects[2]!.geometry;
    expect(bottom.y + bottom.h).toBeCloseTo(44, 3);
    // neighbours overlap by the one source pixel (0.01 cell here)
    expect(objects[0]!.geometry.x + objects[0]!.geometry.w).toBeGreaterThan(right.x);
    for (const o of objects) {
      expect(o.props.placement).toBe('background');
      expect(o.locked).toBe(true);
      expect(o.props.tile?.group).toBe('grp1');
    }
  });

  it('scales with the whole rectangle', () => {
    const g = tileGeometry(
      { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      { x: 0, y: 0, w: 50, h: 100, tw: 100, th: 100 },
    );
    expect(g).toEqual({ x: 0, y: 0, w: 5, h: 10, rotation: 0 });
  });

  it('rebuilds the whole picture from its pieces', () => {
    const objects = tileObjects('f1', whole, tiled);
    const { tile: _tile, ...plain } = objects[0]!.props;
    const other: ImageObject = { ...objects[0]!, uid: 'solo', props: plain };
    const members = tileGroupOf([...objects, other], objects[2]!);
    expect(members).toHaveLength(4);
    expect(tileGroupOf([...objects, other], other)).toEqual([other]);
    const back = tiledOfGroup(members)!;
    expect(back.tiled.group).toBe('grp1');
    expect(back.tiled.width).toBe(5000);
    expect(back.tiled.height).toBe(4100);
    expect(back.geometry.x).toBeCloseTo(2, 2);
    expect(back.geometry.w).toBeCloseTo(50, 2);
    expect(back.geometry.h).toBeCloseTo(41, 2);
  });
});

describe('imageProps tile', () => {
  const base = { asset_id: '7', opacity: 1, flip_h: false, flip_v: false, placement: 'background' };
  const tile = { group: 'g_1-x', x: 0, y: 0, w: 10, h: 10, tw: 20, th: 10 };

  it('keeps a valid tile and stays optional', () => {
    expect(imageProps({ ...base, tile }).tile).toEqual(tile);
    expect(imageProps(base).tile).toBeUndefined();
  });

  it('refuses a malformed tile', () => {
    expect(() => imageProps({ ...base, tile: { ...tile, group: 'a b' } })).toThrow();
    expect(() => imageProps({ ...base, tile: { ...tile, w: 11, tw: 10 } })).toThrow();
    expect(() => imageProps({ ...base, tile: { ...tile, x: -1 } })).toThrow();
    expect(() => imageProps({ ...base, tile: { ...tile, h: 1.5 } })).toThrow();
  });
});
