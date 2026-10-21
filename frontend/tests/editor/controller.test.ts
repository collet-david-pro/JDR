import { describe, expect, it, vi } from 'vitest';
import type { Overlay } from '../../src/editor/contracts';
import { EditorController, type EditorSettings } from '../../src/editor/EditorController';
import { History } from '../../src/editor/history/History';
import { EditorUiState } from '../../src/editor/state.svelte';
import { createRng } from '../../src/editor/util/rng';
import { ev, makeDoc } from './helpers';

function setup(settings: EditorSettings = new EditorUiState()) {
  const doc = makeDoc(32, 32);
  const history = new History(doc);
  const host = {
    overlay: null as Overlay | null,
    pan: false,
    setOverlay: vi.fn((o: Overlay | null) => (host.overlay = o)),
    setPanMode: vi.fn((p: boolean) => (host.pan = p)),
    notify: vi.fn(),
    onAction: vi.fn(),
  };
  const ctrl = new EditorController(doc, history, settings, host, { rng: createRng(1) });
  return { doc, history, host, ctrl, settings };
}

describe('EditorController', () => {
  it('routes pointer events to the active tool and records commands', () => {
    const { doc, history, host, ctrl, settings } = setup();
    settings.tile = { index: 2, variant: 0, flags: 0 };
    ctrl.handlePointer(ev('down', 1, 1));
    ctrl.handlePointer(ev('move', 4, 1));
    ctrl.handlePointer(ev('up', 4, 1));
    expect(doc.getCell('ground', 3, 1).index).toBe(2);
    expect(history.state.undoSize).toBe(1);
    expect(host.overlay).toMatchObject({ kind: 'cells' });
    ctrl.handleAction('undo');
    expect(doc.getCell('ground', 3, 1).index).toBe(0);
    ctrl.handleAction('redo');
    expect(doc.getCell('ground', 3, 1).index).toBe(2);
  });

  it('handles tools, brush size, layers, pipette, Space and other actions', () => {
    const { doc, host, ctrl, settings } = setup();
    ctrl.handleAction('tool.hand');
    expect(settings.tool).toBe('hand');
    expect(host.pan).toBe(true);
    ctrl.handleAction('tool.brush');
    expect(host.pan).toBe(false);
    ctrl.setSpaceHeld(true);
    expect(host.pan).toBe(true);
    ctrl.handlePointer(ev('down', 1, 1)); // ignored while panning
    ctrl.setSpaceHeld(false);
    expect(host.notify).not.toHaveBeenCalled();
    ctrl.handlePointer(ev('down', 1, 1));
    expect(host.notify).toHaveBeenCalledWith({ code: 'no_tile' });
    for (let i = 0; i < 20; i++) ctrl.handleAction('brush.larger');
    expect(settings.brushSize).toBe(16);
    ctrl.handleAction('layer.3');
    expect(settings.layer).toBe('decor');
    ctrl.handleAction('layer.5'); // object layer: not a tile layer in P4a
    expect(settings.layer).toBe('decor');
    doc.setCells('decor', [[5, 5, 3, 1, 0]]);
    ctrl.handleAction('tool.pipette');
    ctrl.handlePointer(ev('down', 5, 5));
    expect(settings.tile).toEqual({ index: 3, variant: 1, flags: 0 });
    expect(ctrl.handleAction('zoom.fit')).toBe(true);
    expect(host.onAction).toHaveBeenCalledWith('zoom.fit');
  });

  it('keeps the selection in the settings and restores its overlay', () => {
    const { host, ctrl, settings } = setup();
    ctrl.handleAction('tool.select');
    ctrl.handlePointer(ev('down', 1, 1));
    ctrl.handlePointer(ev('up', 2, 2));
    expect(settings.selection).toEqual([{ x: 1, y: 1, w: 2, h: 2 }]);
    ctrl.handleAction('tool.ruler');
    expect(host.overlay).toBeNull();
    ctrl.handleAction('tool.select');
    expect(host.overlay).toEqual({ kind: 'selection', x: 1, y: 1, w: 2, h: 2 });
    ctrl.handleAction('cancel');
    expect(settings.selection).toEqual([]);
  });
});
