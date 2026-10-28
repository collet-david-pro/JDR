/**
 * Tiny vector-ish rasteriser on a transparent RGBA buffer. Shapes are signed distance functions
 * (negative inside) so edges are anti-aliased for free; coordinates are unit-square (0..1).
 * Only Math.sqrt/abs/min/max are used: output is bit-exact everywhere.
 */
export type Color = readonly [number, number, number, number];
export interface Style {
  fill?: Color;
  /** Sharp outline, drawn inside the shape. */
  stroke?: Color;
  /** Outline width in unit coordinates (default 0.02, about 5 px at 256). */
  sw?: number;
}
export type Sdf = (x: number, y: number) => number;
export type Pt = readonly [number, number];

export const rgb = (hex: number, a = 255): Color => [
  (hex >> 16) & 255,
  (hex >> 8) & 255,
  hex & 255,
  a,
];
const cov = (d: number): number => (d <= -0.5 ? 1 : d >= 0.5 ? 0 : 0.5 - d);

export class Canvas {
  readonly data: Uint8ClampedArray;
  constructor(readonly size: number) {
    this.data = new Uint8ClampedArray(size * size * 4);
  }

  /** Paints an SDF given in pixel units; `box` = [x0, y0, x1, y1] in pixels. */
  private paint(sdf: Sdf, box: readonly number[], st: Style): void {
    const n = this.size;
    const sw = (st.sw ?? 0.02) * n;
    const pad = 1;
    const x0 = Math.max(0, Math.floor(box[0]! - pad));
    const y0 = Math.max(0, Math.floor(box[1]! - pad));
    const x1 = Math.min(n - 1, Math.ceil(box[2]! + pad));
    const y1 = Math.min(n - 1, Math.ceil(box[3]! + pad));
    const d = this.data;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const s = sdf(x + 0.5, y + 0.5);
        const a = cov(s);
        if (a <= 0) continue;
        const f = st.fill;
        const k = st.stroke;
        if (!f && !k) continue;
        // inner = how deep inside the fill region (past the outline) this pixel is.
        const inner = k ? cov(s + sw) : 1;
        let sa: number;
        let c: Color;
        if (f && k) {
          sa = ((k[3] + (f[3] - k[3]) * inner) / 255) * a;
          c = [
            k[0] + (f[0] - k[0]) * inner,
            k[1] + (f[1] - k[1]) * inner,
            k[2] + (f[2] - k[2]) * inner,
            255,
          ];
        } else if (f) {
          sa = (f[3] / 255) * a;
          c = f;
        } else {
          sa = (k![3] / 255) * a * (1 - inner);
          c = k!;
        }
        if (sa <= 0) continue;
        const i = (y * n + x) * 4;
        const da = d[i + 3]! / 255;
        const oa = sa + da * (1 - sa);
        for (let k = 0; k < 3; k++) {
          d[i + k] = (c[k]! * sa + d[i + k]! * da * (1 - sa)) / oa;
        }
        d[i + 3] = oa * 255;
      }
    }
  }

  disc(cx: number, cy: number, r: number, st: Style): void {
    const n = this.size;
    const X = cx * n;
    const Y = cy * n;
    const R = r * n;
    this.paint(
      (x, y) => Math.sqrt((x - X) * (x - X) + (y - Y) * (y - Y)) - R,
      [X - R, Y - R, X + R, Y + R],
      st,
    );
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, st: Style): void {
    const n = this.size;
    const X = cx * n;
    const Y = cy * n;
    const A = rx * n;
    const B = ry * n;
    const m = Math.min(A, B);
    this.paint(
      (x, y) => {
        const u = (x - X) / A;
        const v = (y - Y) / B;
        return (Math.sqrt(u * u + v * v) - 1) * m;
      },
      [X - A, Y - B, X + A, Y + B],
      st,
    );
  }

  /** Rectangle with optional corner radius, given by its top-left corner and size. */
  rect(x: number, y: number, w: number, h: number, radius: number, st: Style): void {
    const n = this.size;
    const hx = (w * n) / 2;
    const hy = (h * n) / 2;
    const X = x * n + hx;
    const Y = y * n + hy;
    const r = Math.min(radius * n, hx, hy);
    this.paint(
      (px, py) => {
        const qx = Math.abs(px - X) - hx + r;
        const qy = Math.abs(py - Y) - hy + r;
        const ox = Math.max(qx, 0);
        const oy = Math.max(qy, 0);
        return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
      },
      [X - hx, Y - hy, X + hx, Y + hy],
      st,
    );
  }

  /** Filled polygon (even-odd rule). */
  polygon(pts: readonly Pt[], st: Style): void {
    const n = this.size;
    const P = pts.map((p) => [p[0] * n, p[1] * n] as const);
    const box = [
      Math.min(...P.map((p) => p[0])),
      Math.min(...P.map((p) => p[1])),
      Math.max(...P.map((p) => p[0])),
      Math.max(...P.map((p) => p[1])),
    ];
    this.paint(
      (x, y) => {
        let d2 = Infinity;
        let inside = false;
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
          const a = P[j]!;
          const b = P[i]!;
          if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
            inside = !inside;
          }
          const ex = b[0] - a[0];
          const ey = b[1] - a[1];
          const l2 = ex * ex + ey * ey || 1;
          const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l2));
          const qx = x - a[0] - ex * t;
          const qy = y - a[1] - ey * t;
          d2 = Math.min(d2, qx * qx + qy * qy);
        }
        const d = Math.sqrt(d2);
        return inside ? -d : d;
      },
      box,
      st,
    );
  }

  /** Thick line with round caps; `w` is the full width. `stroke` outlines the capsule. */
  line(x0: number, y0: number, x1: number, y1: number, w: number, st: Style): void {
    const n = this.size;
    const ax = x0 * n;
    const ay = y0 * n;
    const bx = x1 * n;
    const by = y1 * n;
    const r = (w * n) / 2;
    const ex = bx - ax;
    const ey = by - ay;
    const l2 = ex * ex + ey * ey || 1;
    this.paint(
      (x, y) => {
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2));
        const qx = x - ax - ex * t;
        const qy = y - ay - ey * t;
        return Math.sqrt(qx * qx + qy * qy) - r;
      },
      [Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r],
      st,
    );
  }
}
