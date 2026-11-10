/**
 * Generic invariants of a GenResult, shared by every generator (geometry, cells, pack keys), and
 * of its application to an editor map (apply.ts + bind.ts + MapDocument validation). Each check
 * returns a list of problems (empty = ok) so a sweep can report the first failing seed.
 */
import { EditorSession } from '../../src/editor/ui/session';
import { applyGeneration } from '../../src/lib/procgen/apply';
import { PACK_KEYS, packKey } from '../../src/procgen/pack-keys';
import type { GenFloor, GenResult } from '../../src/procgen/types';
import { grid } from '../editor/helpers';

type Pt = readonly [number, number];
type Seg = readonly [Pt, Pt];

const KNOWN = new Map(PACK_KEYS.map((k) => [k.key, k]));

/** Every pack key as an asset: the apply step resolves all of them. */
export const FULL_PACK = {
  assets: Object.fromEntries(
    PACK_KEYS.map((k, i) => [
      k.key,
      { asset_id: String(100 + i), url: `u/${k.key}`, name: k.name },
    ]),
  ),
};

/** Segments of the walls (closing segment included). */
export function segmentsOf(f: GenFloor): Seg[] {
  const out: Seg[] = [];
  for (const w of f.walls) {
    const p = w.points;
    for (let i = 0; i + 1 < p.length; i++) out.push([p[i]!, p[i + 1]!]);
    if (w.closed && p.length > 2) out.push([p[p.length - 1]!, p[0]!]);
  }
  return out;
}

const axisAligned = ([a, b]: Seg): boolean => a[0] === b[0] || a[1] === b[1];

/** Collinear axis-aligned segments sharing more than a point. */
function overlapping([a, b]: Seg, [c, d]: Seg): boolean {
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

export interface GeometryOptions {
  /** Walls, doors and windows on cell borders only (dungeon, village). */
  grid: boolean;
  /** Openings never lie on the outer border of the map (village buildings). */
  noBorderOpenings?: boolean;
  /** The ground layer covers every cell (outdoor, village). */
  fullGround?: boolean;
}

/** Cells, keys, walls, openings and lights of a result. */
export function resultProblems(r: GenResult, opts: GeometryOptions): string[] {
  const out: string[] = [];
  const { width: W, height: H } = r;
  const f = r.floors[0];
  if (r.floors.length !== 1 || f === undefined) return [`${r.floors.length} floors`];
  const inMap = (p: Pt): boolean => p[0] >= 0 && p[1] >= 0 && p[0] <= W && p[1] <= H;
  const finite = (p: Pt): boolean => Number.isFinite(p[0]) && Number.isFinite(p[1]);

  // Cells: in the map, known key of the right layer; the ground covers every cell once.
  for (const layer of ['ground', 'terrain', 'decor'] as const) {
    const seen = new Set<number>();
    for (const c of f[layer]) {
      if (
        !Number.isInteger(c.x) ||
        !Number.isInteger(c.y) ||
        c.x < 0 ||
        c.y < 0 ||
        c.x >= W ||
        c.y >= H
      ) {
        out.push(`${layer} cell ${c.x},${c.y} outside the map`);
        continue;
      }
      const i = c.y * W + c.x;
      if (seen.has(i)) out.push(`${layer} cell ${c.x},${c.y} twice`);
      seen.add(i);
      const info = KNOWN.get(c.key);
      if (info === undefined) out.push(`unknown pack key ${c.key}`);
      else if (info.layer !== layer) out.push(`${c.key} on the ${layer} layer`);
    }
    if (layer === 'ground' && opts.fullGround === true && seen.size !== W * H)
      out.push(`ground covers ${seen.size} of ${W * H} cells`);
  }

  // Walls: at least 2 points, in the map, no zero-length segment, no overlap.
  const segs = segmentsOf(f);
  for (const w of f.walls) {
    if (w.points.length < 2) out.push(`wall with ${w.points.length} point(s)`);
    for (const p of w.points) {
      if (!finite(p) || !inMap(p)) out.push(`wall point ${p} outside the map`);
      else if (opts.grid && (!Number.isInteger(p[0]) || !Number.isInteger(p[1])))
        out.push(`wall point ${p} off the grid`);
    }
  }
  for (const s of segs) {
    if (s[0][0] === s[1][0] && s[0][1] === s[1][1]) out.push(`zero-length wall at ${s[0]}`);
    if (opts.grid && !axisAligned(s)) out.push(`wall ${JSON.stringify(s)} not axis-aligned`);
  }
  if (opts.grid) {
    const byLine = new Map<string, Seg[]>();
    for (const s of segs) {
      if (!axisAligned(s)) continue;
      const k = s[0][1] === s[1][1] ? `h${s[0][1]}` : `v${s[0][0]}`;
      const list = byLine.get(k);
      if (list === undefined) byLine.set(k, [s]);
      else list.push(s);
    }
    for (const list of byLine.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (overlapping(list[i]!, list[j]!))
            out.push(`walls overlap: ${JSON.stringify(list[i])} ${JSON.stringify(list[j])}`);
        }
      }
    }
  }

  // Openings: in the map, a valid length, on the grid, never covered by a wall.
  const openings: [string, Pt, Pt][] = [
    ...f.doors.map((d): [string, Pt, Pt] => ['door', d.a, d.b]),
    ...f.windows.map((w): [string, Pt, Pt] => ['window', w.a, w.b]),
  ];
  const seenOpening = new Set<string>();
  for (const [kind, a, b] of openings) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!finite(a) || !finite(b) || !inMap(a) || !inMap(b)) out.push(`${kind} ${a}-${b} outside`);
    if (len < 0.1 || len > 20) out.push(`${kind} ${a}-${b} length ${len}`);
    if (opts.grid && !axisAligned([a, b])) out.push(`${kind} ${a}-${b} not axis-aligned`);
    if (segs.some((s) => overlapping(s, [a, b]))) out.push(`wall over the ${kind} ${a}-${b}`);
    const key = [a, b]
      .map((p) => p.join(','))
      .sort()
      .join('|');
    if (seenOpening.has(key)) out.push(`two openings at ${key}`);
    seenOpening.add(key);
    if (opts.noBorderOpenings === true) {
      const onBorder =
        (a[0] === b[0] && (a[0] === 0 || a[0] === W)) ||
        (a[1] === b[1] && (a[1] === 0 || a[1] === H));
      if (onBorder) out.push(`${kind} ${a}-${b} on the map border`);
    }
  }

  // Lights inside the map.
  for (const l of f.lights) {
    if (!finite([l.x, l.y]) || l.x < 0 || l.y < 0 || l.x > W || l.y > H)
      out.push(`light ${l.x},${l.y} outside the map`);
  }
  return out;
}

