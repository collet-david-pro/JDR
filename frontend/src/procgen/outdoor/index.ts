/** Outdoor generator v1 (§16.4): fbm terrain, biomes, rivers, roads with bridges and fords, trees. */
import { BitGrid } from '../grid';
import { packKey } from '../pack-keys';
import { populate, type PopulateRegion } from '../populate';
import { parseRules, type RuleSet } from '../populate-rules';
import desert from '../rules/outdoor/desert.json';
import temperate from '../rules/outdoor/temperate.json';
import winter from '../rules/outdoor/winter.json';
import { OUTDOOR_THEMES } from '../themes/outdoor';
import type { GenCell, GenContext, GenLight, GenResult, Generator, PackKey } from '../types';
import { OUTDOOR_DEFAULTS, OUTDOOR_PRESETS, validateOutdoor, type OutdoorParams } from './params';
import { buildRoads } from './roads';
import { carveRivers } from './rivers';
import { scatter } from './scatter';
import { BEACH, DEEP, FOREST, HILL, MOUNTAIN, OASIS, SNOW, WATER, buildLand } from './terrain';

export type { OutdoorParams } from './params';
export {
  OUTDOOR_DEFAULTS,
  OUTDOOR_PRESETS,
  OUTDOOR_PRESET_LABELS,
  validateOutdoor,
} from './params';

export const OUTDOOR_VERSION = 1;

const RULE_FILES: Readonly<Record<string, unknown>> = { temperate, desert, winter };
const ruleCache = new Map<string, RuleSet>();

/** Parsed population rules of an outdoor rules file (validated once). */
export function outdoorRules(name: string): RuleSet {
  let set = ruleCache.get(name);
  if (set === undefined) {
    const json = RULE_FILES[name];
    if (json === undefined) throw new Error(`Unknown outdoor rules: ${name}`);
    set = parseRules(json, `outdoor/${name}`);
    ruleCache.set(name, set);
  }
  return set;
}

const PHASES = 10;

