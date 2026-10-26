/**
 * P5 content of the PNG export (projet.md 2.8, 17), copied on the main thread from the editor's
 * SceneView into plain, structured-clone friendly data for export.worker.
 *
 * The export shows the GM view without GM-only elements, i.e. what players receive (12.4,
 * same rules as the engine's player view): objects of the gm layer or with visibility ≠ 'all',
 * invisible walls, light gizmos and hidden tokens are not drawn; a secret door is drawn as a
 * plain wall. Occluders (lighting) are the walls / doors / windows players receive.
 */
import {
  CHUNK_SIZE,
  type Ambient,
  type CellRect,
  type ChunkKey,
  type LayerDef,
  type LightCone,
  type MapObject,
  type ObjectLayerId,
  type PlacedToken,
  type SceneView,
  type TokenDefView,
  type TokenLightDef,
} from '../editor/contracts';
import {
  lightPosition,
  parseColor,
  tokenBox,
  tokenRingColor,
} from '../engine/scene/object-geometry';
import { TOKEN_FLICKER } from '../vision/flicker';

/** What the scene part of the export draws (the objects are always drawn). */
export interface SceneContentOptions {
  readonly tokens: boolean;
  readonly lighting: boolean;
  readonly fog: boolean;
}

export const DEFAULT_SCENE_CONTENT: SceneContentOptions = Object.freeze({
  tokens: true,
  lighting: false,
  fog: false,
});

export interface SnapshotToken {
  readonly uid: string;
  readonly x: number;
  readonly y: number;
  /** Degrees. */
  readonly rotation: number;
  /** Size in cells (definition size × scale). */
  readonly w: number;
  readonly h: number;
  /** 0xRRGGBB */
  readonly ring: number;
  readonly name: string;
  /** Index in SnapshotScene.tokenImages, or null (disc with initials). */
  readonly image: number | null;
}

export interface SnapshotLight {
  readonly x: number;
  readonly y: number;
  /** Bright radius (full intensity), cells. */
  readonly radius: number;
  /** Outer radius (fades to 0), cells, > 0. */
  readonly dim: number;
  /** 0xRRGGBB */
  readonly color: number;
  /** Mean intensity (intensity × mean flicker, projet.md 17: no flickering in the export). */
  readonly level: number;
  readonly cone: LightCone | null;
}

export interface SnapshotTokenImage {
  readonly index: number;
  readonly name: string;
  readonly url: string;
}

export interface SnapshotScene {
  readonly floor: string;
  /** Map size in cells. */
  readonly width: number;
  readonly height: number;
  /** Drawn walls / doors / windows, bottom → top (object layer order, then scene order). */
  readonly objects: readonly MapObject[];
  /** Walls / doors / windows blocking light in the exported view. */
  readonly occluders: readonly MapObject[];
  readonly lights: readonly SnapshotLight[];
  readonly tokens: readonly SnapshotToken[];
  readonly tokenImages: readonly SnapshotTokenImage[];
  readonly ambient: Ambient;
  /** Fog chunks intersecting the extent (copies); absent chunk = unexplored. */
  readonly fog: readonly (readonly [ChunkKey, Uint8Array])[];
}

const OBJECT_LAYERS: readonly ObjectLayerId[] = ['walls', 'props', 'lighting', 'labels', 'gm'];

/** Objects players receive (12.4). */
export function isPlayerObject(obj: MapObject): boolean {
  return obj.layer !== 'gm' && obj.visibility === 'all';
}

function layerVisible(layers: readonly LayerDef[], id: ObjectLayerId): boolean {
  if (id === 'gm') return false;
  const def = layers.find((l) => l.id === id);
  if (def === undefined) return true;
  return def.gmOnly !== true && def.visible && def.opacity > 0;
}

function layerOrder(layers: readonly LayerDef[]): ObjectLayerId[] {
  const out: ObjectLayerId[] = [];
  for (const l of layers) {
    const id = l.id as ObjectLayerId;
    if (OBJECT_LAYERS.includes(id) && !out.includes(id)) out.push(id);
  }
  for (const id of OBJECT_LAYERS) if (!out.includes(id)) out.push(id);
  return out;
}

function meanLevel(intensity: number, amp: number, flickering: boolean): number {
  const i = Math.min(1, Math.max(0, intensity));
  return flickering ? i * (1 - Math.min(1, Math.max(0, amp)) * 0.5) : i;
}

function absoluteUrl(url: string, base: string | undefined): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

