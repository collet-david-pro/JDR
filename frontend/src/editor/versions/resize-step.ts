/**
 * Undo / redo of a map resize. The resize is done on the server, then the editor reloads and its
 * in-memory history is lost: the step is kept in sessionStorage for the reloaded page, which puts
 * it back in its history (History.pushExternal) while the map is still at the revision the step
 * left (nobody wrote in between).
 * - stack "undo": undoing restores the snapshot taken just before ("Avant redimensionnement");
 * - stack "redo": redoing resizes again with the same size and anchor shift.
 */
import type { MapVersion } from '../../lib/types';

export interface ResizeParams {
  readonly width: number;
  readonly height: number;
  readonly shiftX: number;
  readonly shiftY: number;
}

export interface ResizeStep {
  readonly mapId: string;
  /** Map revision right after the resize (undo) or the restore (redo). */
  readonly revision: number;
  readonly stack: 'undo' | 'redo';
  readonly version: MapVersion;
  readonly params: ResizeParams;
}

const KEY = 'jdr-editor-resize-step';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function saveResizeStep(storage: Store | null, step: ResizeStep): void {
  try {
    storage?.setItem(KEY, JSON.stringify(step));
  } catch {
    // Storage full or refused: the snapshot stays in the versions history.
  }
}

/** Reads and forgets the saved step; returns it only for this map at this revision. */
export function takeResizeStep(
  storage: Store | null,
  mapId: string,
  revision: number,
): ResizeStep | null {
  let raw: string | null;
  try {
    raw = storage?.getItem(KEY) ?? null;
    storage?.removeItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let step: unknown;
  try {
    step = JSON.parse(raw);
  } catch {
    return null;
  }
  return isStep(step) && step.mapId === mapId && step.revision === revision ? step : null;
}

function isStep(value: unknown): value is ResizeStep {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  const params = s['params'] as Record<string, unknown> | null | undefined;
  const version = s['version'] as Record<string, unknown> | null | undefined;
  return (
    typeof s['mapId'] === 'string' &&
    typeof s['revision'] === 'number' &&
    (s['stack'] === 'undo' || s['stack'] === 'redo') &&
    typeof version?.['id'] === 'string' &&
    ['width', 'height', 'shiftX', 'shiftY'].every((k) => Number.isInteger(params?.[k]))
  );
}