function generate(p: OutdoorParams, ctx: GenContext): GenResult {
  if (ctx.zone !== undefined) throw new Error('zone_unsupported');
  const { rng } = ctx;
  const W = p.width;
  const H = p.height;
  const theme = OUTDOOR_THEMES[p.theme];
  let step = 0;
  const phase = (name: string): void => ctx.progress(name, step++, PHASES);

  phase('terrain');
  const land = buildLand(p, theme, rng.fork('terrain'));
  const { biome } = land;

  phase('rivers');
  const rivers = carveRivers(land, p.rivers, rng.fork('rivers'));

  // Wetness: 0 dry, 1 shallow water (terrain), 2 deep water, 3 frozen lake.
  const wet = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const b = biome[i]!;
    if (b === DEEP) wet[i] = 2;
    else if (b === WATER) wet[i] = theme.lake === null ? 3 : 1;
    else if (rivers.mask[i] === 1) wet[i] = 1;
  }
  const river = rivers.mask;

  phase('roads');
  const roads = buildRoads(land, wet, p.roads, rng.fork('roads'));

  phase('ground');
  const groundOf = (b: number): PackKey =>
    b === DEEP
      ? theme.deep_ground
      : b === WATER
        ? theme.shallow_ground
        : b === BEACH
          ? theme.beach
          : b === FOREST
            ? theme.forest
            : b === HILL
              ? theme.hill
              : b === MOUNTAIN
                ? theme.mountain
                : b === SNOW
                  ? theme.snow
                  : b === OASIS
                    ? theme.oasis
                    : theme.plain;
  const groundKey: PackKey[] = Array.from({ length: W * H }, (_, i) => groundOf(biome[i]!));
  const terrainKey: (PackKey | null)[] = Array.from({ length: W * H }, (_, i) => {
    if (biome[i] === DEEP) return theme.deep;
    if (biome[i] === WATER) return theme.lake;
    return river[i] === 1 ? theme.river : null;
  });
  const roadMask = new Uint8Array(W * H);
  const bridgeAt = new Uint8Array(W * H);
  let bridges = 0;
  let fords = 0;
  for (const r of roads) {
    for (const [x, y] of r.path) {
      roadMask[y * W + x] = 1;
      groundKey[y * W + x] = theme.road;
    }
    for (const run of r.fords) {
      fords++;
      for (const [x, y] of run) {
        terrainKey[y * W + x] = null;
        groundKey[y * W + x] = theme.ford;
      }
    }
    for (const run of r.bridges) {
      bridges++;
      for (const [x, y] of run) bridgeAt[y * W + x] = 1;
    }
  }

  phase('scatter');
  const blocked = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (wet[i] !== 0 || roadMask[i] === 1 || terrainKey[i] !== null) blocked[i] = 1;
  }
  const sc = scatter(land, p.forest, theme.oasis_only, blocked, rng.fork('scatter'));
  const decor: GenCell[] = [];
  for (let i = 0; i < W * H; i++) {
    if (bridgeAt[i] === 1) decor.push({ x: i % W, y: Math.floor(i / W), key: 'decor.bridge' });
  }
  const occupied = new Uint8Array(W * H);
  for (const c of decor) occupied[c.y * W + c.x] = 1;
  const put = (cells: [number, number][], key: PackKey): void => {
    for (const [x, y] of cells) {
      decor.push({ x, y, key });
      occupied[y * W + x] = 1;
    }
  };
  put(sc.trees, 'decor.tree');
  put(sc.bushes, 'decor.bush');
  put(sc.rocks, 'decor.rock');

  phase('populate');
  const floor = new BitGrid(W, H);
  const reserved: [number, number][] = [];
  const kindCells: Record<string, [number, number][]> = { meadow: [], woods: [], rocky: [] };
  for (let i = 0; i < W * H; i++) {
    if (wet[i] === 1 || wet[i] === 2 || terrainKey[i] !== null) continue;
    const x = i % W;
    const y = Math.floor(i / W);
    floor.set(x, y, 1);
    if (roadMask[i] === 1 || occupied[i] === 1) reserved.push([x, y]);
    const b = biome[i]!;
    const kind =
      b === FOREST ? 'woods' : b === HILL || b === MOUNTAIN || b === SNOW ? 'rocky' : 'meadow';
    kindCells[kind]!.push([x, y]);
  }
  const regions: PopulateRegion[] = ['meadow', 'woods', 'rocky'].map((kind, id) => ({
    id,
    kind,
    cells: kindCells[kind]!,
  }));
  const pop = populate({
    floor,
    regions,
    doors: [],
    entrance: null,
    ruleSet: outdoorRules(theme.rules),
    density: 1,
    rng: rng.fork('populate'),
    blocking: (key) => packKey(key).blocking,
    reserved,
  });
  for (const c of pop.decor) decor.push(c);

  phase('lights');
  const lights: GenLight[] = [];
  const rl = rng.fork('camps');
  for (const r of roads) {
    if (r.path.length < 8 || !rl.chance(0.5)) continue;
    const [x, y] =
      r.path[rl.int(Math.floor(r.path.length / 4), Math.floor((3 * r.path.length) / 4))]!;
    const side = (
      [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const
    )
      .map(([dx, dy]): [number, number] => [x + dx, y + dy])
      .filter(([nx, ny]) => {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
        const i = ny * W + nx;
        return wet[i] === 0 && roadMask[i] === 0 && terrainKey[i] === null && occupied[i] === 0;
      });
    if (side.length > 0) {
      const [cx, cy] = rl.pick(side);
      lights.push({ x: cx + 0.5, y: cy + 0.5, preset: 'campfire' });
    }
  }

  phase('tiles');
  const ground: GenCell[] = [];
  const terrain: GenCell[] = [];
  let waterCells = 0;
  for (let i = 0; i < W * H; i++) {
    const x = i % W;
    const y = Math.floor(i / W);
    ground.push({ x, y, key: groundKey[i]! });
    const t = terrainKey[i] ?? null;
    if (t !== null) terrain.push({ x, y, key: t });
    if (wet[i] !== 0) waterCells++;
  }

  phase('done');
  const first = roads[0];
  const entrance = first === undefined ? null : first.path[0]!;
  const exit = first === undefined ? null : first.path[first.path.length - 1]!;
  const count = (key: string): number => decor.filter((c) => c.key === key).length;
  return {
    generator: 'outdoor',
    gen_version: OUTDOOR_VERSION,
    seed: ctx.seed,
    width: W,
    height: H,
    floors: [
      {
        ground,
        terrain,
        decor,
        walls: [],
        doors: [],
        windows: [],
        lights,
        rooms: [],
        entrance: entrance === null ? null : [entrance[0], entrance[1]],
        exit: exit === null ? null : [exit[0], exit[1]],
      },
    ],
    stats: {
      water_cells: waterCells,
      rivers: rivers.rivers,
      river_dead_ends: rivers.deadEnds,
      roads: roads.length,
      bridges,
      fords,
      trees: count('decor.tree'),
      rocks: count('decor.rock'),
    },
  };
}

export const outdoorGenerator: Generator<OutdoorParams> = {
  id: 'outdoor',
  version: OUTDOOR_VERSION,
  defaults: { ...OUTDOOR_DEFAULTS },
  presets: OUTDOOR_PRESETS,
  validate: validateOutdoor,
  generate,
};
