/** Parameters of the dungeon generator: defaults, bounds (validate) and presets. */
import { round3 } from '../geometry';
import { DUNGEON_THEME_IDS, type DungeonThemeId } from '../themes/dungeon';

export interface DungeonParams {
  width: number;
  height: number;
  rooms: number;
  room_min: number;
  room_max: number;
  corridor: number;
  loops: number;
  door_p: number;
  secret_p: number;
  theme: DungeonThemeId;
  decor: number;
  /** Reserved: always 1 (D7). */
  floors: number;
}

export const DUNGEON_DEFAULTS: Readonly<DungeonParams> = Object.freeze({
  width: 60,
  height: 60,
  rooms: 14,
  room_min: 4,
  room_max: 10,
  corridor: 1,
  loops: 0.15,
  door_p: 0.8,
  secret_p: 0.05,
  theme: 'stone',
  decor: 0.5,
  floors: 1,
});

export const DUNGEON_PRESETS: Readonly<Record<string, Partial<DungeonParams>>> = Object.freeze({
  small_crypt: { width: 30, height: 30, rooms: 6, theme: 'crypt' },
  large_dungeon: { width: 120, height: 120, rooms: 40, loops: 0.25 },
  sewers: { width: 80, height: 60, corridor: 2, theme: 'sewer' },
  manor_cellar: { width: 40, height: 40, theme: 'wood' },
});

/** French labels of the presets (UI). */
export const DUNGEON_PRESET_LABELS: Readonly<Record<string, string>> = Object.freeze({
  small_crypt: 'Petite crypte',
  large_dungeon: 'Grand donjon',
  sewers: 'Égouts',
  manor_cellar: 'Cave de manoir',
});

function num(v: unknown, def: number, min: number, max: number, int: boolean): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  const x = int ? Math.round(v) : round3(v);
  return Math.min(max, Math.max(min, x));
}

/**
 * Bounds and defaults: out of bounds ⇒ clamped, wrong type ⇒ default. Safety: rooms ≤ w×h/25;
 * room_min small enough for the map to split at least once (so entrance ≠ exit); room_max ≥
 * room_min; floors = 1.
 */
export function validateDungeon(p: unknown): DungeonParams {
  const o: Record<string, unknown> =
    typeof p === 'object' && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  const d = DUNGEON_DEFAULTS;
  const width = num(o['width'], d.width, 20, 400, true);
  const height = num(o['height'], d.height, 20, 400, true);
  const roomMinCap = Math.max(3, Math.floor((Math.min(width, height) - 2) / 2) - 2);
  const room_min = Math.min(num(o['room_min'], d.room_min, 3, 20, true), roomMinCap);
  const room_max = Math.max(num(o['room_max'], d.room_max, 4, 40, true), room_min);
  const theme =
    typeof o['theme'] === 'string' && (DUNGEON_THEME_IDS as readonly string[]).includes(o['theme'])
      ? (o['theme'] as DungeonThemeId)
      : d.theme;
  return {
    width,
    height,
    rooms: Math.min(num(o['rooms'], d.rooms, 3, 200, true), Math.floor((width * height) / 25)),
    room_min,
    room_max,
    corridor: num(o['corridor'], d.corridor, 1, 3, true),
    loops: num(o['loops'], d.loops, 0, 0.5, false),
    door_p: num(o['door_p'], d.door_p, 0, 1, false),
    secret_p: num(o['secret_p'], d.secret_p, 0, 0.5, false),
    theme,
    decor: num(o['decor'], d.decor, 0, 1, false),
    floors: 1,
  };
}