/** Blocking decor (furniture, trees, fences...) on the given cells. */
export function blockingOn(f: GenFloor, W: number, cells: (i: number) => boolean): string[] {
  const out: string[] = [];
  for (const d of f.decor) {
    if (packKey(d.key).blocking && cells(d.y * W + d.x)) out.push(`${d.key} at ${d.x},${d.y}`);
  }
  return out;
}

/**
 * Applies the result to an editor map exactly as the "Générer" panel does (map target) and
 * compares the map document with the result: nothing dropped, moved or rejected.
 */
export function applyProblems(r: GenResult, snapStep?: number): string[] {
  const out: string[] = [];
  const f = r.floors[0]!;
  let n = 0;
  const s = new EditorSession({ grid: grid(r.width, r.height), newUid: () => `g${++n}` });
  // The snapping step of the map (1 to 1/8 cell) is for the drawing tools: never for the apply.
  if (snapStep !== undefined) s.doc.apply([{ type: 'map.meta', ambient: { snap_step: snapStep } }]);
  try {
    applyGeneration(s, { result: r, pack: FULL_PACK, target: 'map' });
  } catch (e) {
    return [`apply failed: ${String(e)}`];
  }
  const objects = s.doc.objects();
  const count = (type: string): number => objects.filter((o) => o.type === type).length;
  const expected: [string, number][] = [
    ['wall', f.walls.length],
    ['door', f.doors.length],
    ['window', f.windows.length],
    ['light', f.lights.length],
  ];
  for (const [type, want] of expected) {
    if (count(type) !== want) out.push(`${type}: ${count(type)} on the map, ${want} generated`);
  }
  // Walls and openings keep their exact coordinates.
  const walls = objects.flatMap((o) =>
    o.type === 'wall' ? [JSON.stringify(o.geometry.points)] : [],
  );
  const want = f.walls.map((w) => JSON.stringify(w.points));
  if (JSON.stringify([...walls].sort()) !== JSON.stringify([...want].sort()))
    out.push('wall geometry changed by the apply step');
  const ops = objects.flatMap((o) =>
    o.type === 'door' || o.type === 'window'
      ? [JSON.stringify([o.type, o.geometry.a, o.geometry.b])]
      : [],
  );
  const wantOps = [
    ...f.doors.map((d) => JSON.stringify(['door', d.a, d.b])),
    ...f.windows.map((w) => JSON.stringify(['window', w.a, w.b])),
  ];
  if (JSON.stringify([...ops].sort()) !== JSON.stringify([...wantOps].sort()))
    out.push('door / window geometry changed by the apply step');
  // Tiles: every generated cell is on the map with its key's asset.
  const indexOf = new Map<string, number>();
  s.doc.palette.forEach((p, i) => {
    if (p !== null) indexOf.set(p.assetId, i);
  });
  for (const layer of ['ground', 'terrain', 'decor'] as const) {
    for (const c of f[layer]) {
      const want = indexOf.get(FULL_PACK.assets[c.key]!.asset_id);
      const got = s.doc.getCell(layer, c.x, c.y);
      if (got.index !== want || got.flags !== (c.flags ?? 0)) {
        out.push(`${layer} ${c.x},${c.y}: ${got.index} on the map, ${c.key} generated`);
        break;
      }
    }
  }
  return out;
}
