/** One top-down pictogram per `decor.*` key, drawn on a unit square (margin about 8 %). */
import { rgb, type Canvas, type Color, type Pt, type Style } from './raster';

const WOOD = rgb(0x9a6a37);
const WOOD_LIGHT = rgb(0xb88548);
const WOOD_DARK = rgb(0x4a2d14);
const STONE = rgb(0x93959b);
const STONE_LIGHT = rgb(0xb4b6bb);
const STONE_DARK = rgb(0x34363b);
const GREEN = rgb(0x4f9a45);
const GREEN_LIGHT = rgb(0x6cb85a);
const GREEN_DARK = rgb(0x1f4d1c);
const FIRE = rgb(0xf5c542);
const ORANGE = rgb(0xf08a24);
const WATER = rgb(0x4f8fd1);
const WATER_DARK = rgb(0x12304f);
const METAL = rgb(0x6f7782);
const WHITE = rgb(0xf1ece0);

const fs = (fill: Color, stroke: Color, sw = 0.02): Style => ({ fill, stroke, sw });
const alpha = (c: Color, a: number): Color => [c[0], c[1], c[2], a];

/** Closed polygon around (cx, cy) with per-vertex radii, starting at the top, clockwise. */
function blob(cx: number, cy: number, radii: number[], turn = 0): Pt[] {
  // Fixed unit directions of a regular 12-gon (no trigonometry), sampled at the requested count.
  const dirs: Pt[] = [
    [0, -1],
    [0.5, -0.866],
    [0.866, -0.5],
    [1, 0],
    [0.866, 0.5],
    [0.5, 0.866],
    [0, 1],
    [-0.5, 0.866],
    [-0.866, 0.5],
    [-1, 0],
    [-0.866, -0.5],
    [-0.5, -0.866],
  ];
  const step = 12 / radii.length;
  return radii.map((r, i) => {
    const d = dirs[(Math.round(i * step) + turn) % 12]!;
    return [cx + d[0] * r, cy + d[1] * r];
  });
}

