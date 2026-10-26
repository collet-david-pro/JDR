/**
 * Properties panel logic (projet.md 15.2: contextual panel, numeric editing, multi-selection =
 * common properties). Pure functions turning a field change into patches.
 */
import type {
  DoorProps,
  LightProps,
  MapObject,
  MapObjectType,
  ObjectPatch,
  PlacedToken,
  PlacedTokenPatch,
  SceneView,
  TokenLightDef,
  WallProps,
  WindowProps,
} from '../contracts';
import { round3 } from '../model/scene-values';
import type { ObjectSelection } from '../tools/types';

export interface SelectedScene {
  readonly objects: readonly MapObject[];
  readonly tokens: readonly PlacedToken[];
  /** The type shared by every selected object (null: none or mixed). */
  readonly type: MapObjectType | null;
}

export function selectedScene(scene: SceneView, sel: ObjectSelection): SelectedScene {
  const objects = sel.objects
    .map((u) => scene.object(u))
    .filter((o): o is MapObject => o !== undefined);
  const tokens = sel.tokens
    .map((u) => scene.token(u))
    .filter((t): t is PlacedToken => t !== undefined);
  const types = new Set(objects.map((o) => o.type));
  const type = types.size === 1 ? [...types][0]! : null;
  return { objects, tokens, type };
}

/** Value shared by every item, or undefined when they differ (shown as "mixed"). */
export function common<T, V>(items: readonly T[], get: (item: T) => V): V | undefined {
  if (items.length === 0) return undefined;
  const first = get(items[0]!);
  return items.every((i) => JSON.stringify(get(i)) === JSON.stringify(first)) ? first : undefined;
}

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

/** Patch of a wall prop (other types ⇒ null). */
export function wallPatch(o: MapObject, change: Partial<WallProps>): ObjectPatch | null {
  if (o.type !== 'wall') return null;
  const props = { ...o.props, ...change };
  return { props: { ...props, thickness: round3(clamp(props.thickness, 0.05, 2)) } };
}

export function doorPatch(o: MapObject, change: Partial<DoorProps>): ObjectPatch | null {
  return o.type === 'door' ? { props: { ...o.props, ...change } } : null;
}

export function windowPatch(o: MapObject, change: Partial<WindowProps>): ObjectPatch | null {
  return o.type === 'window' ? { props: { ...o.props, ...change } } : null;
}

/**
 * Patch of a light prop; radius and dim_radius stay ordered (raising the bright radius pushes
 * the outer one, lowering the outer one pulls the bright one).
 */
export function lightPatch(o: MapObject, change: Partial<LightProps>): ObjectPatch | null {
  if (o.type !== 'light') return null;
  const p = { ...o.props, ...change };
  let radius = round3(clamp(p.radius, 0, 100));
  let dim = round3(clamp(p.dim_radius, 0, 100));
  if (change.radius !== undefined && radius > dim) dim = radius;
  if (change.dim_radius !== undefined && dim < radius) radius = dim;
  if (radius > dim) dim = radius;
  return {
    props: {
      ...p,
      radius,
      dim_radius: dim,
      intensity: round3(clamp(p.intensity, 0, 1)),
      flicker: {
        type: p.flicker.type,
        amp: round3(clamp(p.flicker.amp, 0, 1)),
        speed: round3(clamp(p.flicker.speed, 0.1, 10)),
      },
      cone:
        p.cone === null
          ? null
          : {
              angle: round3(clamp(p.cone.angle, 1, 359)),
              direction: round3(clamp(p.cone.direction, 0, 360)),
            },
    },
  };
}

export const DEFAULT_TOKEN_LIGHT: TokenLightDef = Object.freeze({
  radius: 4,
  dim_radius: 8,
  color: '#ffb35c',
  intensity: 0.8,
  flicker: false,
});

export function tokenPatch(change: PlacedTokenPatch): PlacedTokenPatch {
  const out: { -readonly [K in keyof PlacedTokenPatch]: PlacedTokenPatch[K] } = { ...change };
  if (change.scale !== undefined) out.scale = Math.round(clamp(change.scale, 0.25, 4) * 100) / 100;
  if (change.rotation !== undefined) {
    out.rotation =
      ((Math.round(Number.isFinite(change.rotation) ? change.rotation : 0) % 360) + 360) % 360;
  }
  if (change.light_override !== undefined && change.light_override !== null) {
    const l = change.light_override;
    const radius = round3(clamp(l.radius, 0, 100));
    out.light_override = {
      ...l,
      radius,
      dim_radius: Math.max(radius, round3(clamp(l.dim_radius, 0, 100))),
      intensity: round3(clamp(l.intensity, 0, 1)),
    };
  }
  return out;
}
