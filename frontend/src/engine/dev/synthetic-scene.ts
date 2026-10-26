/**
 * In-memory SceneView for the engine demo and benchmarks (development only; the real model is
 * src/editor/model): a grid of rooms (walls, doors, windows), N lights (some flickering, some
 * cones), M placed tokens with vision (some carrying a light), partially explored fog.
 */

import {
  CHUNK_SIZE,
  type Ambient,
  type ChunkKey,
  type DoorObject,
  type FogBitmap,
  type LightObject,
  type MapObject,
  type PlacedToken,
  type SceneChangedEvent,
  type SceneView,
  type TokenDefView,
  type WallObject,
  type WindowObject,
} from '../../editor/contracts';
import { FOG_SIDE, FOG_SUBCELLS, createFogBitmap, setFogBit } from '../../formats/fog-codec';
import { rng } from './synthetic-map';

const FLOOR = '1';
const ROOM = 10;

export interface SyntheticSceneOptions {
  readonly width: number;
  readonly height: number;
  readonly lights?: number;
  readonly tokens?: number;
  readonly darkness?: number;
  readonly seed?: number;
}

function base(uid: string, sort: number): Omit<WallObject, 'type' | 'geometry' | 'props'> {
  return {
    uid,
    floor: FLOOR,
    layer: 'walls',
    visibility: 'all',
    locked: false,
    sort_order: sort,
    rev: 1,
  };
}

export class SyntheticScene implements SceneView {
  readonly floor = FLOOR;
  sceneRevision = 1;
  ambient: Ambient;

  private readonly objectMap = new Map<string, MapObject>();
  private list: MapObject[] = [];
  private readonly tokenMap = new Map<string, PlacedToken>();
  private readonly defs = new Map<string, TokenDefView>();
  private readonly fog = new Map<ChunkKey, FogBitmap>();
  private readonly listeners = new Set<(e: SceneChangedEvent) => void>();
  private pending: {
    objects: Set<string>;
    tokens: Set<string>;
    fog: Set<ChunkKey>;
    ambient: boolean;
  } | null = null;
  readonly doors: string[] = [];

  constructor(readonly options: SyntheticSceneOptions) {
    const { width, height } = options;
    const random = rng(options.seed ?? 3);
    this.ambient = {
      darkness: options.darkness ?? 0.75,
      tint: '#000000',
      time_of_day: null,
      weather: { type: 'none', intensity: 0 },
    };
    let sort = 0;
    // Rooms: outer walls of each ROOM × ROOM block with a door gap on the east and south sides.
    for (let ry = 0; ry + ROOM <= height; ry += ROOM) {
      for (let rx = 0; rx + ROOM <= width; rx += ROOM) {
        const id = `${rx / ROOM}_${ry / ROOM}`;
        const x1 = rx + ROOM;
        const y1 = ry + ROOM;
        const kinds = ['stone', 'brick', 'wood', 'metal', 'natural'] as const;
        const kind = kinds[Math.floor(random() * kinds.length)]!;
        const wall = (uid: string, points: [number, number][]): WallObject => ({
          ...base(uid, sort++),
          type: 'wall',
          geometry: { points, closed: false },
          props: {
            kind,
            thickness: 0.2,
            blocks_vision: true,
            blocks_light: true,
            blocks_move: true,
            texture_asset: null,
            height: 1,
          },
        });
        // North + west sides of the room; east / south sides with a 1-cell door gap.
        this.add(
          wall(`w${id}n`, [
            [rx, ry],
            [x1, ry],
          ]),
        );
        this.add(
          wall(`w${id}w`, [
            [rx, y1],
            [rx, ry],
          ]),
        );
        this.add(
          wall(`w${id}e1`, [
            [x1, ry],
            [x1, ry + 4],
          ]),
        );
        this.add(
          wall(`w${id}e2`, [
            [x1, ry + 5],
            [x1, y1],
          ]),
        );
        this.add(
          wall(`w${id}s1`, [
            [rx, y1],
            [rx + 6, y1],
          ]),
        );
        this.add(
          wall(`w${id}s2`, [
            [rx + 7, y1],
            [x1, y1],
          ]),
        );
        const door: DoorObject = {
          ...base(`d${id}`, sort++),
          type: 'door',
          geometry: { a: [x1, ry + 4], b: [x1, ry + 5] },
          props: {
            state: random() < 0.5 ? 'open' : 'closed',
            locked: random() < 0.2,
            secret: random() < 0.1,
            asset_open: null,
            asset_closed: null,
            swing: random() < 0.5 ? 'a' : 'b',
          },
        };
        this.add(door);
        this.doors.push(door.uid);
        const win: WindowObject = {
          ...base(`g${id}`, sort++),
          type: 'window',
          geometry: { a: [rx + 6, y1], b: [rx + 7, y1] },
          props: { kind: (['glass', 'bars', 'opening'] as const)[Math.floor(random() * 3)]! },
        };
        this.add(win);
      }
    }
    const colors = ['#ffb35c', '#ffd27a', '#9ec8ff', '#ff7b5c', '#c8a2ff', '#ffffff'];
    for (let i = 0; i < (options.lights ?? 30); i++) {
      const radius = 2 + random() * 3;
      const r = random();
      const light: LightObject = {
        ...base(`l${i}`, sort++),
        layer: 'lighting',
        type: 'light',
        geometry: { x: 1 + random() * (width - 2), y: 1 + random() * (height - 2) },
        props: {
          radius,
          dim_radius: radius + 2 + random() * 4,
          color: colors[i % colors.length]!,
          intensity: 0.7 + random() * 0.3,
          flicker:
            r < 0.4
              ? { type: 'torch', amp: 0.25, speed: 1 + random() * 2 }
              : r < 0.55
                ? { type: 'pulse', amp: 0.3, speed: 0.5 }
                : { type: 'none', amp: 0, speed: 1 },
          cone: i % 7 === 3 ? { angle: 70, direction: random() * 360 } : null,
          enabled: true,
          follows_token: null,
        },
      };
      this.add(light);
    }
    this.defs.set('pc', {
      id: 'pc',
      name: 'Héroïne Aventurière',
      imageUrl: null,
      sizeW: 1,
      sizeH: 1,
      ringColor: null,
      kind: 'pc',
      vision: { enabled: true, range: 12, dark: 4 },
      light: { radius: 2, dim_radius: 4, color: '#ffcc88', intensity: 0.8, flicker: true },
    });
    this.defs.set('monster', {
      id: 'monster',
      name: 'Ogre',
      imageUrl: null,
      sizeW: 2,
      sizeH: 2,
      ringColor: null,
      kind: 'monster',
      vision: { enabled: true, range: 10, dark: 0 },
      light: null,
    });
    for (let i = 0; i < (options.tokens ?? 20); i++) {
      const pc = i % 2 === 0;
      const t: PlacedToken = {
        uid: `t${i}`,
        floor: FLOOR,
        token_id: pc ? 'pc' : 'monster',
        x: Math.floor(random() * width) + 0.5,
        y: Math.floor(random() * height) + 0.5,
        rotation: Math.floor(random() * 4) * 90,
        scale: 1,
        hidden: i % 5 === 4,
        light_override: null,
        rev: 1,
      };
      this.tokenMap.set(t.uid, t);
    }
    // Fog: explored discs around half of the tokens.
    for (const t of [...this.tokenMap.values()].filter((_, i) => i % 2 === 0)) {
      this.revealDisc(t.x, t.y, 9);
    }
    this.list = [...this.objectMap.values()];
  }

