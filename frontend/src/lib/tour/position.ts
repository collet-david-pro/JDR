/** Placement of the guided tour card next to the lit element (pure, in CSS pixels). */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export type CardSide = 'bottom' | 'top' | 'right' | 'left' | 'center';

export interface CardPlacement {
  readonly x: number;
  readonly y: number;
  readonly side: CardSide;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Puts the card below the target, else above, else to the right, else to the left; a target
 * too large for any of them (the map) or no target at all gets the card in the middle.
 */
export function placeCard(
  target: Box | null,
  card: Size,
  view: Size,
  gap = 12,
  margin = 12,
): CardPlacement {
  const centerX = clamp((view.width - card.width) / 2, margin, view.width - margin - card.width);
  const centerY = clamp(
    (view.height - card.height) / 2,
    margin,
    view.height - margin - card.height,
  );
  if (target === null) return { x: centerX, y: centerY, side: 'center' };

  const alongX = clamp(
    target.x + target.width / 2 - card.width / 2,
    margin,
    view.width - margin - card.width,
  );
  const alongY = clamp(
    target.y + target.height / 2 - card.height / 2,
    margin,
    view.height - margin - card.height,
  );
  const below = target.y + target.height + gap;
  if (below + card.height <= view.height - margin) return { x: alongX, y: below, side: 'bottom' };
  const above = target.y - gap - card.height;
  if (above >= margin) return { x: alongX, y: above, side: 'top' };
  const right = target.x + target.width + gap;
  if (right + card.width <= view.width - margin) return { x: right, y: alongY, side: 'right' };
  const left = target.x - gap - card.width;
  if (left >= margin) return { x: left, y: alongY, side: 'left' };
  return { x: centerX, y: centerY, side: 'center' };
}

/** Lit area: the target with some padding, kept inside the viewport. */
export function spotlight(target: Box, view: Size, pad = 6): Box {
  const x = Math.max(0, target.x - pad);
  const y = Math.max(0, target.y - pad);
  const right = Math.min(view.width, target.x + target.width + pad);
  const bottom = Math.min(view.height, target.y + target.height + pad);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}