function chunkInRange(key: ChunkKey, extent: CellRect): boolean {
  const [cx, cy] = key.split(':').map(Number) as [number, number];
  return (
    cx >= Math.floor(extent.x / CHUNK_SIZE) &&
    cx <= Math.floor((extent.x + extent.w - 1) / CHUNK_SIZE) &&
    cy >= Math.floor(extent.y / CHUNK_SIZE) &&
    cy <= Math.floor((extent.y + extent.h - 1) / CHUNK_SIZE)
  );
}

function tokenLight(token: PlacedToken, def: TokenDefView | null): TokenLightDef | null {
  return token.light_override ?? def?.light ?? null;
}

/**
 * Copy of the scene for the export. `transfer` lists the fog buffers (copies). Tokens, lights
 * and fog are only copied when the matching option is on.
 */
export function buildSceneSnapshot(
  scene: SceneView,
  layers: readonly LayerDef[],
  size: { readonly width: number; readonly height: number },
  extent: CellRect,
  content: SceneContentOptions,
  baseUrl?: string,
): { scene: SnapshotScene; transfer: ArrayBuffer[] } {
  const all = scene.objects();
  const order = layerOrder(layers);
  const objects = all
    .map((obj, i) => ({ obj, i }))
    .filter(
      ({ obj }) =>
        obj.type !== 'light' &&
        isPlayerObject(obj) &&
        layerVisible(layers, obj.layer) &&
        !(obj.type === 'wall' && obj.props.kind === 'invisible'),
    )
    .sort((a, b) => order.indexOf(a.obj.layer) - order.indexOf(b.obj.layer) || a.i - b.i)
    .map(({ obj }) => obj);
  const occluders = all.filter((o) => o.type !== 'light' && isPlayerObject(o));

  const lights: SnapshotLight[] = [];
  const tokens: SnapshotToken[] = [];
  const tokenImages: SnapshotTokenImage[] = [];
  const shown = scene.tokens().filter((t) => !t.hidden);
  if (content.lighting) {
    const token = (uid: string): PlacedToken | undefined => scene.token(uid);
    for (const obj of all) {
      if (obj.type !== 'light' || !isPlayerObject(obj)) continue;
      const p = obj.props;
      if (!p.enabled || !(p.intensity > 0) || !(p.dim_radius > 0)) continue;
      const [x, y] = lightPosition(obj, token);
      lights.push({
        x,
        y,
        radius: Math.min(p.radius, p.dim_radius),
        dim: p.dim_radius,
        color: parseColor(p.color) ?? 0xffffff,
        level: meanLevel(p.intensity, p.flicker.amp, p.flicker.type !== 'none'),
        cone: p.cone,
      });
    }
    for (const t of shown) {
      const light = tokenLight(t, scene.tokenDef(t.token_id));
      if (light === null || !(light.dim_radius > 0) || !(light.intensity > 0)) continue;
      lights.push({
        x: t.x,
        y: t.y,
        radius: Math.min(light.radius, light.dim_radius),
        dim: light.dim_radius,
        color: parseColor(light.color) ?? 0xffffff,
        level: meanLevel(light.intensity, TOKEN_FLICKER.amp, light.flicker),
        cone: null,
      });
    }
  }
  if (content.tokens) {
    const byUrl = new Map<string, number>();
    for (const t of shown) {
      const def = scene.tokenDef(t.token_id);
      const box = tokenBox(t, def);
      let image: number | null = null;
      if (def?.imageUrl) {
        const url = absoluteUrl(def.imageUrl, baseUrl);
        image = byUrl.get(url) ?? null;
        if (image === null) {
          image = tokenImages.length;
          byUrl.set(url, image);
          tokenImages.push({ index: image, name: def.name, url });
        }
      }
      tokens.push({
        uid: t.uid,
        x: t.x,
        y: t.y,
        rotation: t.rotation,
        w: box.w,
        h: box.h,
        ring: tokenRingColor(def),
        name: def?.name ?? '',
        image,
      });
    }
  }
  const fog: (readonly [ChunkKey, Uint8Array])[] = [];
  const transfer: ArrayBuffer[] = [];
  if (content.fog) {
    for (const key of scene.fogKeys()) {
      if (!chunkInRange(key, extent)) continue;
      const bits = scene.fogChunk(key);
      if (bits === null) continue;
      const copy = bits.slice();
      transfer.push(copy.buffer);
      fog.push([key, copy]);
    }
  }
  return {
    scene: {
      floor: scene.floor,
      width: size.width,
      height: size.height,
      objects,
      occluders,
      lights,
      tokens,
      tokenImages,
      ambient: scene.ambient,
      fog,
    },
    transfer,
  };
}
