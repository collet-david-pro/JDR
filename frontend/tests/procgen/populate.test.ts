import { describe, expect, it } from 'vitest';
import { BitGrid, bfsDistances, components } from '../../src/procgen/grid';
import { packKey } from '../../src/procgen/pack-keys';
import {
  doorFrontCells,
  passageCells,
  populate,
  type PopulateInput,
  type PopulateOpening,
  type PopulateRegion,
} from '../../src/procgen/populate';
import { parseRules, RulesError } from '../../src/procgen/populate-rules';
import { Rng } from '../../src/procgen/prng';

/** '#' = solid, anything else = floor. */
function grid(rows: string[]): BitGrid {
  const g = new BitGrid(rows[0]!.length, rows.length);
  rows.forEach((row, y) => [...row].forEach((ch, x) => g.set(x, y, ch === '#' ? 0 : 1)));
  return g;
}
function region(
  g: BitGrid,
  kind = 'room',
  keep = (_x: number, _y: number) => true,
): PopulateRegion {
  const cells: [number, number][] = [];
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) if (g.get(x, y) && keep(x, y)) cells.push([x, y]);
  return { id: 0, kind, cells };
}
function input(g: BitGrid, items: object[], extra: Partial<PopulateInput> = {}): PopulateInput {
  return {
    floor: g,
    regions: [region(g)],
    doors: [],
    entrance: null,
    ruleSet: parseRules({ kinds: { room: items } }),
    density: 1,
    rng: new Rng('populate-test'),
    blocking: (k) => packKey(k).blocking,
    ...extra,
  };
}
const ROOM = [
  '#########',
  '#.......#',
  '#.......#',
  '#.......#',
  '#.......#',
  '#.......#',
  '#########',
];
const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

describe('populate placement', () => {
  it('wall: next to a wall, turned back to it', () => {
    const g = grid(ROOM);
    const r = populate(
      input(g, [
        { key: 'decor.barrel', count: [6, 6], place: 'wall', rotate: 'wall', min_door_distance: 0 },
      ]),
    );
    expect(r.decor).toHaveLength(6);
    for (const d of r.decor) {
      const side = DIRS.findIndex(([dx, dy]) => g.get(d.x + dx, d.y + dy) === 0);
      expect(side).toBeGreaterThanOrEqual(0);
      expect(d.flags).toBe(side);
    }
  });

  it('corner: the four corners only', () => {
    const g = grid(ROOM);
    const r = populate(
      input(g, [{ key: 'decor.crate', count: [8, 8], place: 'corner', min_door_distance: 0 }]),
    );
    expect(r.decor.map((d) => [d.x, d.y]).sort()).toEqual(
      [
        [1, 1],
        [1, 5],
        [7, 1],
        [7, 5],
      ].sort(),
    );
    expect(r.decor.every((d) => d.flags === undefined)).toBe(true);
  });

  it('center: away from every wall', () => {
    const g = grid(ROOM);
    const r = populate(
      input(g, [{ key: 'decor.rug', count: [50, 50], place: 'center', min_door_distance: 0 }]),
    );
    expect(r.decor).toHaveLength(5 * 3);
    for (const d of r.decor) expect(d.x >= 2 && d.x <= 6 && d.y >= 2 && d.y <= 4).toBe(true);
  });

  it('min_door_distance keeps items away from the openings', () => {
    const rows = [...ROOM];
    rows[3] = '........#';
    const g = grid(rows);
    const door: PopulateOpening = { a: [1, 3], b: [1, 4] };
    expect(doorFrontCells(g, door)).toEqual([
      [0, 3],
      [1, 3],
    ]);
    const r = populate(
      input(g, [{ key: 'decor.rug', count: [99, 99], place: 'any', min_door_distance: 3 }], {
        doors: [door],
        regions: [region(g, 'room', (x) => x >= 1)],
      }),
    );
    const dist = bfsDistances(g, (x, y) => g.get(x, y) !== 0, [
      [0, 3],
      [1, 3],
    ]);
    expect(r.decor.length).toBeGreaterThan(0);
    for (const d of r.decor) expect(dist[d.y * g.w + d.x]).toBeGreaterThanOrEqual(3);
    const eligible = [...dist].filter((v, i) => v >= 3 && i % g.w >= 1).length;
    expect(r.decor).toHaveLength(eligible);
  });

  it('decor = 0 places nothing, and nothing lands on reserved cells', () => {
    const g = grid(ROOM);
    const items = [{ key: 'decor.rug', count: [99, 99], place: 'any', min_door_distance: 0 }];
    const empty = populate(input(g, items, { density: 0 }));
    expect(empty).toEqual({ decor: [], terrain: [], lights: [] });
    const r = populate(input(g, items, { reserved: [[4, 3]], entrance: [2, 2] }));
    expect(r.decor).toHaveLength(35 - 2);
    expect(r.decor.some((d) => (d.x === 4 && d.y === 3) || (d.x === 2 && d.y === 2))).toBe(false);
  });
});

