/**
 * Game forms: creation dialog (name + description) and the Settings tab (projet.md 7.2
 * `games.settings`, contract P3). Bounds follow the schema: name VARCHAR(120),
 * unit_label ≤ 10, unit_per_cell DECIMAL(6,2) > 0, default_cell_px SMALLINT.
 */

import type { FieldErrors } from '../validation';
import type { Game, GamePatch, GameSettings } from '../types';
import { numberToInput, parseDecimal, roundTo } from './units';

export const GAME_NAME_MAX = 120;
export const GAME_DESCRIPTION_MAX = 5000;
export const UNIT_LABEL_MAX = 10;
export const UNIT_PER_CELL_MIN = 0.01;
export const UNIT_PER_CELL_MAX = 9999.99;
export const CELL_PX_MIN = 16;
export const CELL_PX_MAX = 512;

export const DEFAULT_SETTINGS: GameSettings = {
  fog_strict: true,
  players_blocked_by_walls: true,
  players_can_move_own_tokens: true,
  players_see_other_pcs: true,
  unit_label: 'ft',
  unit_per_cell: 5,
  default_cell_px: 70,
};

export const SETTING_FLAGS = [
  'fog_strict',
  'players_blocked_by_walls',
  'players_can_move_own_tokens',
  'players_see_other_pcs',
] as const;
export type SettingFlag = (typeof SETTING_FLAGS)[number];

const length = (value: string): number => [...value].length;

export function checkGameName(value: string): string | null {
  const v = value.trim();
  if (v === '') return 'required';
  return length(v) > GAME_NAME_MAX ? 'too_long' : null;
}

export function checkDescription(value: string): string | null {
  return length(value.trim()) > GAME_DESCRIPTION_MAX ? 'too_long' : null;
}

export interface GameDraft {
  name: string;
  description: string;
  cover_asset_id: string | null;
  /** Preview of the cover (signed thumbnail URL). */
  cover_url: string | null;
  fog_strict: boolean;
  players_blocked_by_walls: boolean;
  players_can_move_own_tokens: boolean;
  players_see_other_pcs: boolean;
  unit_label: string;
  unit_per_cell: string;
  default_cell_px: string;
}

export function gameToDraft(game: Game): GameDraft {
  const s = { ...DEFAULT_SETTINGS, ...game.settings };
  return {
    name: game.name,
    description: game.description ?? '',
    cover_asset_id: game.cover_asset_id,
    cover_url: game.cover_url,
    fog_strict: s.fog_strict,
    players_blocked_by_walls: s.players_blocked_by_walls,
    players_can_move_own_tokens: s.players_can_move_own_tokens,
    players_see_other_pcs: s.players_see_other_pcs,
    unit_label: s.unit_label,
    unit_per_cell: numberToInput(s.unit_per_cell, 2),
    default_cell_px: String(s.default_cell_px),
  };
}

export type GameDraftValidation =
  | {
      readonly ok: true;
      readonly name: string;
      readonly description: string;
      readonly settings: GameSettings;
    }
  | { readonly ok: false; readonly errors: FieldErrors };

export function validateGameDraft(draft: GameDraft): GameDraftValidation {
  const errors: Record<string, string> = {};
  const nameCode = checkGameName(draft.name);
  if (nameCode) errors['name'] = nameCode;
  const descriptionCode = checkDescription(draft.description);
  if (descriptionCode) errors['description'] = descriptionCode;

  const unitLabel = draft.unit_label.trim();
  if (unitLabel === '') errors['unit_label'] = 'required';
  else if (length(unitLabel) > UNIT_LABEL_MAX) errors['unit_label'] = 'too_long';

  let unitPerCell = 0;
  const upc = draft.unit_per_cell.trim() === '' ? undefined : parseDecimal(draft.unit_per_cell);
  if (upc === undefined) errors['unit_per_cell'] = 'required';
  else if (upc === null) errors['unit_per_cell'] = 'invalid';
  else {
    unitPerCell = roundTo(upc, 2);
    if (unitPerCell < UNIT_PER_CELL_MIN) errors['unit_per_cell'] = 'too_small';
    else if (unitPerCell > UNIT_PER_CELL_MAX) errors['unit_per_cell'] = 'too_large';
  }

  let cellPx = 0;
  const px = draft.default_cell_px.trim();
  if (px === '') errors['default_cell_px'] = 'required';
  else if (!/^\d+$/.test(px)) errors['default_cell_px'] = 'invalid';
  else {
    cellPx = Number(px);
    if (cellPx < CELL_PX_MIN) errors['default_cell_px'] = 'too_small';
    else if (cellPx > CELL_PX_MAX) errors['default_cell_px'] = 'too_large';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    name: draft.name.trim(),
    description: draft.description.trim(),
    settings: {
      fog_strict: draft.fog_strict,
      players_blocked_by_walls: draft.players_blocked_by_walls,
      players_can_move_own_tokens: draft.players_can_move_own_tokens,
      players_see_other_pcs: draft.players_see_other_pcs,
      unit_label: unitLabel,
      unit_per_cell: unitPerCell,
      default_cell_px: cellPx,
    },
  };
}

/**
 * PATCH body with the changed members only (settings partial, as allowed by the contract).
 * Returns null when nothing changed.
 */
export function gamePatch(
  game: Game,
  values: {
    name: string;
    description: string;
    cover_asset_id: string | null;
    settings: GameSettings;
  },
): GamePatch | null {
  const patch: { -readonly [K in keyof GamePatch]: GamePatch[K] } = {};
  if (values.name !== game.name) patch.name = values.name;
  if (values.description !== (game.description ?? '')) patch.description = values.description;
  if (values.cover_asset_id !== game.cover_asset_id) patch.cover_asset_id = values.cover_asset_id;
  const current = { ...DEFAULT_SETTINGS, ...game.settings };
  const settings: Partial<Record<keyof GameSettings, unknown>> = {};
  for (const key of Object.keys(values.settings) as (keyof GameSettings)[]) {
    if (values.settings[key] !== current[key]) settings[key] = values.settings[key];
  }
  if (Object.keys(settings).length > 0) patch.settings = settings as Partial<GameSettings>;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Local copy of a game with a patch applied (optimistic update before the answer). */
export function applyGamePatch(game: Game, patch: GamePatch): Game {
  return {
    ...game,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.cover_asset_id !== undefined ? { cover_asset_id: patch.cover_asset_id } : {}),
    settings: { ...game.settings, ...(patch.settings ?? {}) },
  };
}

/** Server field names (422) → form field names of the Settings tab. */
export const GAME_FIELD_RENAME: Readonly<Record<string, string>> = {
  'settings.unit_label': 'unit_label',
  'settings.unit_per_cell': 'unit_per_cell',
  'settings.default_cell_px': 'default_cell_px',
};
