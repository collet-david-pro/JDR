/** Building interiors: room subdivision, doors (spanning tree), windows and cut walls. */
import { chainSegments, maskOutline, type Polyline, type Segment } from '../geometry';
import { BitGrid } from '../grid';
import type { Rng } from '../prng';
import type { BuildingType } from '../themes/village';
import type { GenDoor, GenWindow } from '../types';
import type { Building } from './buildings';
import { cutWalls } from './cutwalls';
import {
  insideCell,
  outsideCell,
  sideUnits,
  unitKey,
  unitNeighbours,
  type Cell,
  type Rect,
  type Side,
} from './geom';

export interface Room {
  /** Rectangle of the room, or null for an L-shaped building without interiors. */
  rect: Rect | null;
  kind: string;
  cells: Cell[];
}

export interface BuildingPlan {
  rooms: Room[];
  /** All the doors (the entrance first). */
  doors: GenDoor[];
  windows: GenWindow[];
  /** Cell just inside the entrance door, and the one just outside it. */
  entranceInside: Cell;
  entranceOutside: Cell;
  /** Cut walls: exterior outline and partitions. */
  exterior: Polyline[];
  partitions: Polyline[];
}

/** Room kinds of each building type: the room of the entrance, then the others by area. */
const TEMPLATES: Readonly<Record<BuildingType, { main: string; rest: readonly string[] }>> = {
  tavern: { main: 'tavern_hall', rest: ['kitchen', 'bedroom', 'bedroom', 'bedroom', 'storage'] },
  forge: { main: 'workshop', rest: ['living', 'storage'] },
  temple: { main: 'nave', rest: ['vestry', 'storage'] },
  house: { main: 'living', rest: ['bedroom', 'bedroom', 'storage'] },
  farm: { main: 'barn', rest: ['living', 'bedroom'] },
  storehouse: { main: 'storage', rest: ['storage', 'storage'] },
  shop: { main: 'shop_floor', rest: ['storage', 'living'] },
};

const MIN_ROOM = 3;

/** Splits a rectangle into about `target` rooms of at least 3 x 3 (largest room first). */
function subdivide(r: Rect, target: number, rng: Rng): Rect[] {
  const leaves: Rect[] = [r];
  while (leaves.length < target) {
    let best = -1;
    for (let i = 0; i < leaves.length; i++) {
      const l = leaves[i]!;
      if (l.w < 2 * MIN_ROOM && l.h < 2 * MIN_ROOM) continue;
      const b = best < 0 ? null : leaves[best]!;
      if (b === null || l.w * l.h > b.w * b.h) best = i;
    }
    if (best < 0) break;
    const l = leaves[best]!;
    const canV = l.w >= 2 * MIN_ROOM;
    const canH = l.h >= 2 * MIN_ROOM;
    const vertical = canV && canH ? l.w >= l.h : canV;
    const len = vertical ? l.w : l.h;
    const cut = rng.int(MIN_ROOM, len - MIN_ROOM);
    const a: Rect = vertical ? { ...l, w: cut } : { ...l, h: cut };
    const b: Rect = vertical
      ? { x: l.x + cut, y: l.y, w: l.w - cut, h: l.h }
      : { x: l.x, y: l.y + cut, w: l.w, h: l.h - cut };
    leaves.splice(best, 1, a, b);
  }
  return leaves;
}

function targetRooms(type: BuildingType, rng: Rng): number {
  switch (type) {
    case 'tavern':
      return rng.int(4, 6);
    case 'forge':
    case 'shop':
      return 2;
    case 'temple':
    case 'storehouse':
    case 'farm':
      return rng.int(1, 2);
    default:
      return rng.int(2, 3);
  }
}

const SIDES: readonly Side[] = ['N', 'E', 'S', 'W'];

