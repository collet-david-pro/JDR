import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Command } from '../../src/lib/commands';
import {
  buildConsoleCommands,
  type ConfirmRequest,
  type ConsoleCommandDeps,
} from '../../src/lib/sessions/console/console-commands';
import { ConsoleUi } from '../../src/lib/sessions/console/console-ui.svelte';
import { createSessionState } from '../../src/lib/sessions/state';
import type { SessionState } from '../../src/lib/sessions/state';
import { mapDetail, placed, session, snapshot } from '../sessions/fixtures';

/** Console button (data-testid) => id of the palette command that does the same. */
const BUTTON_TO_COMMAND: Readonly<Record<string, string>> = {
  'session-code-copy': 'console.copy_code',
  'console-regenerate-code': 'console.regenerate_code',
  'session-start': 'console.start',
  'session-pause': 'console.pause',
  'session-resume': 'console.resume',
  'session-end': 'console.end',
  'share-view': 'console.share_view',
  'console-pause-screen': 'console.pause_screen',
  'panel-tab-players': 'console.tab.players',
  'panel-tab-tokens': 'console.tab.tokens',
  'panel-tab-reveal': 'console.tab.reveal',
  'panel-tab-ambiance': 'console.tab.ambiance',
  'panel-tab-notes': 'console.tab.notes',
  'panel-tab-maps': 'console.tab.maps',
  'panel-tab-displays': 'console.tab.displays',
  'fog-tool': 'console.tool.fog',
  'token-place': 'console.tool.token.21',
  'maps-change': 'console.map.99',
  'map-note-read': 'console.note.read.n1',
  'map-note-share': 'console.note.share.n1',
  'zone-read': 'console.zone.read.z1',
  'displays-add': 'console.display.add',
};

function stateOf(phase: 'lobby' | 'running' | 'paused' | 'ended'): SessionState {
  const base = createSessionState(
    snapshot('gm', {
      session: session('gm', { state: phase }),
      map: mapDetail({ tokens_placed: [placed('t1'), { ...placed('t2', '22'), hidden: true }] }),
    }),
    '1',
  );
  const note = { uid: 'n1', title: 'Mot de <b>passe</b>', body: '', audience: 'gm_only' };
  return { ...base, notes: { n1: note } } as unknown as SessionState;
}

function setup(phase: 'lobby' | 'running' | 'paused' | 'ended' = 'running') {
  const state = stateOf(phase);
  const ui = new ConsoleUi();
  const calls = {
    send: vi.fn(async () => true),
    transition: vi.fn(async () => undefined),
    kick: vi.fn(async () => undefined),
    removeToken: vi.fn(async () => undefined),
    hideToken: vi.fn(async () => undefined),
    setTool: vi.fn(),
    share: vi.fn(),
    errors: [] as unknown[],
    confirms: [] as ConfirmRequest[],
  };
  const deps: ConsoleCommandDeps = {
    ui,
    state: () => state,
    floor: () => '35',
    selection: () => null,
    maps: () => [
      { id: '34', name: 'Crypte' },
      { id: '99', name: 'Donjon' },
    ],
    passages: () => [],
    zoneSuggestions: () => [{ zoneUid: 'z1', noteUid: 'n1', title: 'Zone' }],
    send: calls.send,
    transition: calls.transition,
    copyCode: async () => undefined,
    setTool: calls.setTool,
    share: calls.share,
    dismissSuggestion: () => undefined,
    hideToken: calls.hideToken,
    removeToken: calls.removeToken,
    kick: calls.kick,
    confirm: (request) => calls.confirms.push(request),
    tick: async () => undefined,
    focusDisplayName: () => undefined,
    onError: (error) => calls.errors.push(error),
  };
  const commands = buildConsoleCommands(deps);
  const offered = (): Set<string> =>
    new Set(commands.filter((c) => c.when === undefined || c.when()).map((c) => c.id));
  const find = (id: string): Command => {
    const c = commands.find((x) => x.id === id);
    if (c === undefined) throw new Error(`no command ${id}`);
    return c;
  };
  return { ui, calls, commands, offered, find };
}

describe('console palette commands', () => {
  it('has one command for every console button of the table', () => {
    const { commands } = setup();
    const ids = new Set(commands.map((c) => c.id));
    for (const [button, id] of Object.entries(BUTTON_TO_COMMAND)) {
      expect(ids.has(id), `${button} => ${id}`).toBe(true);
    }
  });

  it('has a command per token, player, map, secret target and display', () => {
    const { commands } = setup();
    const ids = commands.map((c) => c.id);
    for (const id of [
      'console.token.hide.t1',
      'console.token.remove.t1',
      'console.token.reveal.t2',
      'console.token.remove.t2',
      'console.player.kick.7',
      'console.player.kick.8',
      'console.map.34',
      'console.reveal_selection',
      'console.tool.select',
    ]) {
      expect(ids, id).toContain(id);
    }
  });

  it('offers the session buttons according to the state of the session', () => {
    const states = {
      lobby: ['console.start', 'console.end'],
      running: ['console.pause', 'console.end'],
      paused: ['console.resume', 'console.end'],
    } as const;
    for (const [phase, expected] of Object.entries(states)) {
      const { offered } = setup(phase as keyof typeof states);
      const on = offered();
      for (const id of expected) expect(on.has(id), `${phase} ${id}`).toBe(true);
      for (const id of ['console.start', 'console.pause', 'console.resume']) {
        if (!expected.includes(id as never)) expect(on.has(id), `${phase} ${id}`).toBe(false);
      }
    }
    const ended = setup('ended').offered();
    for (const id of [
      'console.end',
      'console.pause',
      'console.share_view',
      'console.pause_screen',
    ]) {
      expect(ended.has(id), id).toBe(false);
    }
  });

  it('pause runs the transition at once', async () => {
    const { find, calls } = setup('running');
    find('console.pause').run();
    await Promise.resolve();
    expect(calls.transition).toHaveBeenCalledWith('pause');
  });

  it('destructive commands only open the existing confirmation', async () => {
    const { find, calls, ui } = setup('running');
    find('console.end').run();
    expect(ui.endOpen).toBe(true);
    expect(calls.transition).not.toHaveBeenCalled();

    find('console.player.kick.7').run();
    find('console.token.remove.t1').run();
    expect(calls.confirms).toHaveLength(2);
    expect(calls.kick).not.toHaveBeenCalled();
    expect(calls.removeToken).not.toHaveBeenCalled();
    calls.confirms[0]?.run();
    expect(calls.kick).toHaveBeenCalledWith('7');

    find('console.map.99').run();
    await new Promise((r) => setTimeout(r, 0));
    expect(ui.tab).toBe('maps');
    expect(ui.mapRequest).toBe('99');
  });

  it('user texts are never rendered as HTML', () => {
    const root = fileURLToPath(new URL('../../src/', import.meta.url));
    for (const file of [
      'lib/sessions/console/console-commands.ts',
      'components/sessions/ConsoleCommandHost.svelte',
      'components/CommandPalette.svelte',
      'components/editor/EditorCommandPalette.svelte',
    ]) {
      expect(readFileSync(root + file, 'utf8')).not.toContain('{@html');
    }
  });

  it('a failing action ends in onError, not in an exception', async () => {
    const { find, calls } = setup('running');
    calls.transition.mockRejectedValueOnce(new Error('boom'));
    find('console.pause').run();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.errors).toHaveLength(1);
  });
});
