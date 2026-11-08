/**
 * Draws a player token on a 2D canvas context: shape with ring, then an emblem or a cropped
 * portrait clipped to the inside of the shape. Used for the live preview and for the final PNG.
 */
import { cropRect, type TokenDesign } from './design';
import { emblemById, SHAPE_PATHS } from './emblems';

/** What drawImage accepts for the portrait, with its natural size. */
export interface PortraitSource {
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

const OUTLINE = '#1b1b22';

/** Draws the token filling a size x size square at the origin of `ctx`. */
export function drawToken(
  ctx: CanvasRenderingContext2D,
  design: TokenDesign,
  size: number,
  portrait: PortraitSource | null,
): void {
  const k = size / 100;
  const shape = new Path2D(SHAPE_PATHS[design.shape] ?? SHAPE_PATHS['disc']);
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.scale(k, k);

  // Ring (outer shape) with a dark outline.
  ctx.fillStyle = design.ringWidth > 0 ? design.ring : design.bg;
  ctx.fill(shape);
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.stroke(shape);

  // Inside: same shape scaled around the centre.
  const inner = 1 - design.ringWidth * 1.6;
  ctx.save();
  ctx.translate(50, 50);
  ctx.scale(inner, inner);
  ctx.translate(-50, -50);
  ctx.fillStyle = design.bg;
  ctx.fill(shape);
  if (design.ringWidth > 0) {
    ctx.lineWidth = 1 / inner;
    ctx.strokeStyle = OUTLINE;
    ctx.globalAlpha = 0.6;
    ctx.stroke(shape);
    ctx.globalAlpha = 1;
  }
  ctx.clip(shape);

  if (design.mode === 'portrait' && portrait !== null) {
    const r = cropRect(portrait.width, portrait.height, design.crop, 100);
    ctx.drawImage(portrait.image, r.dx, r.dy, r.dw, r.dh);
  } else if (design.mode === 'emblem') {
    const emblem = emblemById(design.emblem);
    if (emblem !== undefined) {
      ctx.translate(50, 50);
      ctx.scale(0.6, 0.6);
      ctx.translate(-50, -50);
      ctx.fillStyle = design.emblemColor;
      ctx.fill(new Path2D(emblem.path), 'evenodd');
    }
  }
  ctx.restore();
  ctx.restore();
}
