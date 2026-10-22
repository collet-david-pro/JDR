/**
 * Tiny software 2D context for the export tests (the subset of Ctx2D used by the renderer):
 * affine drawImage with nearest sampling at pixel centres, axis-aligned fillRect, rectangular
 * clip, globalAlpha, source-over blending on straight RGBA floats.
 */
import type { Ctx2D } from '../../src/export/renderer';

export interface FakeImage {
  readonly width: number;
  readonly height: number;
  /** RGBA bytes. */
  readonly pixels: Uint8ClampedArray;
}

type M = [number, number, number, number, number, number];
interface State {
  m: M;
  clip: [number, number, number, number];
  alpha: number;
  fill: string;
}

function parseColor(css: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(css);
  if (hex) {
    const v = parseInt(hex[1]!, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+)\)$/.exec(css);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`colour ${css}`);
}

export class FakeContext implements Ctx2D {
  readonly data: Float64Array;
  globalAlpha = 1;
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  imageSmoothingEnabled = true;
  imageSmoothingQuality: ImageSmoothingQuality = 'low';
  readonly calls: string[] = [];
  private m: M = [1, 0, 0, 1, 0, 0];
  private clipRect: [number, number, number, number];
  private path: [number, number, number, number] | null = null;
  private stack: State[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Float64Array(width * height * 4);
    this.clipRect = [0, 0, width, height];
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.m = [a, b, c, d, e, f];
  }
  save(): void {
    this.stack.push({
      m: [...this.m],
      clip: [...this.clipRect],
      alpha: this.globalAlpha,
      fill: String(this.fillStyle),
    });
  }
  restore(): void {
    const s = this.stack.pop()!;
    this.m = s.m;
    this.clipRect = s.clip;
    this.globalAlpha = s.alpha;
    this.fillStyle = s.fill;
  }
  beginPath(): void {
    this.path = null;
  }
  rect(x: number, y: number, w: number, h: number): void {
    const [a, , , d, e, f] = this.m;
    this.path = [x * a + e, y * d + f, (x + w) * a + e, (y + h) * d + f];
  }
  clip(): void {
    const p = this.path!;
    const c = this.clipRect;
    this.clipRect = [
      Math.max(c[0], p[0]),
      Math.max(c[1], p[1]),
      Math.min(c[2], p[2]),
      Math.min(c[3], p[3]),
    ];
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
    const [r, g, b] = parseColor(String(this.fillStyle));
    this.each(x * a + e, y * d + f, (x + w) * a + e, (y + h) * d + f, true, (i) =>
      this.blend(i, r, g, b, this.globalAlpha),
    );
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
    const img = image as unknown as FakeImage;
    this.calls.push(`drawImage ${dx},${dy},${dw},${dh}`);
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
        const k = (iy * img.width + ix) * 4;
        const p = img.pixels;
        this.blend(i, p[k]!, p[k + 1]!, p[k + 2]!, (this.globalAlpha * p[k + 3]!) / 255);
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
    for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) fn((y * this.width + x) * 4, x, y);
  }

  private blend(i: number, r: number, g: number, b: number, alpha: number): void {
    const d = this.data;
    const da = d[i + 3]!;
    const oa = alpha + da * (1 - alpha);
    if (oa === 0) return;
    const mix = (s: number, dc: number): number => (s * alpha + dc * da * (1 - alpha)) / oa;
    d[i] = mix(r / 255, d[i]!);
    d[i + 1] = mix(g / 255, d[i + 1]!);
    d[i + 2] = mix(b / 255, d[i + 2]!);
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
