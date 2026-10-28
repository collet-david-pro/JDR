/** Structural checks of the village tests (D9): access, walls, doors, windows. */
import { BitGrid, bfsDistances } from '../../src/procgen/grid';
import { packKey } from '../../src/procgen/pack-keys';
import { VILLAGE_THEMES } from '../../src/procgen/themes/village';
import type { GenFloor, GenResult } from '../../src/procgen/types';
import type { VillageParams } from '../../src/procgen/village/params';

type Seg = [[number, number], [number, number]];

export function wallSegs(f: GenFloor): Seg[] {
  const out: Seg[] = [];
  for (const wall of f.walls) {
    const p = wall.points;
    for (let i = 0; i + 1 < p.length; i++) out.push([p[i]!, p[i + 1]!]);
    if (wall.closed && p.length > 1) out.push([p[p.length - 1]!, p[0]!]);
  }
  return out;
}

function overlap([a, b]: Seg, [c, d]: Seg): boolean {
  if (a[1] === b[1] && c[1] === d[1] && a[1] === c[1]) {
    return (
      Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) >
      Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]))
    );
  }
  if (a[0] === b[0] && c[0] === d[0] && a[0] === c[0]) {
    return (
      Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) >
      Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]))
    );
  }
  return false;
}

/** Walls covering an opening, and opening ends that are not wall vertices. */
export function cutProblems(f: GenFloor): string[] {
  const segs = wallSegs(f);
  const vertices = new Set<string>();
  for (const wall of f.walls) for (const [x, y] of wall.points) vertices.add(`${x},${y}`);
  const out: string[] = [];
  const openings: Seg[] = [...f.doors, ...f.windows].map((o) => [o.a, o.b]);
  for (const o of openings) {
    if (segs.some((s) => overlap(s, o))) out.push(`wall over ${JSON.stringify(o)}`);
    for (const end of o) {
      if (!vertices.has(`${end[0]},${end[1]}`))
        out.push(`opening end ${JSON.stringify(end)} off wall ends`);
    }
  }
  return out;
}

export interface Analysis {
  problems: string[];
}

