import { describe, expect, it } from 'vitest';
import type { FloorInfo } from '../../src/editor/contracts';
import { DEFAULT_BINDINGS, resolveShortcut, type ShortcutAction } from '../../src/editor/shortcuts';
import { buildEditorCommands } from '../../src/editor/ui/editor-commands';
import { EditorSession } from '../../src/editor/ui/session';
import { searchCommands } from '../../src/lib/commands';
import { grid, palette } from '../editor/helpers';

/** Shortcuts without a palette command: the key is held (pan), cancels a gesture, or is the palette. */
const NO_COMMAND: readonly ShortcutAction[] = ['pan.hold', 'cancel', 'palette'];

const floors: FloorInfo[] = [
  { id: '10', uid: 'ground', level: 0, name: 'RdC', sort_order: 0 },
  { id: '11', uid: 'upper', level: 1, name: 'Étage', sort_order: 1 },
];

function setup() {
  const exported: string[] = [];
  const session = new EditorSession({
    grid: grid(32, 32),
    palette: palette(4),
    floor: 'ground',
    floors,
    describeNotice: (n) => n.code,
  });
  const commands = () =>
    buildEditorCommands(session, {
      platform: 'other',
      exportMap: (kind) => exported.push(kind),
      exporting: () => false,
    });
  return { session, commands, exported };
}

describe('editor palette commands', () => {
  it('has a command for every keyboard shortcut except pan.hold, cancel and palette', () => {
    const { commands } = setup();
    const ids = new Set(commands().map((c) => c.id));
    const actions = [...new Set(DEFAULT_BINDINGS.map((b) => b.action))];
    for (const action of actions) {
      if (NO_COMMAND.includes(action)) continue;
      expect(ids.has(`editor.${action}`), action).toBe(true);
    }
  });

  it('has a command for every tool of the registry, shortcut or not', () => {
    const { session, commands } = setup();
    const ids = new Set(commands().map((c) => c.id));
    const tools = Object.keys(session.controller.tools);
    expect(tools.length).toBeGreaterThanOrEqual(19);
    for (const tool of tools) expect(ids.has(`editor.tool.${tool}`), tool).toBe(true);
    for (const tool of ['stairs', 'portal', 'pin', 'zone', 'trap', 'secret']) {
      expect(ids.has(`editor.tool.${tool}`)).toBe(true);
    }
  });

  it('covers the top bar, the export menu, floors and layers', () => {
    const { commands } = setup();
    const ids = new Set(commands().map((c) => c.id));
    for (const id of [
      'editor.zoom.in',
      'editor.zoom.out',
      'editor.zoom.fit',
      'editor.zoom.reset',
      'editor.grid.toggle',
      'editor.grid.theme.parchment',
      'editor.history',
      'editor.generate',
      'editor.help',
      'editor.panels.toggle',
      'editor.export.png',
      'editor.export.json',
      'editor.export.zip',
      'editor.fog.reset',
      'editor.floor.add',
      'editor.floor.upper',
      'editor.floor.ground',
      'editor.layer.1',
      'editor.layer.9',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('every shortcut command shows the shortcut of its binding', () => {
    const { commands } = setup();
    const byId = new Map(commands().map((c) => [c.id, c]));
    expect(byId.get('editor.tool.wall')?.shortcut).toBe('W');
    expect(byId.get('editor.undo')?.shortcut).toBe('Ctrl+Z');
  });

  it('a tool command changes the tool', () => {
    const { session, commands } = setup();
    const found = searchCommands(commands(), 'editor.tool.pipette');
    expect(found[0]?.id).toBe('editor.tool.pipette');
    found[0]?.run();
    expect(session.ui.tool).toBe('pipette');
  });

  it('undo and redo are offered according to the history; export needs a loaded save state', () => {
    const { session, commands } = setup();
    const offered = () => new Set(searchCommands(commands(), '').map((c) => c.id));
    expect(offered().has('editor.undo')).toBe(false);
    expect(offered().has('editor.export.png')).toBe(false);
    session.setTheme('slate');
    expect(offered().has('editor.undo')).toBe(true);
    expect(offered().has('editor.redo')).toBe(false);
    session.undo();
    expect(offered().has('editor.redo')).toBe(true);
  });

  it('the fog reset only opens the existing confirmation', () => {
    const { session, commands } = setup();
    session.ui.save = { state: 'saved' } as never;
    const reset = commands().find((c) => c.id === 'editor.fog.reset');
    expect(reset?.when?.()).toBe(true);
    reset?.run();
    expect(session.ui.resetFogOpen).toBe(true);
  });

  it('the palette key is not the token tool key', () => {
    const base = { code: '', shiftKey: false, altKey: false };
    expect(resolveShortcut({ ...base, key: 'k', ctrlKey: true, metaKey: false }, 'other')).toBe(
      'palette',
    );
    expect(resolveShortcut({ ...base, key: 'k', ctrlKey: false, metaKey: true }, 'mac')).toBe(
      'palette',
    );
    expect(resolveShortcut({ ...base, key: 'k', ctrlKey: false, metaKey: false }, 'other')).toBe(
      'tool.token',
    );
  });
});
