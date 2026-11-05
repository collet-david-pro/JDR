/** Command builders for floors (P9a2): floor ops are undoable commands of the history (D1). */
import type { Command } from '../contracts';

/** Builds the command that adds a floor. */
export function floorAddCommand(uid: string, name: string, level: number): Command {
  return {
    label: 'editor.command.floor_add',
    ops: [{ type: 'floor.add', floor: { uid, name, level } }],
    inverseOps: [{ type: 'floor.remove', uid }],
  };
}

/** Builds the command that updates a floor's name or level. */
export function floorUpdateCommand(
  uid: string,
  patch: { readonly name?: string; readonly level?: number },
): Command {
  return {
    label: patch.level !== undefined ? 'editor.command.floor_level' : 'editor.command.floor_rename',
    ops: [{ type: 'floor.update', uid, patch }],
    inverseOps: [],
  };
}

/** The history recomputes the inverse (floor.add + the whole content) from the document. */
export function floorRemoveCommand(uid: string): Command {
  return {
    label: 'editor.command.floor_remove',
    ops: [{ type: 'floor.remove', uid }],
    inverseOps: [],
  };
}

/** Next free level above the highest one (then the lowest free one below), null when -9..9 is full. */
export function nextFreeLevel(levels: readonly number[]): number | null {
  const taken = new Set(levels);
  const top = levels.length === 0 ? 0 : Math.max(...levels);
  for (let l = top + 1; l <= 9; l++) if (!taken.has(l)) return l;
  for (let l = Math.min(0, ...levels) - 1; l >= -9; l--) if (!taken.has(l)) return l;
  for (let l = -9; l <= 9; l++) if (!taken.has(l)) return l;
  return null;
}