describe('populate passages and doors', () => {
  const rows = [
    '###########',
    '#.........#',
    '#.........#',
    '..........#',
    '#.........#',
    '#..........',
    '#.........#',
    '#.........#',
    '#####.#####',
  ];
  const doors: PopulateOpening[] = [
    { a: [1, 3], b: [1, 4] },
    { a: [10, 5], b: [10, 6] },
    { a: [5, 8], b: [6, 8] },
  ];

  it('protects the shortest paths between the openings of a region', () => {
    const g = grid(rows);
    const regions = [region(g, 'room', (x, y) => x >= 1 && x <= 9 && y <= 7)];
    const passage = passageCells(g, regions, doors);
    // Door 0 → door 1 needs at least 9 + 2 cells inside the room, door 0 → door 2 at least 4 + 4.
    const inside = regions[0]!.cells.filter(([x, y]) => passage[y * g.w + x] === 1);
    expect(inside.length).toBeGreaterThanOrEqual(12);
    for (const d of doors)
      for (const [x, y] of doorFrontCells(g, d)) expect(passage[y * g.w + x]).toBe(1);
    const r = populate(
      input(g, [{ key: 'decor.rug', count: [200, 200], place: 'any', min_door_distance: 0 }], {
        regions,
        doors,
      }),
    );
    for (const d of r.decor) expect(passage[d.y * g.w + d.x]).toBe(0);
    expect(new Set(r.decor.map((d) => d.y * g.w + d.x)).size).toBe(r.decor.length);
  });

  it('never blocks an opening, even with blocking decor everywhere', () => {
    const g = grid(rows);
    for (let s = 0; s < 30; s++) {
      const r = populate(
        input(g, [{ key: 'decor.barrel', count: [200, 200], place: 'any', min_door_distance: 0 }], {
          regions: [region(g, 'room', (x, y) => x >= 1 && x <= 9 && y <= 7)],
          doors,
          entrance: [3, 1],
          rng: new Rng('block-' + s),
        }),
      );
      expect(r.decor.length).toBeGreaterThan(10);
      const blocked = new Set(r.decor.map((d) => d.y * g.w + d.x));
      const free = (x: number, y: number) => g.get(x, y) !== 0 && !blocked.has(y * g.w + x);
      const dist = bfsDistances(g, free, [[3, 1]]);
      for (const d of doors)
        for (const [x, y] of doorFrontCells(g, d)) expect(dist[y * g.w + x]).not.toBe(-1);
      const freeMask = new BitGrid(g.w, g.h);
      for (let y = 0; y < g.h; y++)
        for (let x = 0; x < g.w; x++) freeMask.set(x, y, free(x, y) ? 1 : 0);
      expect(components(freeMask, (v) => v !== 0).sizes).toHaveLength(1);
    }
  });

  it('puts terrain on its own layer', () => {
    const g = grid(ROOM);
    const r = populate(
      input(g, [
        { key: 'terrain.water', count: [5, 5], place: 'any', min_door_distance: 0 },
        { key: 'decor.rug', count: [5, 5], place: 'any', min_door_distance: 0 },
      ]),
    );
    expect(r.terrain).toHaveLength(5);
    expect(r.decor).toHaveLength(5);
    expect(r.terrain.every((c) => c.key === 'terrain.water')).toBe(true);
  });
});

describe('populate lights', () => {
  it('spaces the torches along the walls, on the wall edge', () => {
    const g = grid(['##############', ...Array(10).fill('#............#'), '##############']);
    const r = populate({
      ...input(g, []),
      ruleSet: parseRules({ torches: { spacing: 4, place: 'wall' }, kinds: {} }),
      lightPreset: 'candle',
    });
    expect(r.lights.length).toBeGreaterThan(4);
    for (const l of r.lights) {
      expect(l.preset).toBe('candle');
      expect(l.x === 1 || l.x === 13 || l.y === 1 || l.y === 11).toBe(true);
      expect(Number.isInteger(l.x) !== Number.isInteger(l.y)).toBe(true);
    }
    for (const a of r.lights) {
      for (const b of r.lights) {
        if (a !== b)
          expect((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)).toBeGreaterThanOrEqual(16);
      }
    }
  });
});

describe('parseRules', () => {
  const bad: [unknown, RegExp][] = [
    [null, /expected an object/],
    [
      { kinds: { a: [{ key: 'decor.nope', count: [1, 1], place: 'any' }] } },
      /kinds\.a\[0\]\.key: unknown pack key/,
    ],
    [
      { kinds: { a: [{ key: 'decor.rug', count: [1, 1], place: 'roof' }] } },
      /\.place: expected one of/,
    ],
    [{ kinds: { a: [{ key: 'decor.rug', place: 'any' }] } }, /needs density or count/],
    [{ kinds: { a: [{ key: 'decor.rug', count: [3, 1], place: 'any' }] } }, /min <= max/],
    [
      { kinds: { a: [{ key: 'floor.wood', count: [1, 1], place: 'any' }] } },
      /does not belong to layer/,
    ],
    [
      { kinds: { a: [{ key: 'decor.rug', density: 2, place: 'any' }] } },
      /density: expected a number in/,
    ],
    [{ room_kinds: { storage: 1 }, kinds: {} }, /"common"/],
    [{ torches: { spacing: 0 }, kinds: {} }, /torches\.spacing/],
  ];
  it('rejects malformed rules with the path of the problem', () => {
    for (const [json, msg] of bad) {
      expect(() => parseRules(json, 'r')).toThrow(RulesError);
      expect(() => parseRules(json, 'r')).toThrow(msg);
    }
  });

  it('applies the item defaults', () => {
    const set = parseRules({
      room_kinds: { common: 2 },
      kinds: { a: [{ key: 'terrain.mud', density: 0.1, place: 'any' }] },
    });
    expect(set.kinds.get('a')).toEqual([
      {
        key: 'terrain.mud',
        density: 0.1,
        count: null,
        place: 'any',
        min_door_distance: 1,
        rotate: 'none',
        layer: 'terrain',
      },
    ]);
    expect(set.torches).toBeNull();
    expect(set.room_kinds).toEqual([{ kind: 'common', weight: 2 }]);
  });
});
