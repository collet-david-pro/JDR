import type { MapObject } from '../contracts';

/** Assets an object references: the picture of an image, the texture of a wall, the images of a door. */
export function skinAssetIds(o: MapObject): string[] {
  const ids =
    o.type === 'image'
      ? [o.props.asset_id]
      : o.type === 'wall'
        ? [o.props.texture_asset]
        : o.type === 'door'
          ? [o.props.asset_open, o.props.asset_closed]
          : [];
  return ids.filter((id): id is string => typeof id === 'string' && id !== '');
}
