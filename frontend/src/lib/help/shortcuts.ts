/**
 * Keyboard shortcuts shown by the help, read from the real binding table of the editor
 * (`editor/shortcuts.ts`): nothing is copied by hand.
 */
import {
  DEFAULT_BINDINGS,
  shortcutLabels,
  type Platform,
  type ShortcutAction,
} from '../../editor/shortcuts';
import { shortcutDescription } from '../../editor/ui/labels';

export interface ShortcutRow {
  readonly action: ShortcutAction;
  readonly description: string;
  readonly keys: readonly string[];
}

/** One row per described action, in the order of the binding table. */
export function shortcutRows(platform: Platform): ShortcutRow[] {
  const actions = [...new Set(DEFAULT_BINDINGS.map((binding) => binding.action))];
  return actions.flatMap((action) => {
    const description = shortcutDescription(action);
    if (description === null) return [];
    const keys = action === 'layer.1' ? ['1 – 9'] : shortcutLabels(action, platform);
    return keys.length === 0 ? [] : [{ action, description, keys }];
  });
}
