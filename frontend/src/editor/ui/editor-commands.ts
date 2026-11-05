/**
 * Commands of the editor palette (P9c2): every keyboard shortcut, every tool, the buttons of
 * the top bar and of the export menu, the floors and the layers. Built from the live session
 * (reactive reads of `session.ui` make a `$derived` of the result follow floors and history).
 * Actions on a row of a list (one layer, one history entry, one object) are out of scope.
 */
import type { Command } from '../../lib/commands';
import { t } from '../../lib/i18n';
import { GRID_THEME_IDS } from '../../engine/grid-themes';
import { shortcutLabel, type Platform, type ShortcutAction } from '../shortcuts';
import type { ToolId } from '../tools/types';
import type { ExportKind } from './export-source';
import { layerLabel, shortcutDescription, themeLabel, toolLabel } from './labels';
import type { EditorSession } from './session';

export interface EditorCommandCallbacks {
  readonly platform: Platform;
  /** Export from the top bar menu (PNG dialog, map file download). */
  readonly exportMap: (kind: ExportKind) => void;
  /** An export is already running. */
  readonly exporting: () => boolean;
}

/** Shortcut actions that run through `controller.handleAction` (the rest has its own command). */
const CONTROLLER_ACTIONS: readonly ShortcutAction[] = [
  'confirm',
  'delete',
  'brush.smaller',
  'brush.larger',
];

