import { describe, expect, it } from 'vitest';
import { skinAssetIds } from '../../src/editor/images/skins';
import { newWall } from '../../src/editor/tools/object-common';
import { door, makeSceneDoc, wall } from './scene-helpers';
import { settings } from './helpers';

describe('wall textures and door images', () => {
  it('lists the assets an object references', () => {
    const w = wall('w', [
      [0, 0],
      [3, 0],
    ]);
    expect(skinAssetIds(w)).toEqual([]);
    const textured = { ...w, props: { ...w.props, texture_asset: '12' } };
    expect(skinAssetIds(textured)).toEqual(['12']);
    const d = door('d', [0, 0], [1, 0]);
    expect(
      skinAssetIds({ ...d, props: { ...d.props, asset_open: '3', asset_closed: '4' } }),
    ).toEqual(['3', '4']);
  });

  it('a new wall carries the texture chosen in the tool options', () => {
    const ctx = {
      settings: settings({ wallTexture: '9' }),
      doc: { floor: 'f1' },
      newUid: () => 'u1',
    } as never;
    const created = newWall(
      ctx,
      [
        [0, 0],
        [2, 0],
      ],
      false,
    );
    expect(created.props.texture_asset).toBe('9');
  });

  it('the document keeps the texture and door images of an added object, and a bad id is dropped', () => {
    const doc = makeSceneDoc();
    const w = wall('w', [
      [0, 0],
      [3, 0],
    ]);
    const d = door('d', [0, 0], [1, 0]);
    doc.apply([
      { type: 'object.add', object: { ...w, props: { ...w.props, texture_asset: '12' } } },
      {
        type: 'object.add',
        object: { ...d, props: { ...d.props, asset_closed: '4', asset_open: 'x' } },
      },
    ]);
    expect(doc.object('w')!.props).toMatchObject({ texture_asset: '12' });
    expect(doc.object('d')!.props).toMatchObject({ asset_closed: '4', asset_open: null });
  });
});