export const DRAWERS: Record<string, (c: Canvas) => void> = {
  rock(c) {
    c.polygon(
      blob(0.5, 0.5, [0.4, 0.42, 0.36, 0.41, 0.38, 0.42, 0.35, 0.4]),
      fs(STONE, STONE_DARK),
    );
    c.polygon(blob(0.46, 0.45, [0.2, 0.22, 0.19, 0.22, 0.2, 0.21]), { fill: STONE_LIGHT });
    c.line(0.52, 0.55, 0.66, 0.72, 0.025, { fill: STONE_DARK });
  },
  stalagmite(c) {
    c.disc(0.5, 0.5, 0.4, fs(rgb(0x7d776c), STONE_DARK));
    c.disc(0.5, 0.5, 0.27, fs(rgb(0x9a9486), rgb(0x56524a), 0.012));
    c.disc(0.5, 0.5, 0.13, fs(rgb(0xb9b3a3), rgb(0x56524a), 0.012));
  },
  puddle(c) {
    c.ellipse(0.5, 0.52, 0.42, 0.3, fs(alpha(WATER, 170), WATER_DARK));
    c.ellipse(0.4, 0.46, 0.14, 0.07, { fill: alpha(rgb(0xcfe6fa), 150) });
  },
  mushroom(c) {
    c.disc(0.5, 0.5, 0.4, fs(rgb(0xc23b2e), rgb(0x4a1410)));
    for (const [x, y, r] of [
      [0.38, 0.38, 0.07],
      [0.62, 0.42, 0.06],
      [0.5, 0.64, 0.07],
      [0.3, 0.6, 0.045],
    ] as const) {
      c.disc(x, y, r, { fill: WHITE });
    }
  },
  tree(c) {
    c.disc(0.5, 0.5, 0.42, fs(GREEN_DARK, rgb(0x0f2a0e)));
    for (const [x, y] of [
      [0.36, 0.38],
      [0.64, 0.38],
      [0.5, 0.64],
    ] as const) {
      c.disc(x, y, 0.2, fs(GREEN, GREEN_DARK, 0.012));
    }
    c.disc(0.5, 0.5, 0.17, fs(GREEN_LIGHT, GREEN_DARK, 0.012));
    c.disc(0.5, 0.5, 0.05, { fill: WOOD_DARK });
  },
  bush(c) {
    c.disc(0.5, 0.5, 0.38, fs(GREEN, GREEN_DARK));
    c.disc(0.4, 0.4, 0.17, { fill: GREEN_LIGHT });
    c.disc(0.62, 0.56, 0.15, { fill: GREEN_LIGHT });
    c.disc(0.46, 0.65, 0.07, { fill: GREEN_DARK });
  },
  barrel(c) {
    c.disc(0.5, 0.5, 0.4, fs(WOOD, WOOD_DARK));
    c.disc(0.5, 0.5, 0.3, { stroke: WOOD_DARK, sw: 0.012 });
    c.line(0.5, 0.12, 0.5, 0.88, 0.012, { fill: WOOD_DARK });
    c.line(0.35, 0.16, 0.35, 0.84, 0.01, { fill: alpha(WOOD_DARK, 150) });
    c.line(0.65, 0.16, 0.65, 0.84, 0.01, { fill: alpha(WOOD_DARK, 150) });
    c.disc(0.5, 0.5, 0.09, fs(METAL, STONE_DARK, 0.012));
  },
  crate(c) {
    c.rect(0.1, 0.1, 0.8, 0.8, 0.03, fs(WOOD, WOOD_DARK));
    c.rect(0.2, 0.2, 0.6, 0.6, 0.01, { stroke: WOOD_DARK, sw: 0.012 });
    c.line(0.2, 0.2, 0.8, 0.8, 0.03, { fill: WOOD_LIGHT });
    c.line(0.8, 0.2, 0.2, 0.8, 0.03, { fill: WOOD_LIGHT });
  },
  table(c) {
    c.rect(0.08, 0.2, 0.84, 0.6, 0.04, fs(WOOD, WOOD_DARK));
    for (const y of [0.35, 0.5, 0.65])
      c.line(0.16, y, 0.84, y, 0.012, { fill: alpha(WOOD_DARK, 120) });
  },
  chair(c) {
    c.rect(0.2, 0.28, 0.6, 0.6, 0.06, fs(WOOD_LIGHT, WOOD_DARK));
    c.rect(0.2, 0.1, 0.6, 0.18, 0.04, fs(WOOD, WOOD_DARK));
  },
  bed(c) {
    c.rect(0.14, 0.08, 0.72, 0.84, 0.04, fs(WOOD, WOOD_DARK));
    c.rect(0.2, 0.14, 0.6, 0.24, 0.06, fs(WHITE, rgb(0x6b6558), 0.012));
    c.rect(0.2, 0.42, 0.6, 0.44, 0.03, fs(rgb(0x4a6fb0), rgb(0x1f2f55), 0.012));
  },
  chest(c) {
    c.rect(0.08, 0.2, 0.84, 0.6, 0.05, fs(WOOD, WOOD_DARK));
    c.rect(0.08, 0.42, 0.84, 0.1, 0, { fill: METAL });
    c.rect(0.2, 0.2, 0.08, 0.6, 0, { fill: METAL });
    c.rect(0.72, 0.2, 0.08, 0.6, 0, { fill: METAL });
    c.rect(0.44, 0.4, 0.12, 0.16, 0.02, fs(FIRE, rgb(0x6b4b08), 0.012));
  },
  altar(c) {
    c.rect(0.1, 0.18, 0.8, 0.64, 0.03, fs(STONE, STONE_DARK));
    c.rect(0.18, 0.26, 0.64, 0.48, 0.02, fs(STONE_LIGHT, rgb(0x5a5c62), 0.012));
    c.disc(0.5, 0.5, 0.1, fs(rgb(0xa03030), rgb(0x3d1010), 0.012));
    c.disc(0.5, 0.5, 0.035, { fill: FIRE });
  },
  sarcophagus(c) {
    c.polygon(
      [
        [0.3, 0.06],
        [0.7, 0.06],
        [0.8, 0.2],
        [0.72, 0.94],
        [0.28, 0.94],
        [0.2, 0.2],
      ],
      fs(STONE, STONE_DARK),
    );
    c.polygon(
      [
        [0.36, 0.14],
        [0.64, 0.14],
        [0.7, 0.24],
        [0.64, 0.86],
        [0.36, 0.86],
        [0.3, 0.24],
      ],
      fs(STONE_LIGHT, rgb(0x5a5c62), 0.012),
    );
    c.line(0.5, 0.26, 0.5, 0.74, 0.03, { fill: STONE_DARK });
    c.line(0.4, 0.38, 0.6, 0.38, 0.03, { fill: STONE_DARK });
  },
  anvil(c) {
    c.polygon(
      [
        [0.06, 0.34],
        [0.34, 0.3],
        [0.9, 0.3],
        [0.9, 0.5],
        [0.62, 0.52],
        [0.66, 0.7],
        [0.8, 0.78],
        [0.2, 0.78],
        [0.36, 0.7],
        [0.38, 0.52],
        [0.1, 0.46],
      ],
      fs(METAL, rgb(0x1e2126)),
    );
    c.line(0.4, 0.37, 0.84, 0.37, 0.03, { fill: rgb(0x9aa3ae) });
  },
  well(c) {
    c.disc(0.5, 0.5, 0.42, fs(STONE, STONE_DARK));
    c.disc(0.5, 0.5, 0.3, fs(WATER, STONE_DARK, 0.016));
    c.disc(0.42, 0.42, 0.07, { fill: alpha(rgb(0xcfe6fa), 160) });
    c.line(0.1, 0.5, 0.9, 0.5, 0.025, { fill: WOOD_DARK });
  },
  stall(c) {
    c.rect(0.08, 0.1, 0.84, 0.8, 0.02, fs(WOOD, WOOD_DARK));
    const red = rgb(0xc23b2e);
    for (let i = 0; i < 6; i++) {
      c.rect(0.1 + i * 0.133, 0.12, 0.133, 0.46, 0, { fill: i % 2 ? WHITE : red });
    }
    c.rect(0.08, 0.1, 0.84, 0.48, 0.02, { stroke: WOOD_DARK });
    c.rect(0.2, 0.66, 0.2, 0.16, 0.02, fs(rgb(0xd2733a), WOOD_DARK, 0.012));
    c.rect(0.5, 0.66, 0.3, 0.16, 0.02, fs(rgb(0x8fbf4a), WOOD_DARK, 0.012));
  },
  fence(c) {
    c.line(0.04, 0.5, 0.96, 0.5, 0.1, fs(WOOD, WOOD_DARK, 0.016));
    for (const x of [0.14, 0.5, 0.86]) c.disc(x, 0.5, 0.09, fs(WOOD_LIGHT, WOOD_DARK, 0.016));
  },
  lantern(c) {
    c.disc(0.5, 0.5, 0.44, { fill: alpha(ORANGE, 90) });
    c.disc(0.5, 0.5, 0.28, { fill: alpha(FIRE, 140) });
    c.disc(0.5, 0.5, 0.18, fs(rgb(0x3a3d44), rgb(0x16171a)));
    c.disc(0.5, 0.5, 0.1, { fill: FIRE });
  },
  stairs_up(c) {
    c.rect(0.14, 0.08, 0.72, 0.84, 0.02, fs(STONE, STONE_DARK));
    for (let i = 0; i < 5; i++) {
      const l = 0x70 + i * 0x14;
      c.rect(0.14, 0.08 + i * 0.168, 0.72, 0.168, 0, {
        fill: rgb((l << 16) | ((l + 2) << 8) | (l + 6)),
      });
      c.line(0.14, 0.08 + i * 0.168, 0.86, 0.08 + i * 0.168, 0.012, { fill: STONE_DARK });
    }
    c.rect(0.14, 0.08, 0.72, 0.84, 0.02, { stroke: STONE_DARK });
    c.polygon(
      [
        [0.5, 0.2],
        [0.7, 0.45],
        [0.58, 0.45],
        [0.58, 0.78],
        [0.42, 0.78],
        [0.42, 0.45],
        [0.3, 0.45],
      ],
      fs(rgb(0xf1ece0), STONE_DARK, 0.012),
    );
  },
  stairs_down(c) {
    c.rect(0.14, 0.08, 0.72, 0.84, 0.02, fs(STONE, STONE_DARK));
    for (let i = 0; i < 5; i++) {
      const l = 0xa0 - i * 0x14;
      c.rect(0.14, 0.08 + i * 0.168, 0.72, 0.168, 0, {
        fill: rgb((l << 16) | ((l + 2) << 8) | (l + 6)),
      });
      c.line(0.14, 0.08 + i * 0.168, 0.86, 0.08 + i * 0.168, 0.012, { fill: STONE_DARK });
    }
    c.rect(0.14, 0.08, 0.72, 0.84, 0.02, { stroke: STONE_DARK });
    c.polygon(
      [
        [0.5, 0.8],
        [0.7, 0.55],
        [0.58, 0.55],
        [0.58, 0.22],
        [0.42, 0.22],
        [0.42, 0.55],
        [0.3, 0.55],
      ],
      fs(rgb(0xf1ece0), STONE_DARK, 0.012),
    );
  },
  bridge(c) {
    c.rect(0.2, 0.04, 0.6, 0.92, 0.02, fs(WOOD, WOOD_DARK));
    for (let i = 1; i < 8; i++)
      c.line(0.2, 0.04 + i * 0.115, 0.8, 0.04 + i * 0.115, 0.012, { fill: WOOD_DARK });
    c.rect(0.12, 0.04, 0.08, 0.92, 0.02, fs(WOOD_LIGHT, WOOD_DARK, 0.012));
    c.rect(0.8, 0.04, 0.08, 0.92, 0.02, fs(WOOD_LIGHT, WOOD_DARK, 0.012));
  },
  rubble(c) {
    const g = [rgb(0x86888e), rgb(0x9b9da3), rgb(0x6f7177)];
    const stones: [number, number, number[]][] = [
      [0.34, 0.36, [0.2, 0.17, 0.21, 0.18, 0.2, 0.16]],
      [0.66, 0.4, [0.15, 0.17, 0.14, 0.16, 0.15, 0.17]],
      [0.46, 0.68, [0.22, 0.18, 0.2, 0.2, 0.19, 0.2]],
      [0.76, 0.72, [0.1, 0.11, 0.09, 0.1, 0.11, 0.1]],
      [0.2, 0.74, [0.09, 0.1, 0.1, 0.09, 0.1, 0.11]],
    ];
    stones.forEach(([x, y, r], i) => c.polygon(blob(x, y, r, i), fs(g[i % 3]!, STONE_DARK, 0.014)));
  },
  web(c) {
    const col = alpha(rgb(0xe8e8ee), 220);
    const ends: Pt[] = [
      [0.1, 0.1],
      [0.5, 0.06],
      [0.9, 0.1],
      [0.94, 0.5],
      [0.9, 0.9],
      [0.5, 0.94],
      [0.1, 0.9],
      [0.06, 0.5],
    ];
    for (const [x, y] of ends) c.line(0.5, 0.5, x, y, 0.014, { fill: col });
    for (const k of [0.3, 0.55, 0.8]) {
      for (let i = 0; i < 8; i++) {
        const a = ends[i]!;
        const b = ends[(i + 1) % 8]!;
        c.line(
          0.5 + (a[0] - 0.5) * k,
          0.5 + (a[1] - 0.5) * k,
          0.5 + (b[0] - 0.5) * k,
          0.5 + (b[1] - 0.5) * k,
          0.012,
          { fill: col },
        );
      }
    }
  },
  rug(c) {
    const red = rgb(0xa8322f, 235);
    c.rect(0.08, 0.14, 0.84, 0.72, 0.05, fs(red, rgb(0x3d1010, 255)));
    c.rect(0.16, 0.22, 0.68, 0.56, 0.03, { stroke: rgb(0xe0b84a, 240), sw: 0.014 });
    c.ellipse(0.5, 0.5, 0.2, 0.13, fs(rgb(0xe0b84a, 230), rgb(0x6b4b08, 255), 0.012));
    c.disc(0.5, 0.5, 0.045, { fill: rgb(0xa8322f, 240) });
  },
};
