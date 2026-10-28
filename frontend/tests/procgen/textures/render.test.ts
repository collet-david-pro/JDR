import { describe, expect, it } from 'vitest';
import { MATERIALS, PALETTES, renderTexture } from '../../../src/procgen/textures';

const sizes = [128, 256, 512] as const;
const paletteFor = (m: string): string =>
  Object.values(PALETTES).find((p) => p.materials.includes(m as never))!.id;

function seam(px: Uint8ClampedArray, n: number): { edge: number; inner: number } {
  const lum = (x: number, y: number): number => {
    const i = (y * n + x) * 4;
    return px[i]! + px[i + 1]! + px[i + 2]!;
  };
  let edge = 0;
  let inner = 0;
  for (let k = 0; k < n; k++) {
    edge += Math.abs(lum(0, k) - lum(n - 1, k)) + Math.abs(lum(k, 0) - lum(k, n - 1));
    for (let j = 0; j < n - 1; j++) {
      inner += Math.abs(lum(j, k) - lum(j + 1, k)) + Math.abs(lum(k, j) - lum(k, j + 1));
    }
  }
  return { edge: edge / (2 * n), inner: inner / (2 * n * (n - 1)) };
}

describe('renderTexture', () => {
  it('is deterministic and opaque for every material', () => {
    for (const m of MATERIALS) {
      const req = { material: m, palette: paletteFor(m), size: 128 as const, seed: 'abc' };
      const a = renderTexture(req);
      const b = renderTexture(req);
      expect(Buffer.from(a).equals(Buffer.from(b)), m).toBe(true);
      expect(Buffer.from(a).equals(Buffer.from(renderTexture({ ...req, seed: 'abd' }))), m).toBe(
        false,
      );
      for (let i = 3; i < a.length; i += 4) if (a[i] !== 255) throw new Error(m + ' not opaque');
    }
  });

  it('tiles without seams (edge delta close to the inner delta)', () => {
    for (const m of MATERIALS) {
      const px = renderTexture({ material: m, palette: paletteFor(m), size: 256, seed: 's' });
      const { edge, inner } = seam(px, 256);
      expect(edge, m).toBeLessThanOrEqual(inner * 1.5 + 1);
    }
  });

  it('supports 128, 256 and 512 and rejects other sizes', () => {
    for (const s of sizes) {
      expect(
        renderTexture({ material: 'stone', palette: 'stone_grey', size: s, seed: 'x' }).length,
      ).toBe(s * s * 4);
    }
    expect(() =>
      renderTexture({ material: 'stone', palette: 'stone_grey', size: 100 as never, seed: 'x' }),
    ).toThrow();
    expect(() =>
      renderTexture({ material: 'stone', palette: 'nope', size: 128, seed: 'x' }),
    ).toThrow();
  });

  it('has a palette for every material, including the pack ones', () => {
    for (const m of MATERIALS)
      expect(
        Object.values(PALETTES).some((p) => p.materials.includes(m)),
        m,
      ).toBe(true);
    for (const id of ['snow', 'cave', 'deep_water', 'mud']) expect(PALETTES[id], id).toBeDefined();
    for (const p of Object.values(PALETTES)) {
      expect(p.colors.length).toBeGreaterThanOrEqual(3);
      expect(p.colors.length).toBeLessThanOrEqual(5);
    }
  });

  it('renders 256x256 well under the time budget', () => {
    const t0 = performance.now();
    for (const m of MATERIALS)
      renderTexture({ material: m, palette: paletteFor(m), size: 256, seed: 't' });
    const per = (performance.now() - t0) / MATERIALS.length;
    expect(per).toBeLessThan(2000);
  }, 60000);
});
