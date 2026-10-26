/**
 * Tiny software 2D context for the export tests (the subset of Ctx2D used by the renderer),
 * sampling every pixel at its centre:
 * - affine drawImage with nearest sampling (sources: FakeImage or another FakeContext);
 * - fillRect (axis-aligned), paths (rect, moveTo/lineTo, closePath, ellipse as a 96-gon)
 *   filled with the even-odd rule, stroked with round or butt caps (uniform scale only);
 * - clip by any path (mask), globalAlpha, solid colours and concentric radial gradients;
 * - composite operations source-over, lighter, multiply, destination-in on straight RGBA
 *   floats; fillText is only recorded.
 */
import type { Ctx2D } from '../../src/export/renderer';

export interface FakeImage {
  readonly width: number;
  readonly height: number;
  /** RGBA bytes. */
  readonly pixels: Uint8ClampedArray;
}

type M = [number, number, number, number, number, number];
type Rgb = [number, number, number];

interface SubPath {
  readonly points: [number, number][];
  closed: boolean;
}

interface State {
  m: M;
  clip: [number, number, number, number];
  mask: Uint8Array | null;
  alpha: number;
  fill: string | CanvasGradient | CanvasPattern;
  stroke: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  composite: GlobalCompositeOperation;
}

export function parseColor(css: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(css);
  if (hex) {
    const v = parseInt(hex[1]!, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+)\)$/.exec(css);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`colour ${css}`);
}

/** Concentric radial gradient evaluated in user space. */
export class FakeGradient {
  readonly stops: [number, Rgb][] = [];
  constructor(
    readonly x: number,
    readonly y: number,
    readonly r0: number,
    readonly r1: number,
  ) {}

  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, parseColor(color)]);
    this.stops.sort((a, b) => a[0] - b[0]);
  }

  at(ux: number, uy: number): Rgb {
    const t = Math.min(
      1,
      Math.max(0, (Math.hypot(ux - this.x, uy - this.y) - this.r0) / (this.r1 - this.r0)),
    );
    const s = this.stops;
    if (t <= s[0]![0]) return s[0]![1];
    for (let i = 1; i < s.length; i++) {
      const [o1, c1] = s[i]!;
      const [o0, c0] = s[i - 1]!;
      if (t <= o1) {
        const k = o1 === o0 ? 1 : (t - o0) / (o1 - o0);
        return [
          c0[0] + (c1[0] - c0[0]) * k,
          c0[1] + (c1[1] - c0[1]) * k,
          c0[2] + (c1[2] - c0[2]) * k,
        ];
      }
    }
    return s[s.length - 1]![1];
  }
}

export class FakeContext implements Ctx2D {
  readonly data: Float64Array;
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  lineWidth = 1;
  lineCap: CanvasLineCap = 'butt';
  lineJoin: CanvasLineJoin = 'miter';
  font = '10px sans-serif';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  imageSmoothingEnabled = true;
  imageSmoothingQuality: ImageSmoothingQuality = 'low';
  readonly calls: string[] = [];
  private m: M = [1, 0, 0, 1, 0, 0];
  private clipRect: [number, number, number, number];
  private mask: Uint8Array | null = null;
  private paths: SubPath[] = [];
  private stack: State[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Float64Array(width * height * 4);
    this.clipRect = [0, 0, width, height];
  }

  get canvas(): FakeContext {
    return this;
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.m = [a, b, c, d, e, f];
  }
  save(): void {
    this.stack.push({
      m: [...this.m],
      clip: [...this.clipRect],
      mask: this.mask,
      alpha: this.globalAlpha,
      fill: this.fillStyle,
      stroke: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineCap: this.lineCap,
      composite: this.globalCompositeOperation,
    });
  }
  restore(): void {
    const s = this.stack.pop()!;
    this.m = s.m;
    this.clipRect = s.clip;
    this.mask = s.mask;
    this.globalAlpha = s.alpha;
    this.fillStyle = s.fill;
    this.strokeStyle = s.stroke;
    this.lineWidth = s.lineWidth;
    this.lineCap = s.lineCap;
    this.globalCompositeOperation = s.composite;
  }

  private tx(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.m;
    return [a * x + c * y + e, b * x + d * y + f];
  }