const LAYER_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Builds the command palette entries of the editor. */
export function buildEditorCommands(session: EditorSession, cb: EditorCommandCallbacks): Command[] {
  const ui = session.ui;
  const out: Command[] = [];
  const keys = (action: ShortcutAction): string | null => shortcutLabel(action, cb.platform);
  const add = (command: Command): void => {
    out.push(command);
  };
  const g = {
    tools: t('palette.group.tools'),
    edit: t('palette.group.edit'),
    view: t('palette.group.view'),
    map: t('palette.group.map'),
    layers: t('palette.group.layers'),
    file: t('palette.group.file'),
  };

  // ---- Tools (tool bar order; stairs, portal, pin, zone, trap, secret have no shortcut) -------
  for (const tool of Object.values(session.controller.tools)) {
    const id = tool.id as ToolId;
    add({
      id: `editor.tool.${id}`,
      label: toolLabel(id),
      group: g.tools,
      shortcut: keys(`tool.${id}` as ShortcutAction),
      keywords: [t('palette.kw.tool')],
      run: () => session.setTool(id),
    });
  }

  // ---- Edit -----------------------------------------------------------------------------------
  add({
    id: 'editor.undo',
    label: t('editor.undo'),
    group: g.edit,
    shortcut: keys('undo'),
    when: () => ui.history.canUndo,
    run: () => session.undo(),
  });
  add({
    id: 'editor.redo',
    label: t('editor.redo'),
    group: g.edit,
    shortcut: keys('redo'),
    when: () => ui.history.canRedo,
    run: () => session.redo(),
  });
  for (const action of CONTROLLER_ACTIONS) {
    add({
      id: `editor.${action}`,
      label: shortcutDescription(action) ?? action,
      group: g.edit,
      shortcut: keys(action),
      run: () => void session.controller.handleAction(action),
    });
  }
  add({
    id: 'editor.snapshot',
    label: t('editor.help.snapshot'),
    group: g.edit,
    shortcut: keys('snapshot'),
    when: () => ui.save !== null,
    run: () => (ui.snapshotOpen = true),
  });

  // ---- View -----------------------------------------------------------------------------------
  add({
    id: 'editor.zoom.in',
    label: t('editor.zoom_in'),
    group: g.view,
    run: () => session.zoomBy(1.25),
  });
  add({
    id: 'editor.zoom.out',
    label: t('editor.zoom_out'),
    group: g.view,
    run: () => session.zoomBy(1 / 1.25),
  });
  add({
    id: 'editor.zoom.fit',
    label: t('editor.zoom_fit'),
    group: g.view,
    shortcut: keys('zoom.fit'),
    run: () => session.zoomFit(),
  });
  add({
    id: 'editor.zoom.reset',
    label: t('editor.help.zoom_reset'),
    group: g.view,
    shortcut: keys('zoom.reset'),
    run: () => session.zoomReset(),
  });
  add({
    id: 'editor.grid.toggle',
    label: t('editor.grid.show'),
    group: g.view,
    run: () => session.setGridVisible(!ui.gridVisible),
  });
  for (const theme of GRID_THEME_IDS) {
    add({
      id: `editor.grid.theme.${theme}`,
      label: t('palette.grid_theme', { theme: themeLabel(theme) }),
      group: g.view,
      keywords: [t('editor.grid.theme')],
      when: () => ui.theme !== theme,
      run: () => session.setTheme(theme),
    });
  }
  add({
    id: 'editor.view.gm',
    label: t('editor.view.gm'),
    group: g.view,
    run: () => session.scene.setView({ mode: 'gm' }),
  });
  add({
    id: 'editor.view.all_pcs',
    label: t('editor.view.all_pcs'),
    group: g.view,
    run: () => session.scene.setView({ mode: 'player', viewer: 'all_pcs' }),
  });
  const viewLabels = {
    lighting: t('editor.view.lighting'),
    fog: t('editor.view.fog'),
    shadows: t('editor.view.shadows'),
    explore: t('editor.view.explore'),
  } as const;
  const perfLabels = {
    auto: t('editor.view.performance_auto'),
    on: t('editor.view.performance_on'),
    off: t('editor.view.performance_off'),
  } as const;
  for (const key of ['lighting', 'fog', 'shadows', 'explore'] as const) {
    add({
      id: `editor.view.${key}`,
      label: viewLabels[key],
      group: g.view,
      run: () => session.scene.setView({ [key]: !ui.view[key] }),
    });
  }
  for (const mode of ['auto', 'on', 'off'] as const) {
    add({
      id: `editor.view.performance.${mode}`,
      label: perfLabels[mode],
      group: g.view,
      keywords: [t('editor.view.performance')],
      when: () => ui.view.performance !== mode,
      run: () => session.scene.setView({ performance: mode }),
    });
  }
  add({
    id: 'editor.fog.reset',
    label: t('editor.view.fog_reset'),
    group: g.view,
    when: () => ui.save !== null,
    run: () => (ui.resetFogOpen = true),
  });
  add({
    id: 'editor.panels.toggle',
    label: ui.panelsOpen ? t('editor.panels.hide') : t('editor.panels.show'),
    group: g.view,
    shortcut: keys('panels.toggle'),
    run: () => session.togglePanels(),
  });
  add({
    id: 'editor.history',
    label: t('editor.versions.button'),
    group: g.view,
    run: () => {
      ui.historyOpen = !ui.historyOpen;
      if (ui.historyOpen && !ui.panelsOpen) session.togglePanels();
    },
  });
  add({
    id: 'editor.generate',
    label: t('editor.generate.button'),
    group: g.view,
    shortcut: keys('generate'),
    run: () => {
      ui.generateOpen = !ui.generateOpen;
      if (ui.generateOpen && !ui.panelsOpen) session.togglePanels();
    },
  });
  add({
    id: 'editor.help',
    label: t('editor.help_button'),
    group: g.view,
    shortcut: keys('help'),
    run: () => (ui.helpOpen = true),
  });

  // ---- Export ---------------------------------------------------------------------------------
  const canExport = (): boolean => ui.save !== null && !cb.exporting();
  for (const [kind, key] of [
    ['png', 'editor.export.png'],
    ['json', 'editor.export.json'],
    ['zip', 'editor.export.zip'],
  ] as const) {
    add({
      id: `editor.export.${kind}`,
      label: t(key),
      group: g.file,
      keywords: [t('editor.export.button')],
      when: canExport,
      run: () => cb.exportMap(kind),
    });
  }

  // ---- Floors ---------------------------------------------------------------------------------
  for (const floor of ui.floors) {
    add({
      id: `editor.floor.${floor.uid}`,
      label: t('palette.floor_go', { name: floor.name }),
      group: g.map,
      keywords: [t('editor.floors.label')],
      when: () => floor.uid !== ui.currentFloor && !ui.floorBusy,
      run: () => void session.floors.select(floor.uid),
    });
  }
  add({
    id: 'editor.floor.add',
    label: t('palette.floor_add'),
    group: g.map,
    keywords: [t('editor.floors.label')],
    when: () => !ui.floorBusy,
    run: () => {
      const levels = ui.floors.map((f) => f.level);
      let level = 1;
      while (levels.includes(level) && level < 9) level++;
      void session.floors.add(t('palette.floor_new_name', { level }), level);
    },
  });

  // ---- Layers 1 to 9 --------------------------------------------------------------------------
  for (const n of LAYER_NUMBERS) {
    const layer = ui.layers[n - 1];
    add({
      id: `editor.layer.${n}`,
      label: t('palette.layer', {
        number: n,
        name: layer === undefined ? String(n) : layerLabel(layer.id),
      }),
      group: g.layers,
      shortcut: keys(`layer.${n}` as ShortcutAction),
      when: () => layer?.kind === 'tiles',
      run: () => void session.controller.handleAction(`layer.${n}` as ShortcutAction),
    });
  }
  return out;
}
