<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import CommandPalette from '../CommandPalette.svelte';
  import { detectPlatform } from '../../editor/shortcuts';
  import { copyText } from '../../lib/clipboard';
  import { t } from '../../lib/i18n';
  import { mapsClient } from '../../lib/maps/service';
  import { handlePaletteKey } from '../../lib/palette-key';
  import { sessionsClient } from '../../lib/services';
  import type { Transition } from '../../lib/sessions';
  import {
    buildConsoleCommands,
    type ConfirmRequest,
  } from '../../lib/sessions/console/console-commands';
  import type { ConsoleTool, Selection } from '../../lib/sessions/console/console-input';
  import { consoleUi } from '../../lib/sessions/console/console-ui.svelte';
  import { hideTokenOp, removeTokenOp, sendMapOps } from '../../lib/sessions/console/map-ops';
  import { passagesOf, shownFloor } from '../../lib/sessions/console/passages';
  import { sessionProblem } from '../../lib/sessions/labels';
  import type { SessionRun } from '../../lib/sessions/session-run.svelte';
  import type { SessionAction } from '../../lib/sessions/types';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * Cmd/Ctrl+K palette of the GM console (P9c2) with the confirmation of the destructive commands
   * that have no dialog of their own (kick, remove a token). GM only: the console is GM only.
   */
  interface Props {
    run: SessionRun;
    gameId: string;
    send: (actions: SessionAction[]) => Promise<boolean>;
    selection: Selection | null;
    onshare: (follow: boolean) => void;
    ontool: (tool: ConsoleTool) => void;
  }

  let { run, gameId, send, selection, onshare, ontool }: Props = $props();
  const platform = detectPlatform(navigator);
  let open = $state(false);
  let maps = $state.raw<readonly { id: string; name: string }[]>([]);
  let confirm = $state.raw<ConfirmRequest | null>(null);
  let confirmOpen = $state(false);

  onMount(() => {
    consoleUi.reset();
    mapsClient()
      .list(gameId)
      .then((list) => (maps = list.map((m) => ({ id: m.id, name: m.name }))))
      .catch(() => undefined);
  });

  async function ops(list: Parameters<typeof sendMapOps>[3]): Promise<void> {
    const s = run.state;
    if (s?.map == null) return;
    try {
      await sendMapOps(mapsClient(), s.map.id, s.mapRevision ?? s.map.revision, list);
    } catch (error) {
      toasts.show('error', sessionProblem(error));
    }
  }

  const commands = $derived(
    buildConsoleCommands({
      ui: consoleUi,
      state: () => run.state,
      floor: () => run.scene?.floor ?? null,
      selection: () => selection,
      maps: () => maps,
      passages: () => {
        const s = run.state;
        const floor = s === null ? null : shownFloor(s);
        return s === null || floor === null ? [] : passagesOf(s, floor, null);
      },
      zoneSuggestions: () => run.zoneSuggestions,
      send,
      transition: async (action: Transition) => {
        const id = run.state?.session.id;
        if (id === undefined) return;
        try {
          await sessionsClient().transition(id, action);
          await run.reload();
        } catch (error) {
          toasts.show('error', sessionProblem(error));
        }
      },
      copyCode: async () => {
        const code = run.state?.session.code ?? '';
        if (await copyText(code)) toasts.success(t('common.copied'));
        else toasts.info(t('common.copy_failed'));
      },
      setTool: ontool,
      share: onshare,
      dismissSuggestion: (uid) => run.dismissSuggestion(uid),
      hideToken: async (uid) => {
        const tok = run.state?.tokens[uid];
        if (tok !== undefined) await ops([hideTokenOp(tok, true)]);
      },
      removeToken: (uid) => ops([removeTokenOp(uid)]),
      kick: async (userId) => {
        const id = run.state?.session.id;
        if (id === undefined) return;
        try {
          await sessionsClient().kick(id, userId);
          await run.reload();
        } catch (error) {
          toasts.show('error', sessionProblem(error));
        }
      },
      confirm: (request) => {
        confirm = request;
        confirmOpen = true;
      },
      tick,
      focusDisplayName: () =>
        document.querySelector<HTMLElement>('[data-testid="displays-add-name"]')?.focus(),
      onError: (error) => toasts.error(error),
    }),
  );
</script>

<svelte:window
  onkeydown={(event) =>
    handlePaletteKey(event, { platform, isOpen: () => open, setOpen: (value) => (open = value) })}
/>

<CommandPalette bind:open {commands} {platform} />
{#if confirm !== null}
  <ConfirmDialog
    bind:open={confirmOpen}
    title={confirm.title}
    message={confirm.message}
    confirmLabel={confirm.confirmLabel}
    danger
    onconfirm={() => {
      confirmOpen = false;
      confirm?.run();
    }}
  />
{/if}
