/**
 * Commands of the GM console palette (P9c2): one per button of the header and of the panels,
 * plus one per map, passage, note, secret, token and player. Everything is injected
 * (`ConsoleCommandDeps`) so the list is testable without Svelte. Destructive commands (end the
 * session, kick, remove a token, change the map) only OPEN the existing confirmation. Titles and
 * names come from users: they are plain text. Nothing is offered to a player or a screen.
 */
import type { SecretObject, TrapObject } from '../../../editor/contracts-notes';
import type { MapNote } from '../../../editor/contracts-notes';
import { secretKindLabel } from '../../../editor/ui/note-labels';
import type { Command } from '../../commands';
import { t } from '../../i18n';
import type { Transition } from '../sessions-client';
import { objectsOfFloor, tokensOfFloor, type SessionState } from '../state';
import type { SessionAction } from '../types';
import type { ConsoleTool, Selection } from './console-input';
import { CONSOLE_PANELS, type ConsolePanelId, type ConsoleUi } from './console-ui.svelte';
import type { Passage } from './passages';

export interface ConfirmRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly run: () => void;
}

export interface ConsoleCommandDeps {
  readonly ui: ConsoleUi;
  readonly state: () => SessionState | null;
  /** Floor (uid) shown by the scene, null without a scene. */
  readonly floor: () => string | null;
  readonly selection: () => Selection | null;
  readonly maps: () => readonly { readonly id: string; readonly name: string }[];
  readonly passages: () => readonly Passage[];
  readonly zoneSuggestions: () => readonly {
    readonly zoneUid: string;
    readonly noteUid: string;
    readonly title: string;
  }[];
  readonly send: (actions: SessionAction[]) => Promise<boolean>;
  readonly transition: (action: Transition) => Promise<void>;
  readonly copyCode: () => Promise<void>;
  readonly setTool: (tool: ConsoleTool) => void;
  readonly share: (follow: boolean) => void;
  readonly dismissSuggestion: (zoneUid: string) => void;
  readonly hideToken: (uid: string) => Promise<void>;
  readonly removeToken: (uid: string) => Promise<void>;
  readonly kick: (userId: string) => Promise<void>;
  /** Opens the confirmation dialog of the host. */
  readonly confirm: (request: ConfirmRequest) => void;
  /** Waits for the DOM (a tab just switched mounts its panel). */
  readonly tick: () => Promise<void>;
  readonly focusDisplayName: () => void;
  readonly onError: (error: unknown) => void;
}

function panelLabel(panel: ConsolePanelId): string {
  switch (panel) {
    case 'players':
      return t('sessions.panels.players');
    case 'tokens':
      return t('sessions.panels.tokens');
    case 'reveal':
      return t('sessions.panels.reveal');
    case 'ambiance':
      return t('sessions.panels.ambiance');
    case 'notes':
      return t('sessions.panels.notes');
    case 'maps':
      return t('sessions.panels.maps');
    case 'displays':
      return t('sessions.panels.displays');
  }
}