  beginPath(): void {
    this.paths = [];
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.paths.push({
      points: [this.tx(x, y), this.tx(x + w, y), this.tx(x + w, y + h), this.tx(x, y + h)],
      closed: true,
    });
  }
  moveTo(x: number, y: number): void {
    this.paths.push({ points: [this.tx(x, y)], closed: false });
  }
  lineTo(x: number, y: number): void {
    const last = this.paths[this.paths.length - 1];
    if (last === undefined) this.moveTo(x, y);
    else last.points.push(this.tx(x, y));
  }
  closePath(): void {
    const last = this.paths[this.paths.length - 1];
    if (last !== undefined) last.closed = true;
  }
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number): void {
    const points: [number, number][] = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const lx = Math.cos(a) * rx;
      const ly = Math.sin(a) * ry;
      const c = Math.cos(rotation);
      const s = Math.sin(rotation);
      points.push(this.tx(x + lx * c - ly * s, y + lx * s + ly * c));
    }
    this.paths.push({ points, closed: true });
  }

  /** True when the pixel centre is inside the current path (even-odd). */
  private insidePath(px: number, py: number): boolean {
    let inside = false;
    for (const p of this.paths) {
      const pts = p.points;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i]!;
        const [xj, yj] = pts[j]!;
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }

  private pathBounds(pad: number): [number, number, number, number] {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of this.paths) {
      for (const [x, y] of p.points) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }

  clip(): void {
    const p = this.paths;
    // Axis-aligned rectangle: plain clip rectangle (P4 renderer).
    if (p.length === 1 && p[0]!.points.length === 4 && p[0]!.closed) {
      const [[ax, ay], [bx, by], [cx, cy], [dx, dy]] = p[0]!.points as [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ];
      if (ay === by && bx === cx && cy === dy && dx === ax) {
        const c = this.clipRect;
        this.clipRect = [
          Math.max(c[0], Math.min(ax, bx)),
          Math.max(c[1], Math.min(ay, cy)),
          Math.min(c[2], Math.max(ax, bx)),
          Math.min(c[3], Math.max(ay, cy)),
        ];
        return;
      }
    }
    const mask = new Uint8Array(this.width * this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const k = y * this.width + x;
        if ((this.mask === null || this.mask[k] === 1) && this.insidePath(x + 0.5, y + 0.5)) {
          mask[k] = 1;
        }
      }
    }
    this.mask = mask;
  }

  private paint(style: string | CanvasGradient | CanvasPattern, px: number, py: number): Rgb {
    if (style instanceof FakeGradient) {
      const [a, b, c, d, e, f] = this.m;
      const det = a * d - b * c;
      const X = px + 0.5 - e;
      const Y = py + 0.5 - f;
      return style.at((d * X - c * Y) / det, (-b * X + a * Y) / det);
    }
    return parseColor(String(style));
  }

  fill(): void {
    this.calls.push('fill');
    const [x0, y0, x1, y1] = this.pathBounds(1);
    const solid =
      this.fillStyle instanceof FakeGradient ? null : parseColor(String(this.fillStyle));
    this.each(x0, y0, x1, y1, true, (i, px, py) => {
      if (!this.insidePath(px + 0.5, py + 0.5)) return;
      const [r, g, b] = solid ?? this.paint(this.fillStyle, px, py);
      this.blend(i, r, g, b, this.globalAlpha);
    });
  }

  stroke(): void {
    this.calls.push(`stroke ${String(this.strokeStyle)}`);
    const [a, b, c, d] = this.m;
    const half = (this.lineWidth * Math.sqrt(Math.abs(a * d - b * c))) / 2;
    const segs: [number, number, number, number][] = [];
    for (const p of this.paths) {
      const pts = p.points;
      for (let i = 1; i < pts.length; i++) segs.push([...pts[i - 1]!, ...pts[i]!]);
      if (p.closed && pts.length > 2) segs.push([...pts[pts.length - 1]!, ...pts[0]!]);
    }
    const [r, g, bl] = parseColor(String(this.strokeStyle));
    const round = this.lineCap === 'round';
    const [x0, y0, x1, y1] = this.pathBounds(half + 1);
    this.each(x0, y0, x1, y1, true, (i, px, py) => {
      const x = px + 0.5;
      const y = py + 0.5;
      for (const [sx, sy, ex, ey] of segs) {
        const dx = ex - sx;
        const dy = ey - sy;
        const l2 = dx * dx + dy * dy;
        let t = l2 === 0 ? 0 : ((x - sx) * dx + (y - sy) * dy) / l2;
        if (!round && (t < 0 || t > 1)) continue;
        t = Math.min(1, Math.max(0, t));
        if (Math.hypot(sx + dx * t - x, sy + dy * t - y) <= half) {
          this.blend(i, r, g, bl, this.globalAlpha);
          return;
        }
      }
    });
  }

  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient {
    if (x0 !== x1 || y0 !== y1) throw new Error('fake gradients are concentric');
    return new FakeGradient(x0, y0, r0, r1) as unknown as CanvasGradient;
  }

  fillText(text: string, x: number, y: number): void {
    this.calls.push(`fillText ${text} ${x},${y} ${this.font}`);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    const [a, , , d, e, f] = this.m;
    this.each(x * a + e, y * d + f, (x + w) * a + e, (y + h) * d + f, false, (i) => {
      this.data.fill(0, i, i + 4);
    });
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`fillRect ${x},${y},${w},${h}`);
    const [a, , , d, e, f] = this.m;
    const solid =
      this.fillStyle instanceof FakeGradient ? null : parseColor(String(this.fillStyle));
    this.each(x * a + e, y * d + f, (x + w) * a + e, (y + h) * d + f, true, (i, px, py) => {
      const [r, g, b] = solid ?? this.paint(this.fillStyle, px, py);
      this.blend(i, r, g, b, this.globalAlpha);
    });
  }
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this.calls.push(`drawImage ${dx},${dy},${dw},${dh}`);
    const src = image as unknown as FakeImage | FakeContext;
    const sample: (k: number) => [number, number, number, number] =
      src instanceof FakeContext
        ? (k) => [
            src.data[k]! * 255,
            src.data[k + 1]! * 255,
            src.data[k + 2]! * 255,
            src.data[k + 3]!,
          ]
        : (k) => [src.pixels[k]!, src.pixels[k + 1]!, src.pixels[k + 2]!, src.pixels[k + 3]! / 255];
    const [a, b, c, d, e, f] = this.m;
    const corners = [
      [dx, dy],
      [dx + dw, dy],
      [dx, dy + dh],
      [dx + dw, dy + dh],
    ].map(([x, y]) => [a * x! + c * y! + e, b * x! + d * y! + f]);
    const xs = corners.map((p) => p[0]!);
    const ys = corners.map((p) => p[1]!);
    const det = a * d - b * c;
    this.each(
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
      true,
      (i, px, py) => {
        // Inverse transform of the pixel centre.
        const X = px + 0.5 - e;
        const Y = py + 0.5 - f;
        const lx = (d * X - c * Y) / det;
        const ly = (-b * X + a * Y) / det;
        const u = (lx - dx) / dw;
        const v = (ly - dy) / dh;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) return;
        const ix = Math.floor(sx + u * sw);
        const iy = Math.floor(sy + v * sh);
        const [r, g, bl, al] = sample((iy * src.width + ix) * 4);
        this.blend(i, r, g, bl, this.globalAlpha * al);
      },
    );
  }
  getImageData(w: number, h: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * this.width + x) * 4;
        const o = (y * w + x) * 4;
        for (let k = 0; k < 4; k++) out[o + k] = Math.round(this.data[i + k]! * 255);
      }
    }
    return out;
  }

  /** RGBA 0–255 of one pixel (rounded). */
  pixel(x: number, y: number): [number, number, number, number] {
    const i = (y * this.width + x) * 4;
    const d = this.data;
    return [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!].map((v) => Math.round(v * 255)) as [
      number,
      number,
      number,
      number,
    ];
  }

  private each(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    clipped: boolean,
    fn: (i: number, x: number, y: number) => void,
  ): void {
    const c = clipped ? this.clipRect : [0, 0, this.width, this.height];
    const ax = Math.max(Math.round(Math.min(x0, x1)), c[0]!, 0);
    const ay = Math.max(Math.round(Math.min(y0, y1)), c[1]!, 0);
    const bx = Math.min(Math.round(Math.max(x0, x1)), c[2]!, this.width);
    const by = Math.min(Math.round(Math.max(y0, y1)), c[3]!, this.height);
    const mask = clipped ? this.mask : null;
    for (let y = ay; y < by; y++) {
      for (let x = ax; x < bx; x++) {
        if (mask !== null && mask[y * this.width + x] !== 1) continue;
        fn((y * this.width + x) * 4, x, y);
      }
    }
  }

  private blend(i: number, r: number, g: number, b: number, alpha: number): void {
    const d = this.data;
    const da = d[i + 3]!;
    let sr = r / 255;
    let sg = g / 255;
    let sb = b / 255;
    switch (this.globalCompositeOperation) {
      case 'lighter': {
        const oa = Math.min(1, alpha + da);
        if (oa === 0) return;
        const add = (s: number, dc: number): number =>
          Math.min(1, Math.min(1, s * alpha + dc * da) / oa);
        d[i] = add(sr, d[i]!);
        d[i + 1] = add(sg, d[i + 1]!);
        d[i + 2] = add(sb, d[i + 2]!);
        d[i + 3] = oa;
        return;
      }
      case 'destination-in':
        d[i + 3] = da * alpha;
        return;
      case 'multiply':
        sr = (1 - da) * sr + da * sr * d[i]!;
        sg = (1 - da) * sg + da * sg * d[i + 1]!;
        sb = (1 - da) * sb + da * sb * d[i + 2]!;
        break;
      case 'source-over':
        break;
      default:
        throw new Error(`composite ${this.globalCompositeOperation}`);
    }
    const oa = alpha + da * (1 - alpha);
    if (oa === 0) return;
    const mix = (s: number, dc: number): number => (s * alpha + dc * da * (1 - alpha)) / oa;
    d[i] = mix(sr, d[i]!);
    d[i + 1] = mix(sg, d[i + 1]!);
    d[i + 2] = mix(sb, d[i + 2]!);
    d[i + 3] = oa;
  }
}

/** w × h image filled by fn(x, y) → [r, g, b, a]. */
export function fakeImage(
  w: number,
  h: number,
  fn: (x: number, y: number) => readonly number[],
): FakeImage {
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels.set(fn(x, y), (y * w + x) * 4);
  return { width: w, height: h, pixels };
}
