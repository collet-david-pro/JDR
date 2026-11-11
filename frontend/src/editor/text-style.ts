/** Shared look of the text objects (scene and export draw the same thing). */

/** Outline colour (black or white) that keeps a text colour readable on any background. */
export function textOutlineColor(color: string): string {
  const n = Number.parseInt(color.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#000000' : '#ffffff';
}

/** Outline width, as a fraction of the font size. */
export const TEXT_OUTLINE_RATIO = 0.12;
