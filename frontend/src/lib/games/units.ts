/**
 * Numbers typed in forms and grid units. Distances are stored in cells (projet.md 7.2);
 * feet/metres are a display conversion only (`unit_per_cell`, `unit_label`).
 */

import { locale } from '../i18n';
import type { GameSettings } from '../types';

/**
 * Parses a decimal typed by the user ("1,5", " 2.25 ", "-3"). Returns null when the text is
 * not a plain decimal number (no exponent, no thousands separator, no NaN/Infinity).
 */
export function parseDecimal(text: string): number | null {
  const value = text.trim().replace(',', '.');
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Rounds to a number of decimals (avoids 0.1 + 0.2 artefacts in payloads). */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  // `|| 0` turns -0 into 0 (no "-0" in payloads or labels).
  return Math.round(value * factor) / factor || 0;
}

/** Number → form text (no trailing zeros, "." kept for the input of type text). */
export function numberToInput(value: number, decimals = 3): string {
  return String(roundTo(value, decimals));
}

const numberFormats = new Map<number, Intl.NumberFormat>();
function numberFormat(decimals: number): Intl.NumberFormat {
  let format = numberFormats.get(decimals);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: decimals });
    numberFormats.set(decimals, format);
  }
  return format;
}

/** Localised number ("1,5"). */
export function formatNumber(value: number, decimals = 2): string {
  return numberFormat(decimals).format(value);
}

type UnitSettings = Pick<GameSettings, 'unit_label' | 'unit_per_cell'>;

/** Cells → game units (12 cells × 5 ft = 60). */
export function cellsToUnits(cells: number, settings: UnitSettings): number {
  return roundTo(cells * settings.unit_per_cell, 2);
}

/** Game units → cells (60 ft / 5 = 12); null when unit_per_cell is not positive. */
export function unitsToCells(units: number, settings: UnitSettings): number | null {
  if (!(settings.unit_per_cell > 0)) return null;
  return roundTo(units / settings.unit_per_cell, 3);
}

/** "60 ft" for a distance in cells; "" when the text is not a number. */
export function formatCellDistance(cells: number | string, settings: UnitSettings): string {
  const value = typeof cells === 'number' ? cells : parseDecimal(cells);
  if (value === null || !Number.isFinite(value)) return '';
  return `${formatNumber(cellsToUnits(value, settings))} ${settings.unit_label}`;
}
