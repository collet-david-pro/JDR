/** Room typing (§16.2 step 8): entrance, exit, boss, treasure, then weighted kinds from the rules. */
import type { Rng } from '../prng';
import type { RuleSet } from '../populate-rules';
import type { Junction } from './doors';
import type { Rect } from './layout';

export interface KindInput {
  rooms: readonly Rect[];
  centers: readonly (readonly [number, number])[];
  entrance: number;
  exit: number;
  /** BFS distances from the entrance center (-1 = unreachable). */
  distFromEntrance: Int32Array;
  width: number;
  junctions: readonly Junction[];
  /** Corridor component label of each cell (-1 = not a corridor cell). */
  corridorLabel: Int32Array;
  ruleSet: RuleSet;
  rng: Rng;
}

/** Degree of each room in the final graph: rooms reached through a shared corridor component. */
export function roomDegrees(
  n: number,
  junctions: readonly Junction[],
  corridorLabel: Int32Array,
  width: number,
): number[] {
  const byComp = new Map<number, number[]>();
  for (const j of junctions) {
    const label = corridorLabel[j.outside[1] * width + j.outside[0]]!;
    if (label < 0) continue;
    const list = byComp.get(label);
    if (list === undefined) byComp.set(label, [j.room]);
    else if (!list.includes(j.room)) list.push(j.room);
  }
  const adj = new Uint8Array(n * n);
  for (const list of byComp.values()) {
    for (const a of list) for (const b of list) if (a !== b) adj[a * n + b] = 1;
  }
  const deg: number[] = [];
  for (let a = 0; a < n; a++) {
    let d = 0;
    for (let b = 0; b < n; b++) d += adj[a * n + b]!;
    deg.push(d);
  }
  return deg;
}

export function assignKinds(k: KindInput): string[] {
  const n = k.rooms.length;
  const kinds: (string | null)[] = new Array<string | null>(n).fill(null);
  kinds[k.entrance] = 'entrance';
  kinds[k.exit] = 'exit';
  const distOf = (r: number): number => {
    const c = k.centers[r]!;
    return k.distFromEntrance[c[1] * k.width + c[0]]!;
  };
  // Boss: the largest room at ≥ 60 % of the farthest distance from the entrance.
  if (n >= 5) {
    let maxD = 0;
    for (let r = 0; r < n; r++) maxD = Math.max(maxD, distOf(r));
    let boss = -1;
    for (let r = 0; r < n; r++) {
      if (kinds[r] !== null || distOf(r) * 10 < maxD * 6) continue;
      const area = k.rooms[r]!.w * k.rooms[r]!.h;
      if (boss < 0 || area > k.rooms[boss]!.w * k.rooms[boss]!.h) boss = r;
    }
    if (boss >= 0) kinds[boss] = 'boss';
  }
  // Treasure: dead ends (degree 1), at most about one room in six.
  const deg = roomDegrees(n, k.junctions, k.corridorLabel, k.width);
  const deadEnds: number[] = [];
  for (let r = 0; r < n; r++) if (kinds[r] === null && deg[r] === 1) deadEnds.push(r);
  k.rng.shuffle(deadEnds);
  const maxTreasure = Math.max(1, Math.round(n / 6));
  for (const r of deadEnds.slice(0, maxTreasure)) kinds[r] = 'treasure';
  const pool =
    k.ruleSet.room_kinds.length > 0 ? k.ruleSet.room_kinds : [{ kind: 'common', weight: 1 }];
  return kinds.map((kind) => kind ?? k.rng.weighted(pool, (e) => e.weight).kind);
}
