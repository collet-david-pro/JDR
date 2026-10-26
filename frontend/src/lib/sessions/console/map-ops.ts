/**
 * Map ops of the GM console (POST /maps/{id}/ops, like the editor; the server then broadcasts
 * `map.ops` / `map.ops.public`): placing, hiding and removing tokens.
 */
import type { MapOp, PlacedToken, TokenDefView } from '../../../editor/contracts';
import { tokenCentre } from '../../../editor/tools/token';
import type { MapsClient } from '../../maps/maps-client';
import type { WireMapOp } from '../../types';
import { newClientOpId } from '../op-id';

export type OpsSender = Pick<MapsClient, 'sendOps'>;

/** Placed token of `def` whose top-left cell is (cx, cy), kept inside the map. */
export function newPlacedToken(
  def: Pick<TokenDefView, 'id' | 'sizeW' | 'sizeH'>,
  uid: string,
  floor: string,
  cx: number,
  cy: number,
  grid: { readonly width: number; readonly height: number },
  hidden = false,
): PlacedToken {
  const [x, y] = tokenCentre(def, cx, cy, grid.width, grid.height);
  return {
    uid,
    floor,
    token_id: def.id,
    x,
    y,
    rotation: 0,
    scale: 1,
    hidden,
    light_override: null,
    rev: 1,
  };
}

export const addTokenOp = (token: PlacedToken): MapOp => ({ type: 'maptoken.add', token });
export const removeTokenOp = (uid: string): MapOp => ({ type: 'maptoken.remove', uid });
export const hideTokenOp = (token: PlacedToken, hidden: boolean): MapOp => ({
  type: 'maptoken.update',
  uid: token.uid,
  rev: token.rev,
  patch: { hidden },
});

/** Sends ops as the GM; resolves with the new map revision. */
export async function sendMapOps(
  maps: OpsSender,
  mapId: string,
  revision: number,
  ops: readonly MapOp[],
): Promise<number> {
  const result = await maps.sendOps(mapId, {
    base_revision: revision,
    client_op_id: newClientOpId(),
    ops: ops as readonly WireMapOp[],
  });
  return result.revision;
}
