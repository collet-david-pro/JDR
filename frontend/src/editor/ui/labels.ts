/** French labels of the editor (i18n keys written literally so the key check can find them). */
import type { GridTheme, LayerId } from '../contracts';
import type { ShortcutAction } from '../shortcuts';
import type { BrushShape, ShapeKind, ToolId, ToolNotice } from '../tools/types';
import { t } from '../../lib/i18n';

export function toolLabel(id: ToolId): string {
  switch (id) {
    case 'select':
      return t('editor.tools.select');
    case 'hand':
      return t('editor.tools.hand');
    case 'brush':
      return t('editor.tools.brush');
    case 'eraser':
      return t('editor.tools.eraser');
    case 'fill':
      return t('editor.tools.fill');
    case 'shape':
      return t('editor.tools.shape');
    case 'pipette':
      return t('editor.tools.pipette');
    case 'ruler':
      return t('editor.tools.ruler');
  }
}

export function layerLabel(id: LayerId): string {
  switch (id) {
    case 'ground':
      return t('editor.layers.names.ground');
    case 'terrain':
      return t('editor.layers.names.terrain');
    case 'decor':
      return t('editor.layers.names.decor');
    case 'walls':
      return t('editor.layers.names.walls');
    case 'props':
      return t('editor.layers.names.props');
    case 'lighting':
      return t('editor.layers.names.lighting');
    case 'labels':
      return t('editor.layers.names.labels');
    case 'gm':
      return t('editor.layers.names.gm');
  }
}

export function themeLabel(theme: GridTheme): string {
  switch (theme) {
    case 'parchment':
      return t('editor.grid.themes.parchment');
    case 'slate':
      return t('editor.grid.themes.slate');
    case 'blueprint':
      return t('editor.grid.themes.blueprint');
    case 'dark':
      return t('editor.grid.themes.dark');
    case 'light':
      return t('editor.grid.themes.light');
  }
}

export function brushShapeLabel(shape: BrushShape): string {
  return shape === 'round' ? t('editor.options.shape_round') : t('editor.options.shape_square');
}

export function shapeKindLabel(kind: ShapeKind): string {
  switch (kind) {
    case 'rect':
      return t('editor.options.rect');
    case 'ellipse':
      return t('editor.options.ellipse');
    case 'line':
      return t('editor.options.line');
  }
}

/** Label of an undoable command (Command.label is an i18n key of editor.command.*). */
export function commandLabel(key: string): string {
  switch (key) {
    case 'editor.command.paint':
      return t('editor.command.paint');
    case 'editor.command.erase':
      return t('editor.command.erase');
    case 'editor.command.fill':
      return t('editor.command.fill');
    case 'editor.command.shape':
      return t('editor.command.shape');
    case 'editor.command.layer':
      return t('editor.command.layer');
    case 'editor.command.layer_order':
      return t('editor.command.layer_order');
    case 'editor.command.theme':
      return t('editor.command.theme');
    default:
      return key;
  }
}

export function noticeText(notice: ToolNotice): string {
  switch (notice.code) {
    case 'layer_locked':
      return t('editor.notices.layer_locked');
    case 'no_tile':
      return t('editor.notices.no_tile');
    case 'fill_limit':
      return t('editor.notices.fill_limit', { limit: Number(notice.params?.['limit'] ?? 0) });
    case 'fill_nothing':
      return t('editor.notices.fill_nothing');
  }
}

/** Help dialog: shortcut actions and their description. */
export function shortcutDescription(action: ShortcutAction): string | null {
  switch (action) {
    case 'tool.select':
    case 'tool.hand':
    case 'tool.brush':
    case 'tool.eraser':
    case 'tool.fill':
    case 'tool.shape':
    case 'tool.pipette':
    case 'tool.ruler':
      return toolLabel(action.slice(5) as ToolId);
    case 'brush.smaller':
      return t('editor.help.brush_smaller');
    case 'brush.larger':
      return t('editor.help.brush_larger');
    case 'undo':
      return t('editor.help.undo');
    case 'redo':
      return t('editor.help.redo');
    case 'panels.toggle':
      return t('editor.help.panels');
    case 'help':
      return t('editor.help.help');
    case 'zoom.reset':
      return t('editor.help.zoom_reset');
    case 'zoom.fit':
      return t('editor.help.zoom_fit');
    case 'snapshot':
      return t('editor.help.snapshot');
    case 'pan.hold':
      return t('editor.help.pan_hold');
    case 'cancel':
      return t('editor.help.cancel');
    case 'layer.1':
      return t('editor.help.layer');
    default:
      return null; // layer.2..9 are summarised by layer.1 ("1-9")
  }
}
