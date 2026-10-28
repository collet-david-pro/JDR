/** Dungeon generator v1 (§16.2): BSP rooms, corridors, doors, walls, stairs, typing, population. */
import { chainSegments, maskOutline } from '../geometry';
import { connectOpenings, dropOpeningWalls } from '../zone';
import { bfsDistances, components } from '../grid';
import { packKey } from '../pack-keys';
import { populate, type PopulateRegion } from '../populate';
import { parseRules, type RuleSet } from '../populate-rules';
import crypt from '../rules/dungeon/crypt.json';
import sewer from '../rules/dungeon/sewer.json';
import stone from '../rules/dungeon/stone.json';
import wood from '../rules/dungeon/wood.json';
import { DUNGEON_THEMES } from '../themes/dungeon';
import type {
  GenCell,
  GenContext,
  GenDoor,
  GenResult,
  GenRoom,
  GenWall,
  Generator,
} from '../types';
import { Carver } from './carve';
import { findJunctions } from './doors';
import { assignKinds } from './kinds';
import { layoutDungeon } from './layout';
import { openingDoors, setupZone } from './zone';
import { DUNGEON_DEFAULTS, DUNGEON_PRESETS, validateDungeon, type DungeonParams } from './params';

export type { DungeonParams } from './params';
export {
  DUNGEON_DEFAULTS,
  DUNGEON_PRESETS,
  DUNGEON_PRESET_LABELS,
  validateDungeon,
} from './params';

export const DUNGEON_VERSION = 1;

const RULE_FILES: Readonly<Record<string, unknown>> = { stone, crypt, sewer, wood };
const ruleCache = new Map<string, RuleSet>();

/** Parsed population rules of a dungeon rules file (validated once). */
export function dungeonRules(name: string): RuleSet {
  let set = ruleCache.get(name);
  if (set === undefined) {
    const json = RULE_FILES[name];
    if (json === undefined) throw new Error(`Unknown dungeon rules: ${name}`);
    set = parseRules(json, `dungeon/${name}`);
    ruleCache.set(name, set);
  }
  return set;
}

/** Room kinds whose doors may be locked (5 %). */
const LOCKABLE = new Set(['treasure', 'boss']);
const PHASES = 10;

