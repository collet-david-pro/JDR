<script lang="ts">
  import { GRID_THEME_IDS } from '../../engine/grid-themes';
  import type { GridTheme } from '../../editor/contracts';
  import { commandLabel, themeLabel } from '../../editor/ui/labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';
  import { href } from '../../lib/services';

  interface Props {
    session: EditorSession;
    gameId: string;
    gameName: string;
  }

  let { session, gameId, gameName }: Props = $props();
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

<header class="topbar">
  <a class="button button-ghost button-small back" href={href(`/games/${gameId}`)}>
    <span aria-hidden="true">←</span>
    {t('editor.back')}
  </a>
  <h1 class="name">{t('editor.name', { game: gameName })}</h1>
  <span class="badge badge-warn" title={t('editor.unsaved_hint')} data-testid="editor-unsaved">
    {t('editor.unsaved')}
  </span>

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

  <div class="group">
    <label class="inline">
      <span class="visually-hidden">{t('editor.grid.theme')}</span>
      <select
        class="select"
        value={ui.theme}
        title={t('editor.grid.theme')}
        data-testid="editor-theme"
        onchange={(event) => session.setTheme(event.currentTarget.value as GridTheme)}
      >
        {#each GRID_THEME_IDS as theme (theme)}
          <option value={theme}>{themeLabel(theme)}</option>
        {/each}
      </select>
    </label>
    <label class="inline check">
      <input
        type="checkbox"
        checked={ui.gridVisible}
        data-testid="editor-grid"
        onchange={(event) => session.setGridVisible(event.currentTarget.checked)}
      />
      {t('editor.grid.show')}
    </label>
  </div>

  <div class="group" role="group" aria-label={t('editor.zoom_fit')}>
    <button
      type="button"
      class="button button-small"
      title={t('editor.zoom_out')}
      aria-label={t('editor.zoom_out')}
      onclick={() => session.zoomBy(1 / 1.25)}><span aria-hidden="true">−</span></button
    >
    <button
      type="button"
      class="button button-small"
      title={t('editor.zoom_in')}
      aria-label={t('editor.zoom_in')}
      onclick={() => session.zoomBy(1.25)}><span aria-hidden="true">+</span></button
    >
    <button type="button" class="button button-small" onclick={() => session.zoomFit()}>
      {t('editor.zoom_fit')}
    </button>
  </div>

  <div class="group end">
    <button
      type="button"
      class="button button-small"
      aria-haspopup="dialog"
      data-testid="editor-help"
      onclick={() => (ui.helpOpen = true)}
    >
      {t('editor.help_button')} <kbd>?</kbd>
    </button>
    <button
      type="button"
      class="button button-small"
      aria-pressed={ui.panelsOpen}
      data-testid="editor-panels"
      onclick={() => session.togglePanels()}
    >
      {ui.panelsOpen ? t('editor.panels.hide') : t('editor.panels.show')}
    </button>
  </div>
</header>

<style>
  .topbar {
    grid-area: top;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
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
  .inline {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
    font-size: var(--font-size-sm);
  }
  .select {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-sm);
  }
  kbd {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }
</style>