/** Builds the command palette entries of the console. */
export function buildConsoleCommands(d: ConsoleCommandDeps): Command[] {
  const out: Command[] = [];
  const g = {
    session: t('palette.group.session'),
    go: t('palette.group.go'),
    tools: t('palette.group.tools'),
    maps: t('palette.group.map'),
    notes: t('palette.group.notes'),
    tokens: t('palette.group.tokens'),
    players: t('palette.group.players'),
  };
  const fire = (task: () => Promise<unknown>) => (): void => {
    void task().catch(d.onError);
  };
  const phase = (): string | null => d.state()?.session.state ?? null;
  const live = (): boolean => phase() !== null && phase() !== 'ended';
  const add = (command: Command): void => {
    out.push(command);
  };
  /** Switches to a tab, waits for its panel, then runs `after`. */
  const inTab = (panel: ConsolePanelId, after: () => void) =>
    fire(async () => {
      d.ui.tab = panel;
      await d.tick();
      after();
    });

  // ---- Header ---------------------------------------------------------------------------------
  const hasCode = (): boolean => live() && (d.state()?.session.code ?? '') !== '';
  add({
    id: 'console.copy_code',
    label: t('palette.copy_code'),
    group: g.session,
    when: hasCode,
    run: fire(d.copyCode),
  });
  add({
    id: 'console.regenerate_code',
    label: t('sessions.console.regenerate_code'),
    group: g.session,
    when: hasCode,
    run: () => (d.ui.regenOpen = true),
  });
  add({
    id: 'console.start',
    label: t('sessions.console.start'),
    group: g.session,
    when: () => phase() === 'lobby',
    run: fire(() => d.transition('start')),
  });
  add({
    id: 'console.pause',
    label: t('sessions.console.pause'),
    group: g.session,
    when: () => phase() === 'running',
    run: fire(() => d.transition('pause')),
  });
  add({
    id: 'console.resume',
    label: t('sessions.console.resume'),
    group: g.session,
    when: () => phase() === 'paused',
    run: fire(() => d.transition('resume')),
  });
  add({
    id: 'console.end',
    label: t('sessions.console.end'),
    group: g.session,
    when: live,
    run: () => (d.ui.endOpen = true),
  });
  add({
    id: 'console.share_view',
    label: t('sessions.console.share_view'),
    group: g.session,
    when: () => live() && d.floor() !== null,
    run: () => d.share(false),
  });
  add({
    id: 'console.pause_screen',
    label: t('sessions.console.pause_screen'),
    group: g.session,
    when: live,
    run: () => (d.ui.pauseOpen = true),
  });

  // ---- Tabs -----------------------------------------------------------------------------------
  for (const panel of CONSOLE_PANELS) {
    add({
      id: `console.tab.${panel}`,
      label: t('palette.go_to', { panel: panelLabel(panel) }),
      group: g.go,
      when: () => d.ui.tab !== panel,
      run: () => (d.ui.tab = panel),
    });
  }

  // ---- Tools ----------------------------------------------------------------------------------
  add({
    id: 'console.tool.select',
    label: t('palette.tool_select'),
    group: g.tools,
    run: () => d.setTool({ kind: 'select' }),
  });
  add({
    id: 'console.tool.fog',
    label: t('sessions.reveal.start'),
    group: g.tools,
    when: () => d.floor() !== null,
    run: () => d.setTool({ kind: 'fog', op: 'reveal', shape: 'brush', radius: 2 }),
  });
  const state = d.state();
  const defs = Object.values(state?.definitions ?? {}).sort((a, b) => a.name.localeCompare(b.name));
  for (const def of defs) {
    add({
      id: `console.tool.token.${def.id}`,
      label: t('palette.place_token', { name: def.name }),
      group: g.tools,
      keywords: [t('sessions.tokens.place')],
      when: () => d.floor() !== null && live(),
      run: () => d.setTool({ kind: 'token', tokenId: def.id, hidden: false }),
    });
  }
  add({
    id: 'console.reveal_selection',
    label: t('palette.reveal_selection'),
    group: g.tools,
    when: () => d.selection() !== null,
    run: fire(() => {
      const selection = d.selection();
      if (selection === null) return Promise.resolve();
      const type = d.state()?.objects[selection.uid]?.type;
      const action: SessionAction =
        selection.kind === 'object' && type === 'trap'
          ? { type: 'trap.reveal', uid: selection.uid }
          : selection.kind === 'object' && type === 'secret'
            ? { type: 'secret.reveal', uid: selection.uid }
            : { type: 'reveal', kind: selection.kind, uid: selection.uid };
      return d.send([action]);
    }),
  });

  // ---- Maps and passages ----------------------------------------------------------------------
  for (const map of d.maps()) {
    add({
      id: `console.map.${map.id}`,
      label: t('palette.change_map', { name: map.name }),
      group: g.maps,
      keywords: [t('sessions.maps.change')],
      when: () => map.id !== d.state()?.session.current_map_id && live(),
      run: inTab('maps', () => (d.ui.mapRequest = map.id)),
    });
  }
  for (const passage of d.passages()) {
    const where = [passage.mapName, passage.floorName].filter((v) => v !== null && v !== '');
    add({
      id: `console.passage.${passage.uid}`,
      label: t('palette.take_passage', { name: where.join(' · ') || passage.type }),
      group: g.maps,
      when: () => live() && passage.destination !== null,
      run: inTab('maps', () => (d.ui.passageRequest = passage.uid)),
    });
  }

  // ---- Notes, secrets, zones ------------------------------------------------------------------
  const notes = Object.values(state?.notes ?? {})
    .filter((n): n is MapNote => 'audience' in n)
    .sort((a, b) => a.title.localeCompare(b.title));
  for (const note of notes) {
    const title = note.title === '' ? t('sessions.map_notes.untitled') : note.title;
    add({
      id: `console.note.read.${note.uid}`,
      label: t('palette.note_read', { title }),
      group: g.notes,
      when: live,
      run: fire(() => d.send([{ type: 'note.show', note_uid: note.uid }])),
    });
    add({
      id: `console.note.share.${note.uid}`,
      label: t('palette.note_share', { title }),
      group: g.notes,
      when: live,
      run: inTab('notes', () => (d.ui.shareRequest = note.uid)),
    });
  }
  const floor = d.floor();
  if (state !== null && floor !== null) {
    const secrets = objectsOfFloor(state, floor).filter(
      (o): o is TrapObject | SecretObject => o.type === 'trap' || o.type === 'secret',
    );
    for (const o of secrets) {
      const kind = o.type === 'secret' ? secretKindLabel(o.props.kind) : t('sessions.secrets.trap');
      const noteTitle = o.props.note === null ? undefined : state.notes[o.props.note]?.title;
      add({
        id: `console.reveal.${o.uid}`,
        label: t('palette.reveal_named', { name: noteTitle ? `${kind} · ${noteTitle}` : kind }),
        group: g.notes,
        when: () => live() && !(d.state()?.revealed ?? []).includes(o.uid),
        run: fire(() =>
          d.send([
            o.type === 'trap'
              ? { type: 'trap.reveal', uid: o.uid }
              : { type: 'secret.reveal', uid: o.uid },
          ]),
        ),
      });
    }
  }
  for (const z of d.zoneSuggestions()) {
    add({
      id: `console.zone.read.${z.zoneUid}`,
      label: t('sessions.zone.read', { title: z.title }),
      group: g.notes,
      when: live,
      run: fire(async () => {
        if (await d.send([{ type: 'note.show', note_uid: z.noteUid }]))
          d.dismissSuggestion(z.zoneUid);
      }),
    });
  }

  // ---- Tokens ---------------------------------------------------------------------------------
  if (state !== null && floor !== null) {
    for (const tok of tokensOfFloor(state, floor)) {
      const name = state.definitions[tok.token_id]?.name ?? tok.token_id;
      if (tok.hidden) {
        add({
          id: `console.token.reveal.${tok.uid}`,
          label: t('palette.token_reveal', { name }),
          group: g.tokens,
          when: live,
          run: fire(() => d.send([{ type: 'reveal', kind: 'token', uid: tok.uid }])),
        });
      } else {
        add({
          id: `console.token.hide.${tok.uid}`,
          label: t('palette.token_hide', { name }),
          group: g.tokens,
          when: live,
          run: fire(() => d.hideToken(tok.uid)),
        });
      }
      add({
        id: `console.token.remove.${tok.uid}`,
        label: t('sessions.tokens.remove_named', { name }),
        group: g.tokens,
        when: live,
        run: () =>
          d.confirm({
            title: t('palette.confirm_remove_title', { name }),
            message: t('palette.confirm_remove_text'),
            confirmLabel: t('sessions.tokens.remove'),
            run: fire(() => d.removeToken(tok.uid)),
          }),
      });
    }
  }

  // ---- Players and screens --------------------------------------------------------------------
  for (const player of state?.session.players ?? []) {
    if (player.status === 'kicked') continue;
    add({
      id: `console.player.kick.${player.user_id}`,
      label: t('sessions.players.kick_named', { name: player.username }),
      group: g.players,
      when: live,
      run: () =>
        d.confirm({
          title: t('palette.confirm_kick_title', { name: player.username }),
          message: t('palette.confirm_kick_text'),
          confirmLabel: t('sessions.players.kick'),
          run: fire(() => d.kick(player.user_id)),
        }),
    });
  }
  add({
    id: 'console.display.add',
    label: t('palette.display_add'),
    group: g.players,
    when: live,
    run: inTab('displays', d.focusDisplayName),
  });
  return out;
}
