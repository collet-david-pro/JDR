/**
 * Incremental update planning (pure): from a SceneChangedEvent and the previously drawn
 * values, which objects / tokens / fog chunks to rebuild, and whether the light polygons or
 * the vision polygons must be recomputed (door opened ⇒ both, token without light moved ⇒
 * neither).
 */

import type {
  ChunkKey,
  MapObject,
  PlacedToken,
  SceneChangedEvent,
  TokenDefView,
} from '../../editor/contracts';

export interface ScenePlan {
  /** Objects to redraw (changed or added) or to remove (gone). */
  readonly redrawObjects: readonly string[];
  readonly removeObjects: readonly string[];
  readonly redrawTokens: readonly string[];
  readonly removeTokens: readonly string[];
  /** Token definitions changed: every token is redrawn. */
  readonly allTokens: boolean;
  readonly fog: readonly ChunkKey[];
  /** Walls / doors / windows changed: the occluders revision must change. */
  readonly occluders: boolean;
  /** Light sources (or their occluders) changed: recompute light polygons. */
  readonly lights: boolean;
  /** Viewers (or their occluders) changed: recompute vision polygons. */
  readonly vision: boolean;
  /**
   * The VisibleScene (and the player-view token visibility) must be rebuilt: vision, lights,
   * ambient (darkness rule) or tokens changed.
   */
  readonly tokenVisibility: boolean;
  readonly ambient: boolean;
}

export interface PlanContext {
  readonly prevObject: (uid: string) => MapObject | undefined;
  readonly nextObject: (uid: string) => MapObject | undefined;
  readonly prevToken: (uid: string) => PlacedToken | undefined;
  readonly nextToken: (uid: string) => PlacedToken | undefined;
  readonly tokenDef: (id: string) => TokenDefView | null;
  /** Placed-token uids used as viewers. */
  readonly viewers: ReadonlySet<string>;
  /** Token uids followed by a light object. */
  readonly followed: ReadonlySet<string>;
}

export function isOccluder(obj: MapObject | undefined): boolean {
  return obj !== undefined && obj.type !== 'light';
}

function hasLight(t: PlacedToken | undefined, def: (id: string) => TokenDefView | null): boolean {
  if (t === undefined) return false;
  const light = t.light_override ?? def(t.token_id)?.light ?? null;
  return light !== null && light.dim_radius > 0;
}

export function planSceneChange(event: SceneChangedEvent, ctx: PlanContext): ScenePlan {
  const redrawObjects: string[] = [];
  const removeObjects: string[] = [];
  const redrawTokens: string[] = [];
  const removeTokens: string[] = [];
  let occluders = false;
  let lights = event.tokenDefs;
  let vision = event.tokenDefs;
  let tokenVisibility = event.tokenDefs;

  for (const uid of new Set(event.objects)) {
    const prev = ctx.prevObject(uid);
    const next = ctx.nextObject(uid);
    if (prev === next) continue;
    if (next === undefined) removeObjects.push(uid);
    else redrawObjects.push(uid);
    if (isOccluder(prev) || isOccluder(next)) occluders = true;
    if (prev?.type === 'light' || next?.type === 'light') lights = true;
  }

  for (const uid of event.tokenDefs ? [] : new Set(event.tokens)) {
    const prev = ctx.prevToken(uid);
    const next = ctx.nextToken(uid);
    if (prev === next) continue;
    if (next === undefined) removeTokens.push(uid);
    else redrawTokens.push(uid);
    tokenVisibility = true;
    if (ctx.viewers.has(uid)) vision = true;
    if (ctx.followed.has(uid) || hasLight(prev, ctx.tokenDef) || hasLight(next, ctx.tokenDef)) {
      lights = true;
    }
  }

  if (occluders) {
    lights = true;
    vision = true;
  }
  return {
    redrawObjects,
    removeObjects,
    redrawTokens,
    removeTokens,
    allTokens: event.tokenDefs,
    fog: [...new Set(event.fog)],
    occluders,
    lights,
    vision,
    tokenVisibility: tokenVisibility || vision || lights || event.ambient,
    ambient: event.ambient,
  };
}
