/**
 * Lot l17 contract of the free text objects (labels on the map). Kept apart from contracts.ts.
 *
 * Server side (app/Maps/ObjectRulesText.php): type `text`, geometry {x, y} (centre of the text, in
 * cells), props {text (1-200 chars, single line, plain text), size (height in cells, 0.2-10),
 * color "#rrggbb", font, rotation (degrees, -360..360)}. Default layer `labels`, visibility `all`.
 * On the `gm` layer or with a `gm` visibility it never reaches a player nor a screen.
 */

import type { ObjectLayerId, ObjectVisibility } from './contracts';

export type TextFont = 'sans' | 'serif' | 'mono' | 'hand';

export const TEXT_FONTS: readonly TextFont[] = ['sans', 'serif', 'mono', 'hand'];
export const TEXT_MAX = 200;
export const TEXT_SIZE_MIN = 0.2;
export const TEXT_SIZE_MAX = 10;

/** CSS font stacks of the fonts (system fonts only: nothing to download). */
export const TEXT_FONT_STACKS: Readonly<Record<TextFont, string>> = {
  sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  hand: '"Segoe Script", "Bradley Hand", "Comic Sans MS", cursive',
};

export interface TextGeometry {
  readonly x: number;
  readonly y: number;
}

export interface TextProps {
  readonly text: string;
  readonly size: number;
  readonly color: string;
  readonly font: TextFont;
  readonly rotation: number;
}

/** Text object. */
export interface TextObject {
  readonly uid: string;
  readonly floor: string;
  readonly type: 'text';
  readonly layer: ObjectLayerId;
  readonly visibility: ObjectVisibility;
  readonly locked: boolean;
  readonly sort_order: number;
  readonly rev: number;
  readonly geometry: TextGeometry;
  readonly props: TextProps;
}

/** Narrowing helper. */
export function isTextObject(o: { readonly type: string }): o is TextObject {
  return o.type === 'text';
}