  objects(): readonly MapObject[] {
    return this.list;
  }
  object(uid: string): MapObject | undefined {
    return this.objectMap.get(uid);
  }
  tokens(): readonly PlacedToken[] {
    return [...this.tokenMap.values()];
  }
  token(uid: string): PlacedToken | undefined {
    return this.tokenMap.get(uid);
  }
  tokenDef(tokenId: string): TokenDefView | null {
    return this.defs.get(tokenId) ?? null;
  }
  fogKeys(): readonly ChunkKey[] {
    return [...this.fog.keys()];
  }
  fogChunk(key: ChunkKey): FogBitmap | null {
    return this.fog.get(key) ?? null;
  }
  onSceneChanged(listener: (event: SceneChangedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  playerTokens(): string[] {
    return [...this.tokenMap.values()].filter((t) => t.token_id === 'pc').map((t) => t.uid);
  }

  toggleDoor(uid: string): void {
    const door = this.objectMap.get(uid);
    if (door?.type !== 'door') return;
    const next: DoorObject = {
      ...door,
      rev: door.rev + 1,
      props: { ...door.props, state: door.props.state === 'open' ? 'closed' : 'open' },
    };
    this.replace(next);
  }

  moveToken(uid: string, x: number, y: number): void {
    const t = this.tokenMap.get(uid);
    if (t === undefined) return;
    this.tokenMap.set(uid, { ...t, x, y, rev: t.rev + 1 });
    this.sceneRevision++;
    this.notify().tokens.add(uid);
  }

  setDarkness(darkness: number): void {
    this.ambient = { ...this.ambient, darkness };
    this.notify().ambient = true;
  }

  revealDisc(x: number, y: number, r: number, notify = false): void {
    const s = FOG_SUBCELLS;
    for (let sy = Math.floor((y - r) * s); sy < Math.ceil((y + r) * s); sy++) {
      for (let sx = Math.floor((x - r) * s); sx < Math.ceil((x + r) * s); sx++) {
        if (sx < 0 || sy < 0 || sx >= this.options.width * s || sy >= this.options.height * s) {
          continue;
        }
        if (Math.hypot((sx + 0.5) / s - x, (sy + 0.5) / s - y) > r) continue;
        const cx = Math.floor(sx / FOG_SIDE);
        const cy = Math.floor(sy / FOG_SIDE);
        const key: ChunkKey = `${cx}:${cy}`;
        let bits = this.fog.get(key);
        if (bits === undefined) {
          bits = createFogBitmap();
          this.fog.set(key, bits);
        }
        setFogBit(bits, sx - cx * FOG_SIDE, sy - cy * FOG_SIDE);
        if (notify) this.notify().fog.add(key);
      }
    }
  }

  private add(obj: MapObject): void {
    this.objectMap.set(obj.uid, obj);
  }

  private replace(obj: MapObject): void {
    this.objectMap.set(obj.uid, obj);
    this.list = this.list.map((o) => (o.uid === obj.uid ? obj : o));
    this.sceneRevision++;
    this.notify().objects.add(obj.uid);
  }

  private notify(): {
    objects: Set<string>;
    tokens: Set<string>;
    fog: Set<ChunkKey>;
    ambient: boolean;
  } {
    if (this.pending === null) {
      this.pending = { objects: new Set(), tokens: new Set(), fog: new Set(), ambient: false };
      queueMicrotask(() => {
        const p = this.pending;
        this.pending = null;
        if (p === null) return;
        const event: SceneChangedEvent = {
          objects: [...p.objects],
          tokens: [...p.tokens],
          fog: [...p.fog],
          ambient: p.ambient,
          tokenDefs: false,
        };
        for (const l of this.listeners) l(event);
      });
    }
    return this.pending;
  }
}

/** Chunk size reminder (fog chunks share the tile chunk grid). */
export const SCENE_CHUNK_CELLS = CHUNK_SIZE;
