/** Command builders for document-level edits (labels are i18n keys, translated by the UI). */
import type { Command, GridTheme, LayerDef, LayerId, MapView } from '../contracts';

export type LayerPatch = Partial<Pick<LayerDef, 'visible' | 'locked' | 'opacity'>>;

/** map.meta command changing one layer's visibility / lock / opacity. Null when nothing changes. */
export function layerPatchCommand(view: MapView, id: LayerId, patch: LayerPatch): Command | null {
  const current = view.layers.find((l) => l.id === id);
  if (current === undefined) return null;
  const next = { ...current, ...patch };
  if (
    next.visible === current.visible &&
    next.locked === current.locked &&
    next.opacity === current.opacity
  ) {
    return null;
  }
  const layers = view.layers.map((l) => (l.id === id ? next : l));
  return {
    label: 'editor.command.layer',
    ops: [{ type: 'map.meta', layers }],
    inverseOps: [{ type: 'map.meta', layers: view.layers }],
    // Opacity slider drags merge into one undo step.
    ...(patch.opacity !== undefined ? { mergeKey: `layer-opacity:${id}` } : {}),
  };
}

/** map.meta command moving a layer to a new position in the stack. */
export function layerOrderCommand(view: MapView, id: LayerId, toIndex: number): Command | null {
  const from = view.layers.findIndex((l) => l.id === id);
  const to = Math.max(0, Math.min(view.layers.length - 1, Math.trunc(toIndex)));
  if (from < 0 || from === to) return null;
  const layers = [...view.layers];
  const [moved] = layers.splice(from, 1);
  if (moved === undefined) return null;
  layers.splice(to, 0, moved);
  return {
    label: 'editor.command.layer_order',
    ops: [{ type: 'map.meta', layers }],
    inverseOps: [{ type: 'map.meta', layers: view.layers }],
  };
}

/** map.meta command changing the grid theme. */
export function themeCommand(current: GridTheme, theme: GridTheme): Command | null {
  if (current === theme) return null;
  return {
    label: 'editor.command.theme',
    ops: [{ type: 'map.meta', theme }],
    inverseOps: [{ type: 'map.meta', theme: current }],
  };
}
