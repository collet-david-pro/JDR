/** Adjustable side columns of the editor (tools on the left, panels on the right). */

export type ColumnId = 'tools' | 'panels';

/** Default, minimum and maximum widths in px (the map keeps at least MIN_STAGE). */
export const COLUMN_LIMITS: Record<ColumnId, { def: number; min: number; max: number }> = {
  tools: { def: 176, min: 120, max: 360 },
  panels: { def: 288, min: 200, max: 640 },
};
/** Minimum width left to the map area. */
export const MIN_STAGE = 320;
/** Keyboard step in px. */
export const KEY_STEP = 16;

const STORAGE_KEY = 'jdr.editor.columns';

/** Largest width the column may take given the container and the other column. */
export function maxWidth(id: ColumnId, container: number, other: number): number {
  const { min, max } = COLUMN_LIMITS[id];
  if (!Number.isFinite(container) || container <= 0) return max;
  return Math.max(min, Math.min(max, container - other - MIN_STAGE));
}

export function clampWidth(id: ColumnId, value: number, container: number, other: number): number {
  const { def, min } = COLUMN_LIMITS[id];
  const v = Number.isFinite(value) ? Math.round(value) : def;
  return Math.max(min, Math.min(maxWidth(id, container, other), v));
}

/** New width after a key press, or null when the key is not handled. `dir` is +1 when the handle grows the column. */
export function keyWidth(
  id: ColumnId,
  key: string,
  current: number,
  container: number,
  other: number,
  sign: 1 | -1,
): number | null {
  const { min } = COLUMN_LIMITS[id];
  let next: number;
  if (key === 'ArrowRight') next = current + KEY_STEP * sign;
  else if (key === 'ArrowLeft') next = current - KEY_STEP * sign;
  else if (key === 'Home') next = min;
  else if (key === 'End') next = maxWidth(id, container, other);
  else return null;
  return clampWidth(id, next, container, other);
}

export function loadColumns(): Record<ColumnId, number> {
  const out = { tools: COLUMN_LIMITS.tools.def, panels: COLUMN_LIMITS.panels.def };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return out;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return out;
    for (const id of ['tools', 'panels'] as const) {
      const v = (parsed as Record<string, unknown>)[id];
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[id] = Math.max(COLUMN_LIMITS[id].min, Math.min(COLUMN_LIMITS[id].max, Math.round(v)));
      }
    }
  } catch {
    // Storage unavailable or corrupt: defaults.
  }
  return out;
}

export function saveColumns(widths: Record<ColumnId, number>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Not persisted.
  }
}
