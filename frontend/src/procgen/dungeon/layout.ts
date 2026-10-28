/** Dungeon layout: BSP partition, one room per leaf, and the room graph (links to carve). */
import { kruskal, type Edge } from '../graph';
import type { Rng } from '../prng';
import type { DungeonParams } from './params';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BspNode {
  rect: Rect;
  left: number;
  right: number;
}

export interface Layout {
  rooms: Rect[];
  /** Cell from which corridors leave a room (the corridor brush fits inside the room). */
  anchors: [number, number][];
  /** Links to carve: spanning tree first, then the extra loops. */
  links: Edge[];
}

const MIN_SPLIT_RATIO = 0.2;

/** Recursive partition of the map (border margin 1) into leaves of size ≥ room_min + 2. */
function partition(p: DungeonParams, rng: Rng): { nodes: BspNode[]; leaves: number[] } {
  const nodes: BspNode[] = [
    { rect: { x: 1, y: 1, w: p.width - 2, h: p.height - 2 }, left: -1, right: -1 },
  ];
  const leaves = [0];
  const minLeaf = p.room_min + 2;
  while (leaves.length < p.rooms) {
    let best = -1;
    let bestArea = -1;
    for (let i = 0; i < leaves.length; i++) {
      const r = nodes[leaves[i]!]!.rect;
      if (r.w < 2 * minLeaf && r.h < 2 * minLeaf) continue;
      if (r.w * r.h > bestArea) {
        bestArea = r.w * r.h;
        best = i;
      }
    }
    if (best < 0) break;
    const id = leaves[best]!;
    const r = nodes[id]!.rect;
    const canV = r.w >= 2 * minLeaf;
    const canH = r.h >= 2 * minLeaf;
    let vertical: boolean;
    if (canV && canH) {
      if (r.w * 4 > r.h * 5) vertical = true;
      else if (r.h * 4 > r.w * 5) vertical = false;
      else vertical = rng.chance(0.5);
    } else vertical = canV;
    const len = vertical ? r.w : r.h;
    const lo = Math.max(minLeaf, Math.ceil(len * MIN_SPLIT_RATIO));
    const hi = Math.min(len - minLeaf, Math.floor(len * (1 - MIN_SPLIT_RATIO)));
    const cut = rng.int(lo, hi);
    const a: Rect = vertical ? { ...r, w: cut } : { ...r, h: cut };
    const b: Rect = vertical
      ? { x: r.x + cut, y: r.y, w: r.w - cut, h: r.h }
      : { x: r.x, y: r.y + cut, w: r.w, h: r.h - cut };
    const ia = nodes.push({ rect: a, left: -1, right: -1 }) - 1;
    const ib = nodes.push({ rect: b, left: -1, right: -1 }) - 1;
    nodes[id]!.left = ia;
    nodes[id]!.right = ib;
    leaves.splice(best, 1, ia, ib);
  }
  return { nodes, leaves };
}

const manhattan = (a: readonly [number, number], b: readonly [number, number]): number =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/** Partition, rooms, anchors, and links (BSP siblings ∪ 4 nearest neighbours ⇒ kruskal + loops). */
export function layoutDungeon(p: DungeonParams, rngBsp: Rng, rngRooms: Rng, rngLinks: Rng): Layout {
  const { nodes, leaves } = partition(p, rngBsp);
  const lo = Math.floor((p.corridor - 1) / 2);
  const hi = p.corridor - 1 - lo;
  const rooms: Rect[] = [];
  const anchors: [number, number][] = [];
  const roomOfNode = new Int32Array(nodes.length).fill(-1);
  for (const id of leaves) {
    const leaf = nodes[id]!.rect;
    const w = rngRooms.int(p.room_min, Math.min(p.room_max, leaf.w - 2));
    const h = rngRooms.int(p.room_min, Math.min(p.room_max, leaf.h - 2));
    const x = rngRooms.int(leaf.x + 1, leaf.x + leaf.w - 1 - w);
    const y = rngRooms.int(leaf.y + 1, leaf.y + leaf.h - 1 - h);
    roomOfNode[id] = rooms.length;
    rooms.push({ x, y, w, h });
    const ax = Math.min(Math.max(x + Math.floor(w / 2), x + lo), x + w - 1 - hi);
    const ay = Math.min(Math.max(y + Math.floor(h / 2), y + lo), y + h - 1 - hi);
    anchors.push([ax, ay]);
  }
  const n = rooms.length;

  // BSP siblings: the closest pair of rooms between the two halves of each internal node.
  const sub: number[][] = nodes.map(() => []);
  const sibling: Edge[] = [];
  for (let id = nodes.length - 1; id >= 0; id--) {
    const node = nodes[id]!;
    if (node.left < 0) {
      sub[id] = [roomOfNode[id]!];
      continue;
    }
    const A = sub[node.left]!;
    const B = sub[node.right]!;
    let best: Edge | null = null;
    for (const a of A) {
      for (const b of B) {
        const e: Edge = { a: Math.min(a, b), b: Math.max(a, b), w: 0 };
        const d = manhattan(anchors[a]!, anchors[b]!);
        if (
          best === null ||
          d < best.w ||
          (d === best.w && (e.a < best.a || (e.a === best.a && e.b < best.b)))
        ) {
          best = { ...e, w: d };
        }
      }
    }
    sibling.push({ a: best!.a, b: best!.b, w: 0 });
    sub[id] = A.concat(B);
  }

  // 4 nearest neighbours (Manhattan), deduplicated.
  const knn: Edge[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    const near: { j: number; d: number }[] = [];
    for (let j = 0; j < n; j++)
      if (j !== i) near.push({ j, d: manhattan(anchors[i]!, anchors[j]!) });
    near.sort((u, v) => u.d - v.d || u.j - v.j);
    for (const { j, d } of near.slice(0, 4)) {
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      if (seen.has(a * n + b)) continue;
      seen.add(a * n + b);
      knn.push({ a, b, w: d });
    }
  }

  // Spanning tree (siblings have weight 0, so they come first), then loops among the rest.
  const tree = kruskal(n, sibling.concat(knn));
  const inTree = new Set<number>(tree.map((e) => e.a * n + e.b));
  const rest = knn
    .filter((e) => !inTree.has(e.a * n + e.b))
    .sort((u, v) => u.w - v.w || u.a - v.a || u.b - v.b);
  const links: Edge[] = tree.map((e) => ({ ...e }));
  for (const e of rest) if (rngLinks.chance(p.loops)) links.push(e);
  return { rooms, anchors, links };
}