export function planBuilding(
  b: Building,
  interiors: boolean,
  swing: (rng: Rng) => 'a' | 'b',
  roadAt: (x: number, y: number) => boolean,
  rng: Rng,
): BuildingPlan | null {
  const front = b.front;
  const tpl = TEMPLATES[b.type];
  // Bounding box and cell ownership (local arrays).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of b.rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  const bw = maxX - minX;
  const bh = maxY - minY;
  const owner = new Int16Array(bw * bh).fill(-1);
  const ownerAt = (x: number, y: number): number =>
    x < minX || y < minY || x >= maxX || y >= maxY ? -1 : owner[(y - minY) * bw + x - minX]!;

  // 1. Rooms.
  let rects: (Rect | null)[];
  if (!interiors) rects = [b.rects.length === 1 ? b.rects[0]! : null];
  else {
    const total = targetRooms(b.type, rng);
    const areas = b.rects.map((r) => r.w * r.h);
    const sum = areas.reduce((s, v) => s + v, 0);
    rects = [];
    b.rects.forEach((r, i) => {
      const share =
        b.rects.length === 1 ? total : Math.max(1, Math.round((total * areas[i]!) / sum));
      rects.push(...subdivide(r, share, rng));
    });
  }
  const rooms: Room[] = rects.map((rect) => ({ rect, kind: '', cells: [] }));
  if (rects.length === 1 && rects[0] === null) {
    for (const r of b.rects) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          owner[(y - minY) * bw + x - minX] = 0;
          rooms[0]!.cells.push([x, y]);
        }
      }
    }
  } else {
    rooms.forEach((room, i) => {
      const r = room.rect!;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          owner[(y - minY) * bw + x - minX] = i;
          room.cells.push([x, y]);
        }
      }
    });
  }

  // 2. Entrance: the largest room touching the front line of the main rectangle.
  const main = b.rects[0]!;
  const frontLine =
    front === 'N'
      ? main.y
      : front === 'S'
        ? main.y + main.h
        : front === 'W'
          ? main.x
          : main.x + main.w;
  // Front rooms by decreasing area; the door goes where the road is right behind the strip.
  const frontRooms: number[] = [];
  rooms.forEach((room, i) => {
    const r = room.rect ?? main;
    const line = front === 'N' ? r.y : front === 'S' ? r.y + r.h : front === 'W' ? r.x : r.x + r.w;
    if (line === frontLine) frontRooms.push(i);
  });
  const areaOf = (i: number): number => {
    const r = rooms[i]!.rect ?? main;
    return r.w * r.h;
  };
  frontRooms.sort((p, q) => areaOf(q) - areaOf(p) || p - q);
  let entranceRoom = -1;
  let entranceUnit: Segment | null = null;
  for (const i of frontRooms) {
    const units = sideUnits(rooms[i]!.rect ?? main, front);
    const cands: Segment[] = [];
    for (let k = 1; k <= units.length - 2; k++) {
      const [ox, oy] = outsideCell(units[k]!, front);
      if (roadAt(ox - b.d[0], oy - b.d[1])) cands.push(units[k]!);
    }
    if (cands.length === 0) continue;
    entranceRoom = i;
    entranceUnit = cands[rng.int(0, cands.length - 1)]!;
    break;
  }
  if (entranceUnit === null) return null;
  const entranceInside = insideCell(entranceUnit, front);
  const entranceOutside = outsideCell(entranceUnit, front);

  // 3. Room kinds: main kind for the entrance room, the others by decreasing area.
  rooms[entranceRoom]!.kind = tpl.main;
  const others = rooms
    .map((_, i) => i)
    .filter((i) => i !== entranceRoom)
    .sort((p, q) => {
      const rp = rooms[p]!.rect!;
      const rq = rooms[q]!.rect!;
      return rq.w * rq.h - rp.w * rp.h || rp.y - rq.y || rp.x - rq.x || p - q;
    });
  others.forEach((i, k) => {
    rooms[i]!.kind = tpl.rest[Math.min(k, tpl.rest.length - 1)]!;
  });

  // 4. Doors: entrance, then a random spanning tree over the shared walls (≥ 3 cells long).
  const doors: GenDoor[] = [
    {
      a: [entranceUnit.a[0], entranceUnit.a[1]],
      b: [entranceUnit.b[0], entranceUnit.b[1]],
      secret: false,
      locked: false,
      swing: swing(rng),
    },
  ];
  const shared = new Map<number, Segment[]>();
  const partition: Segment[] = [];
  const key = (p: number, q: number): number => Math.min(p, q) * 1024 + Math.max(p, q);
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const o = ownerAt(x, y);
      if (o < 0) continue;
      const right = ownerAt(x + 1, y);
      const down = ownerAt(x, y + 1);
      if (right >= 0 && right !== o) {
        const s: Segment = { a: [x + 1, y], b: [x + 1, y + 1] };
        partition.push(s);
        const list = shared.get(key(o, right));
        if (list === undefined) shared.set(key(o, right), [s]);
        else list.push(s);
      }
      if (down >= 0 && down !== o) {
        const s: Segment = { a: [x, y + 1], b: [x + 1, y + 1] };
        partition.push(s);
        const list = shared.get(key(o, down));
        if (list === undefined) shared.set(key(o, down), [s]);
        else list.push(s);
      }
    }
  }
  const adjacency: number[][] = rooms.map(() => []);
  const wallOf = (p: number, q: number): Segment[] | undefined => shared.get(key(p, q));
  for (let p = 0; p < rooms.length; p++) {
    for (let q = p + 1; q < rooms.length; q++) {
      const w = wallOf(p, q);
      if (w !== undefined && w.length >= MIN_ROOM) {
        adjacency[p]!.push(q);
        adjacency[q]!.push(p);
      }
    }
  }
  const visited = new Uint8Array(rooms.length);
  const inTree = new Set<number>();
  const makeDoor = (p: number, q: number): void => {
    const w = wallOf(p, q)!;
    const u = w[rng.int(1, w.length - 2)]!;
    doors.push({
      a: [u.a[0], u.a[1]],
      b: [u.b[0], u.b[1]],
      secret: false,
      locked: false,
      swing: swing(rng),
    });
  };
  const stack = [entranceRoom];
  visited[entranceRoom] = 1;
  while (stack.length > 0) {
    const cur = stack[stack.length - 1]!;
    const next = adjacency[cur]!.filter((n) => visited[n] === 0);
    if (next.length === 0) {
      stack.pop();
      continue;
    }
    const n = next[rng.int(0, next.length - 1)]!;
    visited[n] = 1;
    inTree.add(key(cur, n));
    makeDoor(cur, n);
    stack.push(n);
  }
  for (let p = 0; p < rooms.length; p++) {
    for (const q of adjacency[p]!) {
      if (q > p && !inTree.has(key(p, q)) && rng.chance(0.2)) makeDoor(p, q);
    }
  }

  // 5. Windows on exterior runs, one per about 4 cells, never in a corner or next to an opening.
  const used = new Set<number>(doors.map((d) => unitKey({ a: d.a, b: d.b })));
  const windows: GenWindow[] = [];
  const kind: GenWindow['kind'] =
    b.type === 'storehouse' ? 'bars' : b.type === 'farm' ? 'opening' : 'glass';
  const isExterior = (u: Segment, side: Side): boolean => {
    const [ox, oy] = outsideCell(u, side);
    return ownerAt(ox, oy) < 0;
  };
  const windowRects = rooms.flatMap((room) => (room.rect === null ? b.rects : [room.rect]));
  for (const rect of windowRects) {
    for (const side of SIDES) {
      const units = sideUnits(rect, side);
      let s = 0;
      while (s < units.length) {
        if (!isExterior(units[s]!, side)) {
          s++;
          continue;
        }
        let e = s;
        while (e < units.length && isExterior(units[e]!, side)) e++;
        const run = units.slice(s, e);
        s = e;
        const n = Math.floor((run.length + 1) / 4);
        if (n === 0 || run.length < 3) continue;
        const idx: number[] = [];
        for (let k = 1; k <= run.length - 2; k++) idx.push(k);
        rng.shuffle(idx);
        let placed = 0;
        for (const k of idx) {
          if (placed >= n) break;
          const u = run[k]!;
          const [prev, nextU] = unitNeighbours(u);
          if (used.has(unitKey(u)) || used.has(unitKey(prev)) || used.has(unitKey(nextU))) continue;
          used.add(unitKey(u));
          placed++;
          windows.push({ a: [u.a[0], u.a[1]], b: [u.b[0], u.b[1]], kind });
        }
      }
    }
  }

  // 6. Walls: exterior outline and partitions, cut under every door and window.
  const mask = new BitGrid(bw + 2, bh + 2);
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++)
      if (ownerAt(x, y) >= 0) mask.set(x - minX + 1, y - minY + 1, 1);
  }
  const shift = (s: Segment): Segment => ({
    a: [s.a[0] + minX - 1, s.a[1] + minY - 1],
    b: [s.b[0] + minX - 1, s.b[1] + minY - 1],
  });
  const openings: Segment[] = [
    ...doors.map((d): Segment => ({ a: d.a, b: d.b })),
    ...windows.map((w): Segment => ({ a: w.a, b: w.b })),
  ];
  const ext = cutWalls(maskOutline(mask).map(shift), openings);
  const part = cutWalls(partition, openings);
  return {
    rooms,
    doors,
    windows,
    entranceInside,
    entranceOutside,
    exterior: chainSegments(ext),
    partitions: chainSegments(part),
  };
}
