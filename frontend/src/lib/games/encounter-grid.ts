/**
 * Encounter composition (projet.md 2.2, 7.2 `encounter_tokens`): tokens placed relative to
 * the drop point (dx, dy in cells, DECIMAL(7,3)). A token appears at most once per
 * encounter (primary key encounter_id + token_id). Pure functions used by the clickable
 * grid and by its numeric/keyboard alternative.
 */

import type { EncounterInput, EncounterToken } from '../types';
import type { FieldErrors } from '../validation';
import { parseDecimal, roundTo } from './units';

/** Smallest half-size of the editing grid: 7 × 7 cells around the origin. */
export const GRID_MIN_RADIUS = 3;
/** Largest half-size displayed (the numeric inputs allow more). */
export const GRID_MAX_RADIUS = 10;
export const OFFSET_LIMIT = 9999.999;

export interface Cell {
  readonly dx: number;
  readonly dy: number;
}

/** Half-size of the grid that shows every placement (cell of each offset, rounded). */
export function gridRadius(placements: readonly EncounterToken[]): number {
  let radius = GRID_MIN_RADIUS;
  for (const p of placements) {
    radius = Math.max(radius, Math.abs(Math.round(p.dx)), Math.abs(Math.round(p.dy)));
  }
  return Math.min(radius, GRID_MAX_RADIUS);
}

/** Rows of cells from top-left (-r, -r) to bottom-right (r, r). */
export function gridCells(radius: number): Cell[][] {
  const rows: Cell[][] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const row: Cell[] = [];
    for (let dx = -radius; dx <= radius; dx++) row.push({ dx, dy });
    rows.push(row);
  }
  return rows;
}

/** Token ids whose offset falls in the cell (offsets rounded to the nearest cell). */
export function tokensAt(placements: readonly EncounterToken[], cell: Cell): string[] {
  return placements
    .filter((p) => Math.round(p.dx) === cell.dx && Math.round(p.dy) === cell.dy)
    .map((p) => p.token_id);
}

export function isPlaced(placements: readonly EncounterToken[], tokenId: string): boolean {
  return placements.some((p) => p.token_id === tokenId);
}

/** Places (or moves) a token at an offset. */
export function placeToken(
  placements: readonly EncounterToken[],
  tokenId: string,
  dx: number,
  dy: number,
): EncounterToken[] {
  const entry = { token_id: tokenId, dx: clampOffset(dx), dy: clampOffset(dy) };
  const index = placements.findIndex((p) => p.token_id === tokenId);
  if (index < 0) return [...placements, entry];
  return placements.map((p, i) => (i === index ? entry : p));
}

export function removeToken(
  placements: readonly EncounterToken[],
  tokenId: string,
): EncounterToken[] {
  return placements.filter((p) => p.token_id !== tokenId);
}

/** Moves a placed token by whole cells (keyboard alternative). */
export function nudgeToken(
  placements: readonly EncounterToken[],
  tokenId: string,
  ddx: number,
  ddy: number,
): EncounterToken[] {
  const current = placements.find((p) => p.token_id === tokenId);
  if (current === undefined) return [...placements];
  return placeToken(placements, tokenId, current.dx + ddx, current.dy + ddy);
}

/** First free cell, spiralling out of the origin (default spot of a newly added token). */
export function firstFreeCell(placements: readonly EncounterToken[]): Cell {
  for (let r = 0; r <= GRID_MAX_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (tokensAt(placements, { dx, dy }).length === 0) return { dx: dx || 0, dy: dy || 0 };
      }
    }
  }
  return { dx: 0, dy: 0 };
}

export function clampOffset(value: number): number {
  return roundTo(Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, value)), 3);
}

/** Parses a numeric offset input; null when invalid or out of DECIMAL(7,3). */
export function parseOffset(text: string): number | null {
  const value = parseDecimal(text);
  if (value === null || Math.abs(value) > OFFSET_LIMIT) return null;
  return roundTo(value, 3);
}

/**
 * Keyboard navigation in the grid (arrow keys, Home/End = row ends, Ctrl+Home/End = corners).
 * Returns the new focused cell, or null when the key is not a navigation key.
 */
export function moveCell(cell: Cell, key: string, radius: number, ctrl = false): Cell | null {
  const clamp = (v: number): number => Math.max(-radius, Math.min(radius, v));
  switch (key) {
    case 'ArrowLeft':
      return { dx: clamp(cell.dx - 1), dy: cell.dy };
    case 'ArrowRight':
      return { dx: clamp(cell.dx + 1), dy: cell.dy };
    case 'ArrowUp':
      return { dx: cell.dx, dy: clamp(cell.dy - 1) };
    case 'ArrowDown':
      return { dx: cell.dx, dy: clamp(cell.dy + 1) };
    case 'Home':
      return ctrl ? { dx: -radius, dy: -radius } : { dx: -radius, dy: cell.dy };
    case 'End':
      return ctrl ? { dx: radius, dy: radius } : { dx: radius, dy: cell.dy };
    default:
      return null;
  }
}

/** Keeps the placements of tokens that still exist (a token may have been deleted). */
export function prunePlacements(
  placements: readonly EncounterToken[],
  tokenIds: ReadonlySet<string>,
): EncounterToken[] {
  return placements.filter((p) => tokenIds.has(p.token_id));
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.dx === b.dx && a.dy === b.dy;
}

export const ENCOUNTER_NAME_MAX = 120;
export const ENCOUNTER_NOTES_MAX = 10000;
export const ENCOUNTER_TOKENS_MAX = 100;

export type EncounterValidation =
  | { readonly ok: true; readonly input: EncounterInput }
  | { readonly ok: false; readonly errors: FieldErrors };

/** Encounter form: name required (≤ 120), notes ≤ 10000, at most 100 tokens. */
export function validateEncounter(
  name: string,
  notes: string,
  placements: readonly EncounterToken[],
): EncounterValidation {
  const errors: Record<string, string> = {};
  const n = name.trim();
  if (n === '') errors['name'] = 'required';
  else if ([...n].length > ENCOUNTER_NAME_MAX) errors['name'] = 'too_long';
  if ([...notes.trim()].length > ENCOUNTER_NOTES_MAX) errors['notes'] = 'too_long';
  if (placements.length > ENCOUNTER_TOKENS_MAX) errors['tokens'] = 'too_large';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      name: n,
      notes: notes.trim(),
      tokens: placements.map((p) => ({ token_id: p.token_id, dx: p.dx, dy: p.dy })),
    },
  };
}
