/** Village generator v1 (§16.4): roads, plots, buildings with interiors, furniture, outdoors. */
import { round3 } from '../geometry';
import { valueNoise2D } from '../noise';
import { VILLAGE_THEMES } from '../themes/village';
import type {
  GenCell,
  GenContext,
  GenDoor,
  GenLight,
  GenResult,
  GenRoom,
  GenWall,
  GenWindow,
  Generator,
} from '../types';
import { OCC_ROAD, placeBuildings, type Building } from './buildings';
import { furnishBuilding, villageRules } from './furnish';
import { planBuilding, type BuildingPlan } from './interior';
import { placeOutdoor } from './outdoor';
import { VILLAGE_DEFAULTS, VILLAGE_PRESETS, validateVillage, type VillageParams } from './params';
import { buildRoads } from './roads';

export type { VillageParams } from './params';
export {
  VILLAGE_DEFAULTS,
  VILLAGE_PRESETS,
  VILLAGE_PRESET_LABELS,
  validateVillage,
} from './params';
export { cutWalls } from './cutwalls';

export const VILLAGE_VERSION = 1;
const PHASES = 9;

function generate(p: VillageParams, ctx: GenContext): GenResult {
  if (ctx.zone !== undefined) throw new Error('zone_unsupported');
  const { rng } = ctx;
  const W = p.width;
  const H = p.height;
  const theme = VILLAGE_THEMES[p.theme];
  const ruleSet = villageRules(theme.rules);
  let step = 0;
  const phase = (name: string): void => ctx.progress(name, step++, PHASES);

  phase('ground');
  const noise = valueNoise2D(rng.fork('ground'), {});
  const key = new Array<string>(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      key[y * W + x] =
        theme.base_alt !== null && noise(x * 0.12, y * 0.12) > 0.3 ? theme.base_alt : theme.base;
    }
  }

  phase('roads');
  const roads = buildRoads(W, H, theme, valueNoise2D(rng.fork('roadnoise'), {}), rng.fork('roads'));
  const occ = new Uint8Array(W * H);
  for (let i = 0; i < occ.length; i++) {
    if (roads.road[i] !== 0) {
      occ[i] = OCC_ROAD;
      key[i] = theme.road;
    }
  }

  phase('plots');
  const buildings = placeBuildings(
    p.buildings,
    p.l_shape_p,
    theme,
    W,
    H,
    occ,
    roads.paths.flat(),
    rng.fork('buildings'),
  );

  phase('interiors');
  const ri = rng.fork('interiors');
  const swing = (r: typeof ri): 'a' | 'b' => (r.chance(0.5) ? 'a' : 'b');
  const roadAt = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < W && y < H && occ[y * W + x] === OCC_ROAD;
  const kept: Building[] = [];
  const plans: BuildingPlan[] = [];
  buildings.forEach((b, k) => {
    const plan = planBuilding(b, p.interiors, swing, roadAt, ri.fork(`b${k}`));
    if (plan === null) return;
    kept.push(b);
    plans.push(plan);
  });

  phase('furniture');
  const rf = rng.fork('furniture');
  const decor: GenCell[] = [];
  const lights: GenLight[] = [];
  const walls: GenWall[] = [];
  const doors: GenDoor[] = [];
  const windows: GenWindow[] = [];
  const rooms: GenRoom[] = [];
  kept.forEach((b, k) => {
    const plan = plans[k]!;
    const rb = rng.fork(`style${k}`);
    const interior = theme.interiors[rb.int(0, theme.interiors.length - 1)]!;
    const wallKind = theme.wall_kinds[rb.int(0, theme.wall_kinds.length - 1)]!;
    for (const room of plan.rooms) {
      for (const [x, y] of room.cells)
        key[y * W + x] = b.type === 'temple' ? 'floor.flagstone' : interior;
      rooms.push({
        id: rooms.length,
        kind: room.kind,
        rect: room.rect === null ? null : { ...room.rect },
        cells: room.cells.length,
      });
    }
    const furniture = furnishBuilding(plan, ruleSet, p.decor, rf.fork(`b${k}`));
    decor.push(...furniture.decor);
    lights.push(...furniture.lights);
    for (const pl of plan.exterior) {
      walls.push({
        points: pl.points.map(([x, y]): [number, number] => [x, y]),
        closed: pl.closed,
        kind: wallKind,
      });
    }
    for (const pl of plan.partitions) {
      walls.push({
        points: pl.points.map(([x, y]): [number, number] => [x, y]),
        closed: pl.closed,
        kind: 'wood',
      });
    }
    doors.push(...plan.doors);
    windows.push(...plan.windows);
  });

  phase('outdoor');
  const out = placeOutdoor({
    W,
    H,
    theme,
    decorLevel: p.decor,
    occ,
    roads,
    buildings: kept,
    strips: plans.map((pl) => pl.entranceOutside),
    rngFence: rng.fork('fences'),
    rngSpots: rng.fork('spots'),
    rngTrees: rng.fork('trees'),
  });
  decor.push(...out.decor);
  lights.push(...out.lights);

  phase('tiles');
  const ground: GenCell[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) ground.push({ x, y, key: key[y * W + x]! });

  phase('done');
  return {
    generator: 'village',
    gen_version: VILLAGE_VERSION,
    seed: ctx.seed,
    width: W,
    height: H,
    floors: [
      {
        ground,
        terrain: [],
        decor,
        walls,
        doors,
        windows,
        lights: lights.map((l) => ({ ...l, x: round3(l.x), y: round3(l.y) })),
        rooms,
        entrance: [roads.entrance[0], roads.entrance[1]],
        exit: [roads.exit[0], roads.exit[1]],
      },
    ],
    stats: {
      buildings: kept.length,
      rooms: rooms.length,
      doors: doors.length,
      windows: windows.length,
      road_cells: roads.cells,
      decor: decor.length,
      lights: lights.length,
    },
  };
}

export const villageGenerator: Generator<VillageParams> = {
  id: 'village',
  version: VILLAGE_VERSION,
  defaults: { ...VILLAGE_DEFAULTS },
  presets: VILLAGE_PRESETS,
  validate: validateVillage,
  generate,
};
