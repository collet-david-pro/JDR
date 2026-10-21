/**
 * Deterministic fallback colours (pure): a palette entry without a usable image is drawn as
 * a checkerboard tinted with a colour derived from its palette index (and variant), so maps
 * stay readable in tests, in the demo and while images load.
 */

const GOLDEN_ANGLE = 137.50776405003785;

/** HSL (h in degrees, s and l in 0..1) ⇒ 0xRRGGBB. */
export function hslToRgb(h: number, s: number, l: number): number {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(hue / 60);
  const [r, g, b] =
    sector === 0
      ? [c, x, 0]
      : sector === 1
        ? [x, c, 0]
        : sector === 2
          ? [0, c, x]
          : sector === 3
            ? [0, x, c]
            : sector === 4
              ? [x, 0, c]
              : [c, 0, x];
  const to8 = (v: number): number => Math.max(0, Math.min(255, Math.round((v + m) * 255)));
  return (to8(r) << 16) | (to8(g) << 8) | to8(b);
}

/**
 * Colour of palette index `index` (hues spread by the golden angle); the variant shifts the
 * lightness slightly so variants stay distinguishable.
 */
export function fallbackColor(index: number, variant = 0): number {
  const i = Math.max(0, Math.floor(index));
  const hue = (i * GOLDEN_ANGLE) % 360;
  const saturation = 0.5 + 0.15 * ((i >> 3) % 2);
  const shade = (((variant % 4) + 4) % 4) - 1.5;
  const lightness = 0.56 + shade * 0.05;
  return hslToRgb(hue, saturation, lightness);
}

export function colorToCss(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}
