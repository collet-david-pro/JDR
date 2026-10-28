/** Interior furnishing of a building through the declarative population engine (D8). */
import { round3 } from '../geometry';
import { BitGrid } from '../grid';
import { packKey } from '../pack-keys';
import { populate } from '../populate';
import { parseRules, type RuleSet } from '../populate-rules';
import type { Rng } from '../prng';
import rural from '../rules/village/rural.json';
import town from '../rules/village/town.json';
import type { GenCell, GenLight } from '../types';
import type { BuildingPlan } from './interior';

const RULE_FILES: Readonly<Record<string, unknown>> = { rural, town };
const ruleCache = new Map<string, RuleSet>();

/** Parsed furnishing rules of a village rules file (validated once). */
export function villageRules(name: string): RuleSet {
  let set = ruleCache.get(name);
  if (set === undefined) {
    const json = RULE_FILES[name];
    if (json === undefined) throw new Error(`Unknown village rules: ${name}`);
    set = parseRules(json, `village/${name}`);
    ruleCache.set(name, set);
  }
  return set;
}

export function furnishBuilding(
  plan: BuildingPlan,
  ruleSet: RuleSet,
  density: number,
  rng: Rng,
): { decor: GenCell[]; lights: GenLight[] } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const room of plan.rooms) {
    for (const [x, y] of room.cells) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const ox = minX - 1;
  const oy = minY - 1;
  const floor = new BitGrid(maxX - minX + 3, maxY - minY + 3);
  for (const room of plan.rooms) for (const [x, y] of room.cells) floor.set(x - ox, y - oy, 1);
  const res = populate({
    floor,
    regions: plan.rooms.map((room, id) => ({
      id,
      kind: room.kind,
      cells: room.cells.map(([x, y]): [number, number] => [x - ox, y - oy]),
    })),
    doors: plan.doors.map((d) => ({
      a: [d.a[0] - ox, d.a[1] - oy] as const,
      b: [d.b[0] - ox, d.b[1] - oy] as const,
    })),
    entrance: [plan.entranceInside[0] - ox, plan.entranceInside[1] - oy],
    ruleSet,
    density: density * 2,
    rng,
    blocking: (key) => packKey(key).blocking,
  });
  return {
    decor: res.decor.map((c) => ({ ...c, x: c.x + ox, y: c.y + oy })),
    lights: res.lights.map((l) => ({ ...l, x: round3(l.x + ox), y: round3(l.y + oy) })),
  };
}
