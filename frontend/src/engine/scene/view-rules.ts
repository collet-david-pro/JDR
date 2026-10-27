/**
 * GM / player / display view rules of the P5 scene (pure). projet.md 12.4, 14.2:
 * - gm: everything drawn; gm-layer objects and visibility ≠ 'all' faded; hidden tokens faded;
 *   invisible walls dashed; secret doors drawn as doors with a dashed outline; light gizmos.
 * - player / display: gm layer, visibility ≠ 'all', invisible walls and hidden tokens are not
 *   drawn; a secret door is drawn (and blocks) like a plain wall; no gizmos.
 */

import type {
  LayerDef,
  LightObject,
  MapObject,
  ObjectLayerId,
  PlacedToken,
  ViewMode,
  ViewOptions,
} from '../../editor/contracts';
import { HIDDEN_TOKEN_ALPHA } from '../../scene/style';
import type { Viewer } from '../../vision';

export const DEFAULT_VIEW: ViewOptions = Object.freeze({
  mode: 'gm',
  viewers: Object.freeze([]) as readonly string[],
  lighting: true,
  fog: true,
  shadows: false,
});

/** GM view: alpha of objects players never receive (gm layer, visibility ≠ 'all'). */
export const GM_HIDDEN_OBJECT_ALPHA = 0.6;

export const OBJECT_LAYER_IDS: readonly ObjectLayerId[] = [
  'walls',
  'props',
  'lighting',
  'labels',
  'gm',
];

const MODES: readonly ViewMode[] = ['gm', 'player', 'display'];

/** Merges a patch into the current options (invalid values ignored, viewers de-duplicated). */
export function mergeView(current: ViewOptions, patch: Partial<ViewOptions>): ViewOptions {
  const mode = patch.mode !== undefined && MODES.includes(patch.mode) ? patch.mode : current.mode;
  const viewers =
    patch.viewers !== undefined
      ? [...new Set(patch.viewers.filter((v) => typeof v === 'string' && v !== ''))]
      : current.viewers;
  const bool = (v: boolean | undefined, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
  const base = {
    mode,
    viewers,
    lighting: bool(patch.lighting, current.lighting),
    fog: bool(patch.fog, current.fog),
    shadows: bool(patch.shadows, current.shadows),
  };
  // `tokens` is only present when false (absent = drawn).
  return bool(patch.tokens, current.tokens !== false) ? base : { ...base, tokens: false };
}

/** Whether the placed tokens are drawn in this view. */
export function tokensDrawn(view: ViewOptions): boolean {
  return view.tokens !== false;
}

export function viewsEqual(a: ViewOptions, b: ViewOptions): boolean {
  return (
    a.mode === b.mode &&
    a.lighting === b.lighting &&
    a.fog === b.fog &&
    a.shadows === b.shadows &&
    tokensDrawn(a) === tokensDrawn(b) &&
    a.viewers.length === b.viewers.length &&
    a.viewers.every((v, i) => b.viewers[i] === v)
  );
}

/** Who looks, for the occluders (secret doors). */
export function viewerKind(mode: ViewMode): Viewer {
  return mode === 'gm' ? 'gm' : 'player';
}

export function isPlayerLike(mode: ViewMode): boolean {
  return mode !== 'gm';
}

/** VisibleScene is computed (and emitted) in player / display views, and when exploring. */
export function needsVisibility(view: ViewOptions): boolean {
  return view.mode !== 'gm' || view.viewers.length > 0;
}

/** Objects players never receive (12.4: gm layer, visibility gm / hidden_until_revealed). */
export function isGmOnlyObject(obj: MapObject): boolean {
  return obj.layer === 'gm' || obj.visibility !== 'all';
}

/** Whether the object is drawn in this view (lights only have a GM gizmo). */
export function objectShown(obj: MapObject, mode: ViewMode): boolean {
  if (mode === 'gm') return true;
  if (obj.type === 'light') return false;
  if (isGmOnlyObject(obj)) return false;
  if (obj.type === 'wall' && obj.props.kind === 'invisible') return false;
  return true;
}

export function objectAlpha(obj: MapObject, mode: ViewMode): number {
  return mode === 'gm' && isGmOnlyObject(obj) ? GM_HIDDEN_OBJECT_ALPHA : 1;
}

/** A secret door is a plain wall for players (12.4). */
export function doorDrawnAsWall(obj: MapObject, mode: ViewMode): boolean {
  return obj.type === 'door' && obj.props.secret && mode !== 'gm';
}

/** Light objects contributing to the lightmap / visibility in this view. */
export function lightIncluded(obj: LightObject, mode: ViewMode): boolean {
  if (!obj.props.enabled || obj.props.intensity <= 0 || obj.props.dim_radius <= 0) return false;
  return mode === 'gm' || !isGmOnlyObject(obj);
}

export function tokenShown(token: PlacedToken, mode: ViewMode): boolean {
  return mode === 'gm' || !token.hidden;
}

export function tokenAlpha(token: PlacedToken, mode: ViewMode): number {
  return mode === 'gm' && token.hidden ? HIDDEN_TOKEN_ALPHA : 1;
}

/** Visibility / alpha of an object layer (missing definition = visible, opaque). */
export function objectLayerState(
  layers: readonly LayerDef[],
  id: ObjectLayerId,
  mode: ViewMode,
): { readonly visible: boolean; readonly alpha: number } {
  const def = layers.find((l) => l.id === id);
  if (mode !== 'gm' && (id === 'gm' || def?.gmOnly === true)) return { visible: false, alpha: 0 };
  if (def === undefined) return { visible: true, alpha: 1 };
  const alpha = Math.min(1, Math.max(0, def.opacity));
  return { visible: def.visible && alpha > 0, alpha };
}

/** Object layers bottom → top: MapView.layers order, missing ones appended in default order. */
export function objectLayerOrder(layers: readonly LayerDef[]): ObjectLayerId[] {
  const out: ObjectLayerId[] = [];
  for (const l of layers) {
    const id = l.id as ObjectLayerId;
    if (OBJECT_LAYER_IDS.includes(id) && !out.includes(id)) out.push(id);
  }
  for (const id of OBJECT_LAYER_IDS) if (!out.includes(id)) out.push(id);
  return out;
}
