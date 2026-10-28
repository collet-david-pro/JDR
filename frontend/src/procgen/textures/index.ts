/** Procedural, seamlessly tiling textures (pure TS, RGBA bytes). */
import { createRng } from '../prng';
import { MATERIAL_DEFS, MATERIALS, type Material } from './materials';
import { PALETTES } from './palettes';

export { MATERIALS, PALETTES };
export type { Material };
export type { PaletteInfo } from './palettes';

export const TEXTURE_SIZES = [128, 256, 512] as const;
export const TEXTURE_GEN_VERSION = 1;

export interface TextureRequest {
  material: Material;
  palette: string;
  size: 128 | 256 | 512;
  seed: string;
}

/** Renders an opaque RGBA texture whose edges wrap seamlessly. Same input, same bytes. */
export function renderTexture(req: TextureRequest): Uint8ClampedArray {
  const { material, palette, size, seed } = req;
  const def = MATERIAL_DEFS[material];
  if (!def) throw new Error('Unknown material: ' + material);
  const pal = PALETTES[palette];
  if (!pal) throw new Error('Unknown palette: ' + palette);
  if (!TEXTURE_SIZES.includes(size)) throw new RangeError('Texture size must be 128, 256 or 512');
  const rng = createRng(seed, 'texture', TEXTURE_GEN_VERSION).fork(material);
  const sample = def.make(rng, size);
  const n = size * size;
  const cs = new Float32Array(n);
  const hs = new Float32Array(n);
  const out: [number, number] = [0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      sample(x, y, out);
      cs[y * size + x] = out[0];
      hs[y * size + x] = out[1];
    }
  }
  const stops = pal.colors.map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const);
  const last = stops.length - 1;
  const k = def.relief * 5 * (size / 256);
  const px = new Uint8ClampedArray(n * 4);
  const m = size - 1;
  for (let y = 0; y < size; y++) {
    const up = ((y - 1) & m) * size;
    const dn = ((y + 1) & m) * size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const hx = hs[y * size + ((x + 1) & m)]! - hs[y * size + ((x - 1) & m)]!;
      const hy = hs[dn + x]! - hs[up + x]!;
      const shade = Math.max(0.55, Math.min(1.45, 1 + k * (hx + hy)));
      const t = Math.max(0, Math.min(1, cs[i]!)) * last;
      const lo = Math.min(last - 1, Math.floor(t));
      const f = t - lo;
      const a = stops[lo]!;
      const b = stops[lo + 1]!;
      const o = i * 4;
      px[o] = (a[0] + (b[0] - a[0]) * f) * shade;
      px[o + 1] = (a[1] + (b[1] - a[1]) * f) * shade;
      px[o + 2] = (a[2] + (b[2] - a[2]) * f) * shade;
      px[o + 3] = 255;
    }
  }
  return px;
}
