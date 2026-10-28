/** Cave generator v1 (§16.3): cellular automaton, connection, natural walls, regions, population. */
import { astar } from '../graph';
import { BitGrid, farthestPair } from '../grid';
import { packKey } from '../pack-keys';
import { populate } from '../populate';
import { parseRules, type RuleSet } from '../populate-rules';
import ice from '../rules/cave/ice.json';
import lava from '../rules/cave/lava.json';
import rock from '../rules/cave/rock.json';
import { CAVE_THEMES } from '../themes/cave';
import type { GenCell, GenContext, GenLight, GenResult, GenRoom, Generator } from '../types';
import { connectOpenings, zoneOpenings } from '../zone';
import { CAVE_DEFAULTS, CAVE_PRESETS, validateCave, type CaveParams } from './params';
import { caveRegions } from './regions';
import { automaton, connectComponents, mainSize, randomFill, smooth } from './shape';
import { caveWalls } from './walls';

export type { CaveParams } from './params';
export { CAVE_DEFAULTS, CAVE_PRESETS, CAVE_PRESET_LABELS, validateCave } from './params';

export const CAVE_VERSION = 1;

const RULE_FILES: Readonly<Record<string, unknown>> = { rock, ice, lava };
const ruleCache = new Map<string, RuleSet>();

/** Parsed population rules of a cave rules file (validated once). */
export function caveRules(name: string): RuleSet {
  let set = ruleCache.get(name);
  if (set === undefined) {
    const json = RULE_FILES[name];
    if (json === undefined) throw new Error(`Unknown cave rules: ${name}`);
    set = parseRules(json, `cave/${name}`);
    ruleCache.set(name, set);
  }
  return set;
}

const PHASES = 10;
const MAX_RETRIES = 5;
const MIN_SHARE = 0.15;

/** Cells of the zone border whose outer edge is open, as population openings. */
function openingEdges(
  openings: readonly (readonly [number, number])[],
  w: number,
  h: number,
): { a: [number, number]; b: [number, number] }[] {
  const out: { a: [number, number]; b: [number, number] }[] = [];
  for (const [x, y] of openings) {
    if (y === 0) out.push({ a: [x, 0], b: [x + 1, 0] });
    if (y === h - 1) out.push({ a: [x, h], b: [x + 1, h] });
    if (x === 0) out.push({ a: [0, y], b: [0, y + 1] });
    if (x === w - 1) out.push({ a: [w, y], b: [w, y + 1] });
  }
  return out;
}