/** All the D9 checks on one result; returns a list of problems (empty = ok). */
export function analyse(r: GenResult, p: VillageParams): string[] {
  const f = r.floors[0]!;
  const { width: W, height: H } = r;
  const theme = VILLAGE_THEMES[p.theme];
  const problems: string[] = [];
  // Interior cells = cells of the room rectangles (interiors: true).
  const roomOf = new Int32Array(W * H).fill(-1);
  f.rooms.forEach((room, i) => {
    const q = room.rect!;
    for (let y = q.y; y < q.y + q.h; y++) {
      for (let x = q.x; x < q.x + q.w; x++) {
        if (roomOf[y * W + x]! !== -1) problems.push(`rooms overlap at ${x},${y}`);
        roomOf[y * W + x] = i;
      }
    }
  });
  const road = (x: number, y: number): boolean =>
    f.ground[y * W + x]!.key === theme.road && roomOf[y * W + x]! === -1;
  let roadCells = 0;
  for (let i = 0; i < W * H; i++) if (f.ground[i]!.key === theme.road) roadCells++;
  if (roadCells !== r.stats['road_cells']) problems.push(`road_cells ${roadCells} != stats`);
  for (let i = 0; i < W * H; i++) {
    if (roomOf[i]! >= 0 && f.ground[i]!.key === theme.road) problems.push('building on a road');
  }
  const blockedDecor = new Uint8Array(W * H);
  for (const d of f.decor) if (packKey(d.key).blocking) blockedDecor[d.y * W + d.x] = 1;
  const ownerKey = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= W || y >= H ? -2 : roomOf[y * W + x]!;
  // Door sides: the two cells of a unit edge.
  const sides = (a: [number, number], b: [number, number]): [[number, number], [number, number]] =>
    a[1] === b[1]
      ? [
          [a[0], a[1] - 1],
          [a[0], a[1]],
        ]
      : [
          [a[0] - 1, a[1]],
          [a[0], a[1]],
        ];
  // Building components (4-adjacency of room cells).
  const comp = new Int32Array(W * H).fill(-1);
  let nComp = 0;
  for (let i = 0; i < W * H; i++) {
    if (roomOf[i]! < 0 || comp[i]! !== -1) continue;
    const st = [i];
    comp[i] = nComp;
    while (st.length > 0) {
      const c = st.pop()!;
      const x = c % W;
      const y = (c - x) / W;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (roomOf[j]! >= 0 && comp[j]! === -1) {
          comp[j] = nComp;
          st.push(j);
        }
      }
    }
    nComp++;
  }
  const doorsOf: number[][] = Array.from({ length: nComp }, () => []);
  const interiorDoors: [number, number][][] = Array.from({ length: nComp }, () => []);
  const entrances: [number, number][] = [];
  const exteriorByComp = new Array<number>(nComp).fill(0);
  f.doors.forEach((d, di) => {
    const [s0, s1] = sides(d.a, d.b);
    const o0 = ownerKey(s0[0], s0[1]);
    const o1 = ownerKey(s1[0], s1[1]);
    if (o0 >= 0 && o1 >= 0) {
      const c = comp[s0[1]! * W + s0[0]]!;
      interiorDoors[c]!.push([di, 0]);
    } else if (o0 >= 0 || o1 >= 0) {
      const inside = o0 >= 0 ? s0 : s1;
      const outside = o0 >= 0 ? s1 : s0;
      const c = comp[inside[1]! * W + inside[0]]!;
      exteriorByComp[c]!++;
      entrances.push(outside);
      doorsOf[c]!.push(inside[1] * W + inside[0]);
      // D9: the outside cell reaches a road over free outdoor ground.
      const free = (x: number, y: number): boolean =>
        roomOf[y * W + x]! === -1 && blockedDecor[y * W + x] === 0;
      const dist = bfsDistances({ w: W, h: H }, free, [outside]);
      let reach = false;
      for (let i = 0; i < W * H && !reach; i++)
        if (dist[i]! >= 0 && road(i % W, Math.floor(i / W))) reach = true;
      if (!reach) problems.push(`entrance ${outside} does not reach a road`);
    } else problems.push('door outside buildings');
  });
  for (let c = 0; c < nComp; c++) {
    if (exteriorByComp[c] !== 1) problems.push(`building ${c} has ${exteriorByComp[c]} entrances`);
  }
  // Rooms reachable from the entrance through the doors.
  const doorEdge = new Set<string>();
  for (const d of f.doors) {
    const [s0, s1] = sides(d.a, d.b);
    doorEdge.add(`${s0},${s1}`);
    doorEdge.add(`${s1},${s0}`);
  }
  for (let c = 0; c < nComp; c++) {
    const start = doorsOf[c]![0];
    if (start === undefined) continue;
    const seen = new Set<number>([start]);
    const st = [start];
    while (st.length > 0) {
      const cur = st.pop()!;
      const x = cur % W;
      const y = (cur - x) / W;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || roomOf[j]! < 0 || seen.has(j)) continue;
        if (roomOf[j]! !== roomOf[cur]! && !doorEdge.has(`${[x, y]},${[nx, ny]}`)) continue;
        seen.add(j);
        st.push(j);
      }
    }
    for (let i = 0; i < W * H; i++) {
      if (comp[i]! === c && !seen.has(i)) {
        problems.push(`building ${c}: room cell ${i % W},${Math.floor(i / W)} unreachable`);
        break;
      }
    }
  }
  // Blocked doors: furniture (blocking decor) must not isolate a door from its entrance.
  const mask = new BitGrid(W, H);
  for (let i = 0; i < W * H; i++) if (roomOf[i]! >= 0) mask.set(i % W, Math.floor(i / W), 1);
  for (let c = 0; c < nComp; c++) {
    const start = doorsOf[c]![0];
    if (start === undefined) continue;
    const free = (x: number, y: number): boolean =>
      roomOf[y * W + x]! >= 0 && blockedDecor[y * W + x] === 0 && comp[y * W + x]! === c;
    const dist = bfsDistances({ w: W, h: H }, (x, y) => free(x, y) || false, [
      [start % W, Math.floor(start / W)],
    ]);
    for (const d of f.doors) {
      const [s0, s1] = sides(d.a, d.b);
      for (const s of [s0, s1]) {
        if (ownerKey(s[0], s[1]) < 0 || comp[s[1]! * W + s[0]] !== c) continue;
        if (blockedDecor[s[1] * W + s[0]] !== 0 || dist[s[1] * W + s[0]]! < 0) {
          problems.push(`door ${JSON.stringify([d.a, d.b])} blocked`);
        }
      }
    }
  }
  // Windows: on exterior walls only.
  for (const w of f.windows) {
    const [s0, s1] = sides(w.a, w.b);
    const o0 = ownerKey(s0[0], s0[1]) >= 0;
    const o1 = ownerKey(s1[0], s1[1]) >= 0;
    if (o0 === o1) problems.push(`window ${JSON.stringify([w.a, w.b])} not on an exterior wall`);
  }
  problems.push(...cutProblems(f));
  void entrances;
  return problems;
}