function generate(params: DungeonParams, ctx: GenContext): GenResult {
  let p = params;
  const { rng } = ctx;
  const zone = ctx.zone === undefined ? null : setupZone(p, ctx.zone);
  if (zone !== null) p = zone.p;
  const W = p.width;
  const H = p.height;
  const theme = DUNGEON_THEMES[p.theme];
  const ruleSet = dungeonRules(theme.rules);
  let step = 0;
  const phase = (name: string): void => ctx.progress(name, step++, PHASES);

  phase('layout');
  const lay = layoutDungeon(p, rng.fork('bsp'), rng.fork('rooms'), rng.fork('links'));
  const n = lay.rooms.length;

  phase('corridors');
  const carver = new Carver(W, H, lay.rooms, p.corridor);
  const rc = rng.fork('corridors');
  for (const e of lay.links) carver.link(e.a, e.b, lay.anchors[e.a]!, lay.anchors[e.b]!, rc);
  const { floor, roomAt } = carver;

  phase('connectivity');
  // Step 10 runs before the doors so that they see the final floor (no repair is expected).
  const repairs = carver.repair();
  if (zone !== null) {
    connectOpenings(floor, zone.openings);
  }
  const passable = (x: number, y: number): boolean => floor.get(x, y) !== 0;

  phase('doors');
  const junctions = findJunctions(floor, lay.rooms, p.corridor);

  phase('stairs');
  const centers: [number, number][] = lay.rooms.map((r) => [
    r.x + Math.floor(r.w / 2),
    r.y + Math.floor(r.h / 2),
  ]);
  const farthest = (dist: Int32Array, skip: number): number => {
    let best = skip === 0 ? 1 : 0;
    for (let r = 0; r < n; r++) {
      if (r === skip) continue;
      const c = centers[r]!;
      const b = centers[best]!;
      if (dist[c[1] * W + c[0]]! > dist[b[1] * W + b[0]]!) best = r;
    }
    return best;
  };
  let entrance: number;
  if (zone !== null && zone.openings.length > 0) {
    // Zone: no stairs; the room closest to the first opening plays the entrance role for typing.
    const [ox, oy] = zone.openings[0]!;
    entrance = 0;
    let best = Infinity;
    centers.forEach(([cx, cy], r) => {
      const d = Math.abs(cx - ox) + Math.abs(cy - oy);
      if (d < best) {
        best = d;
        entrance = r;
      }
    });
  } else if (zone !== null) entrance = 0;
  else entrance = farthest(bfsDistances(floor, passable, [centers[0]!]), -1);
  const distE = bfsDistances(floor, passable, [centers[entrance]!]);
  const exit = n > 1 ? farthest(distE, entrance) : entrance;

  phase('kinds');
  const corridors = components(floor, (v, x, y) => v !== 0 && roomAt[y * W + x]! < 0);
  const kinds = assignKinds({
    rooms: lay.rooms,
    centers,
    entrance,
    exit,
    distFromEntrance: distE,
    width: W,
    junctions,
    corridorLabel: corridors.labels,
    ruleSet,
    rng: rng.fork('kinds'),
  });
  if (zone !== null) {
    // No stairs in a zone: the entrance room becomes common, the exit room a drawn kind.
    kinds[entrance] = 'common';
    if (exit !== entrance) {
      const pool =
        ruleSet.room_kinds.length > 0 ? ruleSet.room_kinds : [{ kind: 'common', weight: 1 }];
      kinds[exit] = rng.fork('zone-exit').weighted(pool, (e) => e.weight).kind;
    }
  }

  const rd = rng.fork('doors');
  const doors: GenDoor[] = [];
  for (const j of junctions) {
    if (!j.doorable || !rd.chance(p.door_p)) continue;
    const secret = rd.chance(p.secret_p);
    const locked = LOCKABLE.has(kinds[j.room]!) && rd.chance(0.05);
    const swing: GenDoor['swing'] = theme.door_swing_slide ? 'slide' : rd.chance(0.5) ? 'a' : 'b';
    doors.push({ a: [j.a[0], j.a[1]], b: [j.b[0], j.b[1]], secret, locked, swing });
  }

  phase('walls');
  const walls: GenWall[] = chainSegments(
    zone === null ? maskOutline(floor) : dropOpeningWalls(maskOutline(floor), zone.openings, W, H),
  ).map((pl) => ({
    points: pl.points.map(([x, y]): [number, number] => [x, y]),
    closed: pl.closed,
    kind: theme.wall_kind,
  }));

  phase('tiles');
  const rt = rng.fork('tiles');
  const roomFloor = lay.rooms.map(() => (rt.chance(0.25) ? theme.floor_alt : theme.floor));
  const ground: GenCell[] = [];
  let corridorCells = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (floor.get(x, y) === 0) continue;
      const room = roomAt[y * W + x]!;
      if (room < 0) corridorCells++;
      ground.push({ x, y, key: room >= 0 ? roomFloor[room]! : theme.corridor });
    }
  }

  phase('populate');
  const regions: PopulateRegion[] = lay.rooms.map((r, id) => {
    const cells: [number, number][] = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells.push([x, y]);
    return { id, kind: kinds[id]!, cells };
  });
  const corridorCellsOf: [number, number][][] = corridors.sizes.map(() => []);
  for (let i = 0; i < corridors.labels.length; i++) {
    const l = corridors.labels[i]!;
    if (l >= 0) corridorCellsOf[l]!.push([i % W, Math.floor(i / W)]);
  }
  corridorCellsOf.forEach((cells, k) => regions.push({ id: n + k, kind: 'corridor', cells }));
  const up = centers[entrance]!;
  const down = centers[exit]!;
  const pop = populate({
    floor,
    regions,
    doors: zone === null ? junctions : [...junctions, ...openingDoors(zone.openings, W, H)],
    entrance: zone === null ? up : (zone.openings[0] ?? null),
    ruleSet,
    density: p.decor * 2,
    rng: rng.fork('populate'),
    blocking: (key) => packKey(key).blocking,
    reserved: zone === null ? [up, down] : [],
    lightPreset: theme.torch,
  });
  const decor: GenCell[] =
    zone === null
      ? [
          { x: up[0], y: up[1], key: 'decor.stairs_up' },
          { x: down[0], y: down[1], key: 'decor.stairs_down' },
          ...pop.decor,
        ]
      : pop.decor;

  phase('done');
  const rooms: GenRoom[] = lay.rooms.map((r, id) => ({
    id,
    kind: kinds[id]!,
    rect: { x: r.x, y: r.y, w: r.w, h: r.h },
    cells: r.w * r.h,
  }));
  return {
    generator: 'dungeon',
    gen_version: DUNGEON_VERSION,
    seed: ctx.seed,
    width: W,
    height: H,
    floors: [
      {
        ground,
        terrain: pop.terrain,
        decor,
        walls,
        doors,
        windows: [],
        lights: pop.lights,
        rooms,
        entrance: zone === null ? [up[0], up[1]] : null,
        exit: zone === null ? [down[0], down[1]] : null,
      },
    ],
    stats: {
      rooms: n,
      doors: doors.length,
      secret_doors: doors.filter((d) => d.secret).length,
      corridor_cells: corridorCells,
      floor_cells: ground.length,
      decor: decor.length,
      lights: pop.lights.length,
      repairs,
    },
  };
}

export const dungeonGenerator: Generator<DungeonParams> = {
  id: 'dungeon',
  version: DUNGEON_VERSION,
  defaults: { ...DUNGEON_DEFAULTS },
  presets: DUNGEON_PRESETS,
  validate: validateDungeon,
  generate,
};
