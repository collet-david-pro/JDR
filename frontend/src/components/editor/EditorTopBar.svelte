<script lang="ts">
  import HelpLink from '../HelpLink.svelte';
  import ExportMenu from './ExportMenu.svelte';
  import FloorSelector from './FloorSelector.svelte';
  import SaveIndicator from './SaveIndicator.svelte';
  import ViewMenu from './ViewMenu.svelte';
  import type { ExportKind } from '../../editor/ui/export-source';
  import { commandLabel } from '../../editor/ui/labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';
  import { href } from '../../lib/services';

  interface Props {
    session: EditorSession;
    gameId: string;
    gameName: string;
    mapName: string;
    /** Loads the map again (offered after a revision conflict). */
    onreload?: (() => void) | undefined;
    /** An export is being downloaded (P4c). */
    exporting?: boolean;
    onexport?: ((kind: ExportKind) => void) | undefined;
  }

  let {
    session,
    gameId,
    gameName,
    mapName,
    onreload,
    exporting = false,
    onexport,
  }: Props = $props();

  function toggleHistory(): void {
    ui.historyOpen = !ui.historyOpen;
    if (ui.historyOpen && !ui.panelsOpen) session.togglePanels();
  }
  function toggleGenerate(): void {
    ui.generateOpen = !ui.generateOpen;
    if (ui.generateOpen && !ui.panelsOpen) session.togglePanels();
  }
  const ui = $derived(session.ui);

  const undoText = $derived(
    ui.history.undoLabel === null
      ? t('editor.undo')
      : t('editor.undo_label', { action: commandLabel(ui.history.undoLabel) }),
  );
  const redoText = $derived(
    ui.history.redoLabel === null
      ? t('editor.redo')
      : t('editor.redo_label', { action: commandLabel(ui.history.redoLabel) }),
  );
</script>

<header class="topbar" data-tour="editor-top">
  <a
    class="button button-ghost button-small back"
    href={href(`/games/${gameId}?tab=maps`)}
    aria-label={t('editor.back')}
    title={t('editor.back')}
  >
    <span aria-hidden="true">←</span>
    {t('editor.back_short')}
  </a>
  <h1 class="name" title={t('editor.map_title', { map: mapName, game: gameName })}>
    {mapName}
  </h1>
  <HelpLink anchor="mj-editeur-presentation" />
  <SaveIndicator {session} {onreload} />
  <FloorSelector {session} />

  <div class="group" role="group" aria-label={t('editor.undo')}>
    <button
      type="button"
      class="button button-small"
      disabled={!ui.history.canUndo}
      title={undoText}
      aria-label={undoText}
      data-testid="editor-undo"
      onclick={() => session.undo()}
    >
      <span aria-hidden="true">↶</span>
    </button>
    <button
      type="button"
      class="button button-small"
      disabled={!ui.history.canRedo}
      title={redoText}
      aria-label={redoText}
      data-testid="editor-redo"
      onclick={() => session.redo()}
    >
      <span aria-hidden="true">↷</span>
    </button>
  </div>

  <div class="group end">
    <ViewMenu {session} />
    <button
      type="button"
      class="button button-small"
      aria-pressed={ui.historyOpen}
      data-testid="editor-history"
      onclick={toggleHistory}>{t('editor.versions.button')}</button
    >
    <button
      type="button"
      class="button button-small"
      aria-pressed={ui.generateOpen}
      title={t('editor.generate.button_title')}
      data-testid="editor-generate"
      onclick={toggleGenerate}>{t('editor.generate.button')}</button
    >
    {#if onexport}
      <ExportMenu busy={exporting} disabled={ui.save === null} {onexport} />
    {/if}
    <button
      type="button"
      class="button button-small"
      aria-haspopup="dialog"
      data-testid="editor-help"
      onclick={() => (ui.helpOpen = true)}
    >
      {t('editor.help_button')}
    </button>
  </div>
</header>

<style>
  .topbar {
    grid-area: top;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-width) solid var(--color-border);
    background: var(--color-surface);
  }
  .back {
    text-decoration: none;
  }
  .name {
    margin: 0;
    font-size: var(--font-size-md);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 24rem;
  }
  .group {
    display: flex;
    gap: var(--space-1);
    align-items: center;
  }
  .end {
    margin-left: auto;
  }
</style>
