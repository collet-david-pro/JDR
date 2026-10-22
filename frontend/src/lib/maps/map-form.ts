/**
 * Map forms of the Maps tab (contract P4b, projet.md 7.2 `maps`): creation (name, folder,
 * size, cell size, units pre-filled from the game) and rename / move to a folder.
 * Bounds: name VARCHAR(120), folder VARCHAR(191), width/height 1–400 cells, cell 16–512 px,
 * unit_label ≤ 10, unit_per_cell 0.01–9999.99.
 */
import type { FieldErrors } from '../validation';
import type { GameSettings, MapInput, MapPatch, MapSummary } from '../types';
import {
  CELL_PX_MAX,
  CELL_PX_MIN,
  DEFAULT_SETTINGS,
  UNIT_LABEL_MAX,
  UNIT_PER_CELL_MAX,
  UNIT_PER_CELL_MIN,
} from '../games/game-form';
import { numberToInput, parseDecimal, roundTo } from '../games/units';

export const MAP_NAME_MAX = 120;
export const MAP_FOLDER_MAX = 191;
export const MAP_SIDE_MIN = 1;
export const MAP_SIDE_MAX = 400;
export const DEFAULT_MAP_SIDE = { width: 30, height: 20 } as const;

const length = (value: string): number => [...value].length;

/** Folder path as stored: segments trimmed, empty ones dropped, "/" separators; null at root. */
export function normalizeFolder(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const parts = value
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  return parts.length === 0 ? null : parts.join('/');
}

export function checkMapName(value: string): string | null {
  const v = value.trim();
  if (v === '') return 'required';
  return length(v) > MAP_NAME_MAX ? 'too_long' : null;
}

export function checkFolder(value: string): string | null {
  const v = normalizeFolder(value);
  return v !== null && length(v) > MAP_FOLDER_MAX ? 'too_long' : null;
}

function parseInteger(text: string): number | null {
  const v = text.trim();
  return /^\d+$/.test(v) ? Number(v) : null;
}

function checkInt(text: string, min: number, max: number): string | null {
  if (text.trim() === '') return 'required';
  const n = parseInteger(text);
  if (n === null) return 'invalid';
  if (n < min) return 'too_small';
  return n > max ? 'too_large' : null;
}

export interface MapDraft {
  name: string;
  folder: string;
  /** 'battle' | 'world' (select value). */
  kind: string;
  width: string;
  height: string;
  cell_px: string;
  unit_label: string;
  unit_per_cell: string;
}

/** Empty creation form, units from the game settings. */
export function newMapDraft(
  settings: Partial<GameSettings> | null | undefined,
  folder: string | null = null,
): MapDraft {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return {
    name: '',
    folder: folder ?? '',
    kind: 'battle',
    width: String(DEFAULT_MAP_SIDE.width),
    height: String(DEFAULT_MAP_SIDE.height),
    cell_px: String(s.default_cell_px),
    unit_label: s.unit_label,
    unit_per_cell: numberToInput(s.unit_per_cell, 2),
  };
}

export type MapDraftValidation =
  | { readonly ok: true; readonly input: MapInput }
  | { readonly ok: false; readonly errors: FieldErrors };

export function validateMapDraft(draft: MapDraft): MapDraftValidation {
  const errors: Record<string, string> = {};
  const set = (field: string, code: string | null): void => {
    if (code !== null) errors[field] = code;
  };
  set('name', checkMapName(draft.name));
  set('folder', checkFolder(draft.folder));
  set('width', checkInt(draft.width, MAP_SIDE_MIN, MAP_SIDE_MAX));
  set('height', checkInt(draft.height, MAP_SIDE_MIN, MAP_SIDE_MAX));
  set('cell_px', checkInt(draft.cell_px, CELL_PX_MIN, CELL_PX_MAX));
  const label = draft.unit_label.trim();
  set('unit_label', label === '' ? 'required' : length(label) > UNIT_LABEL_MAX ? 'too_long' : null);
  const upc = parseDecimal(draft.unit_per_cell);
  set(
    'unit_per_cell',
    draft.unit_per_cell.trim() === ''
      ? 'required'
      : upc === null
        ? 'invalid'
        : upc < UNIT_PER_CELL_MIN
          ? 'too_small'
          : upc > UNIT_PER_CELL_MAX
            ? 'too_large'
            : null,
  );
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      name: draft.name.trim(),
      folder: normalizeFolder(draft.folder),
      kind: draft.kind === 'world' ? 'world' : 'battle',
      width: Number(draft.width.trim()),
      height: Number(draft.height.trim()),
      cell_px: Number(draft.cell_px.trim()),
      unit_label: label,
      unit_per_cell: roundTo(upc!, 2),
    },
  };
}

/** Rename / move: only the changed fields. */
export function mapPatch(map: MapSummary, name: string, folder: string): MapPatch {
  const patch: { name?: string; folder?: string | null } = {};
  if (name.trim() !== map.name) patch.name = name.trim();
  const f = normalizeFolder(folder);
  if (f !== map.folder) patch.folder = f;
  return patch;
}