function generate(p: CaveParams, ctx: GenContext): GenResult {
  const { rng } = ctx;
  const zone = ctx.zone;
  if (zone !== undefined) {
    const ok = (v: number): boolean => Number.isInteger(v) && v >= 8 && v <= 400;
    if (!ok(zone.width) || !ok(zone.height)) throw new Error('zone_too_small');
  }
  const W = zone === undefined ? p.width : zone.width;
  const H = zone === undefined ? p.height : zone.height;
  const theme = CAVE_THEMES[p.theme];
  const ruleSet = caveRules(theme.rules);
  let step = 0;
  const phase = (name: string): void => ctx.progress(name, step++, PHASES);

  phase('fill');
  let floor = new BitGrid(W, H);
  let tunnels = 0;
  let retries = 0;
  let bestSize = -1;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const r = rng.fork(attempt === 0 ? 'fill' : `retry-${attempt}`);
    const mask = automaton(randomFill(W, H, p.fill, r), p.iterations);
    const t = connectComponents(mask, p.connect);
    const size = mainSize(mask);
    if (size > bestSize) {
      bestSize = size;
      floor = mask;
      tunnels = t;
    }
    retries = attempt;
    if (size >= W * H * MIN_SHARE) break;
  }
  if (bestSize < 9) {
    // Degenerate draw: carve a small central room and link everything to it.
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);
    for (let y = cy - 2; y <= cy + 2; y++)
      for (let x = cx - 2; x <= cx + 2; x++) floor.set(x, y, 1);
    tunnels += connectComponents(floor, p.connect);
  }

  phase('connect');
  const openings = zoneOpenings(zone, W, H);
  connectOpenings(floor, openings);
  const protect = new Uint8Array(W * H);
  for (const [x, y] of openings) protect[y * W + x] = 1;

  phase('smooth');
  smooth(floor, p.smooth, protect);

  phase('walls');
  const walls = caveWalls(floor, openings, theme.wall_kind);

  phase('stairs');
  const passable = (x: number, y: number): boolean => floor.get(x, y) !== 0;
  let entrance: [number, number] | null = null;
  let exit: [number, number] | null = null;
  const reserved: [number, number][] = [];
  if (zone === undefined) {
    const start = floor.data.indexOf(1);
    const pair = farthestPair(floor, passable, [start % W, Math.floor(start / W)]);
    if (pair !== null) {
      entrance = pair.a;
      exit = pair.b;
      const path = astar(W, H, (x, y) => (passable(x, y) ? 1 : Infinity), entrance, exit);
      for (const c of path ?? []) reserved.push(c);
    }
  }

  phase('regions');
  const { regions } = caveRegions(floor, ruleSet.room_kinds, rng.fork('regions'));

  phase('populate');
  const pop = populate({
    floor,
    regions,
    doors: openingEdges(openings, W, H),
    entrance,
    ruleSet,
    density: p.decor * 2,
    rng: rng.fork('populate'),
    blocking: (key) => packKey(key).blocking || key === 'terrain.lava',
    reserved,
  });

  phase('tiles');
  const rt = rng.fork('tiles');
  const regionFloor = regions.map(() => (rt.chance(0.3) ? theme.floor_alt : theme.floor));
  const ground: GenCell[] = [];
  const regionAt = new Int32Array(W * H).fill(-1);
  regions.forEach((r, id) => {
    for (const [x, y] of r.cells) regionAt[y * W + x] = id;
  });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (floor.get(x, y) === 0) continue;
      const id = regionAt[y * W + x]!;
      ground.push({ x, y, key: id >= 0 ? regionFloor[id]! : theme.floor });
    }
  }
  const decor: GenCell[] = [...pop.decor];
  if (entrance !== null && exit !== null) {
    decor.unshift(
      { x: entrance[0], y: entrance[1], key: 'decor.stairs_up' },
      { x: exit[0], y: exit[1], key: 'decor.stairs_down' },
    );
  }

  phase('lights');
  const rl = rng.fork('lights');
  const lights: GenLight[] = [...pop.lights];
  for (const c of pop.decor) {
    if (c.key === 'decor.mushroom' && rl.chance(0.4)) {
      lights.push({ x: c.x + 0.5, y: c.y + 0.5, preset: 'magic' });
    }
  }
  const lavaCells = pop.terrain.filter((c) => c.key === 'terrain.lava');
  if (lavaCells.length > 0) {
    rl.shuffle(lavaCells);
    const n = Math.min(6, 1 + Math.floor(lavaCells.length / 15));
    for (const c of lavaCells.slice(0, n)) {
      lights.push({ x: c.x + 0.5, y: c.y + 0.5, preset: 'campfire' });
    }
  }

  phase('done');
  const rooms: GenRoom[] = regions.map((r) => ({
    id: r.id,
    kind: r.kind,
    rect: null,
    cells: r.cells.length,
  }));
  return {
    generator: 'cave',
    gen_version: CAVE_VERSION,
    seed: ctx.seed,
    width: W,
    height: H,
    floors: [
      {
        ground,
        terrain: pop.terrain,
        decor,
        walls,
        doors: [],
        windows: [],
        lights,
        rooms,
        entrance,
        exit,
      },
    ],
    stats: {
      floor_cells: ground.length,
      regions: regions.length,
      tunnels,
      decor: decor.length,
      lights: lights.length,
      retries,
    },
  };
}

export const caveGenerator: Generator<CaveParams> = {
  id: 'cave',
  version: CAVE_VERSION,
  defaults: { ...CAVE_DEFAULTS },
  presets: CAVE_PRESETS,
  validate: validateCave,
  generate,
};
