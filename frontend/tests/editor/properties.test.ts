import { describe, expect, it } from 'vitest';
import {
  common,
  lightPatch,
  selectedScene,
  tokenPatch,
  wallPatch,
} from '../../src/editor/ui/properties';
import { light, makeSceneDoc, placed, wall } from './scene-helpers';

describe('properties panel logic', () => {
  it('keeps radius ≤ dim_radius and clamps values', () => {
    const l = light('l', 1, 1);
    expect(lightPatch(l, { radius: 12 })!.props).toMatchObject({ radius: 12, dim_radius: 12 });
    expect(lightPatch(l, { dim_radius: 2 })!.props).toMatchObject({ radius: 2, dim_radius: 2 });
    expect(lightPatch(l, { intensity: 3 })!.props).toMatchObject({ intensity: 1 });
    expect(
      lightPatch(
        wall('w', [
          [0, 0],
          [1, 0],
        ]),
        { radius: 1 },
      ),
    ).toBeNull();
    expect(
      wallPatch(
        wall('w', [
          [0, 0],
          [1, 0],
        ]),
        { thickness: 9 },
      )!.props,
    ).toMatchObject({
      thickness: 2,
    });
    expect(tokenPatch({ rotation: -90, scale: 9 })).toEqual({ rotation: 270, scale: 4 });
  });

  it('multi-selection: shared type and common values', () => {
    const doc = makeSceneDoc();
    doc.apply([
      {
        type: 'object.add',
        object: wall('a', [
          [0, 0],
          [1, 0],
        ]),
      },
      {
        type: 'object.add',
        object: {
          ...wall('b', [
            [0, 1],
            [1, 1],
          ]),
          locked: true,
        },
      },
      { type: 'maptoken.add', token: placed('k', 2.5, 2.5) },
    ]);
    const sel = selectedScene(doc, { objects: ['a', 'b', 'gone'], tokens: ['k'] });
    expect(sel.type).toBe('wall');
    expect(sel.objects).toHaveLength(2);
    expect(common(sel.objects, (o) => o.locked)).toBeUndefined();
    expect(common(sel.objects, (o) => o.layer)).toBe('walls');
  });
});
