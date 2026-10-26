/**
 * Look of the P5 scene content shared by the engine (Pixi) and the PNG export (Canvas 2D), so
 * that the export matches the screen (projet.md 17). Plain values only (no Pixi).
 * Colours are 0xRRGGBB numbers; widths in cells unless stated otherwise.
 */
import type { TokenDefView, WallKind } from '../editor/contracts';

export const WALL_COLORS: Readonly<Record<WallKind, number>> = {
  stone: 0x4a4a52,
  brick: 0x7a3b2e,
  wood: 0x6b4a2b,
  metal: 0x5b6670,
  natural: 0x4f5a3a,
  invisible: 0x9aa4ff,
};
/** Wall outline (drawn under the fill, +2 screen px). */
export const WALL_OUTLINE = 0x1a1a1e;
/** Invisible walls are only drawn in GM mode, dashed, with this alpha. */
export const INVISIBLE_WALL_ALPHA = 0.6;
/** Minimal drawn wall width in screen pixels (thin walls stay visible when zoomed out). */
export const WALL_MIN_SCREEN_PX = 2;

export const DOOR_COLOR = 0xb07a3a;
export const DOOR_LOCKED_MARK = 0xd04040;
/** Secret door in GM mode: door drawn with this dashed outline. */
export const SECRET_DOOR_OUTLINE = 0xb050d0;
/** Door leaf thickness (cells). */
export const DOOR_THICKNESS = 0.12;

export const WINDOW_COLOR = 0x7fc4e8;
export const WINDOW_THICKNESS = 0.08;

/** Light gizmo (GM mode only): small sun icon radius in screen px. */
export const LIGHT_GIZMO_PX = 7;
export const LIGHT_GIZMO_COLOR = 0xffd75a;

export const TOKEN_RING_COLORS: Readonly<Record<TokenDefView['kind'], number>> = {
  pc: 0x3b82f6,
  npc: 0x22a06b,
  monster: 0xd9453b,
  object: 0x8a8f98,
};
/** Ring width as a fraction of the token radius. */
export const TOKEN_RING_WIDTH = 0.08;
/** Hidden tokens in GM mode. */
export const HIDDEN_TOKEN_ALPHA = 0.45;

/** Unexplored fog (player / display views). */
export const FOG_UNEXPLORED = 0x000000;
/** Explored but not currently visible: black veil with this alpha, plus desaturation. */
export const FOG_EXPLORED_ALPHA = 0.55;
export const FOG_EXPLORED_DESATURATE = 0.6;
/** GM view: unexplored fog drawn as a translucent veil. */
export const FOG_GM_ALPHA = 0.35;
export const FOG_GM_COLOR = 0x1b1f3a;

/**
 * GM view with lighting on: ambient darkness is scaled so the map stays editable
 * (effective darkness × GM_DARKNESS_SCALE).
 */
export const GM_DARKNESS_SCALE = 0.6;
/** Lightmap resolution relative to the screen (½, ¼ in performance mode). */
export const LIGHTMAP_SCALE = 0.5;
export const LIGHTMAP_SCALE_PERF = 0.25;
/** At most this many lights cast shadows (nearest to the screen centre, 14.2). */
export const MAX_SHADOW_LIGHTS = 8;

/** Shadows cast by walls (14.2): length = wall height × this factor (cells), opacity. */
export const SHADOW_LENGTH_PER_HEIGHT = 2;
export const SHADOW_ALPHA = 0.35;

/** Open sliding door: moved along the wall by this fraction of its length, offset sideways. */
export const SLIDE_OPEN_FRACTION = 0.85;
export const SLIDE_OFFSET = 0.12;

/** Token without image: disc of its ring colour, initials in white bold, dark outline. */
export const TOKEN_INITIALS_COLOR = 0xffffff;
export const TOKEN_OUTLINE_COLOR = 0x101014;
export const TOKEN_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** Initials height as a fraction of the token size. */
export const TOKEN_INITIALS_SIZE = 0.42;

/**
 * Player views: light added by darkvision polygons (grey, so unlit areas seen in the dark stay
 * readable and look colourless).
 */
export const DARKVISION_LEVEL = 0.5;
