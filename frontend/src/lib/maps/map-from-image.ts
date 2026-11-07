/**
 * P14 "new map from an image": once the map is created with the size computed from the image
 * (editor/images/calibration.ts mapFromImage), its background image object is added on the first
 * floor (locked, placement background) and the map is read again.
 */
import type { ImageGeometry, ImageObject } from '../../editor/contracts-images';
import { newClientOpId } from '../../editor/sync/OpsQueue';
import { newObjectUid } from '../../editor/util/uid';
import type { MapDetail } from '../types';
import type { MapsClient } from './maps-client';

/** The background object of a new map. */
export function backgroundObject(
  floor: string,
  assetId: string,
  geometry: ImageGeometry,
): ImageObject {
  return {
    uid: newObjectUid(),
    floor,
    type: 'image',
    layer: 'props',
    geometry,
    props: { asset_id: assetId, opacity: 1, flip_h: false, flip_v: false, placement: 'background' },
    visibility: 'all',
    locked: true,
    sort_order: -1000,
    rev: 1,
  };
}

/** Adds the background image to a map just created; returns the map read again. */
export async function addBackground(
  client: Pick<MapsClient, 'sendOps' | 'get'>,
  map: MapDetail,
  assetId: string,
  geometry: ImageGeometry,
): Promise<MapDetail> {
  const floor = map.floors[0]?.id;
  if (floor === undefined) return map;
  await client.sendOps(map.id, {
    base_revision: map.revision,
    client_op_id: newClientOpId(),
    ops: [{ type: 'object.add', object: backgroundObject(floor, assetId, geometry) }],
  });
  return client.get(map.id);
}
