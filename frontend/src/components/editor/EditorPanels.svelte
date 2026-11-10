<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import AmbientPanel from './AmbientPanel.svelte';
  import LayersPanel from './LayersPanel.svelte';
  import NotesPanel from './NotesPanel.svelte';
  import PalettePanel from './PalettePanel.svelte';
  import PropertiesPanel from './PropertiesPanel.svelte';
  import TokensPanel from './TokensPanel.svelte';
  import { tabForSelection, tabForTool, visibleTabs, type PanelTab } from '../../editor/ui/layout';
  import { panelTabLabel } from '../../editor/ui/labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { nextTabIndex } from '../../lib/games/roles';
  import { t } from '../../lib/i18n';

  /**
   * Right column of the editor (WAI-ARIA tabs): one panel at a time instead of a long stack. The
   * tab follows the tool and the selection (editor/ui/layout.ts); hidden panels stay mounted so
   * their state (search, filters) survives a tab change.
   */
  interface Props {
    session: EditorSession;
    gameId: string;
    tokensState: 'loading' | 'ready' | 'error';
    history: Snippet;
    generate: Snippet;
  }

  let { session, gameId, tokensState, history, generate }: Props = $props();
  const ui = $derived(session.ui);
  const tabs = $derived(visibleTabs(ui.historyOpen, ui.generateOpen));
  const uid = $props.id();
  const tabId = (tab: PanelTab): string => `${uid}-tab-${tab}`;
  const panelId = (tab: PanelTab): string => `${uid}-panel-${tab}`;

  /** Tab to go back to when history or generate closes. */
  let previous: PanelTab = 'palette';
  function show(tab: PanelTab): void {
    if (ui.panelTab === tab) return;
    if (tab === 'history' || tab === 'generate') {
      if (ui.panelTab !== 'history' && ui.panelTab !== 'generate') previous = ui.panelTab;
    }
    ui.panelTab = tab;
  }

  $effect(() => {
    const tab = tabForTool(ui.tool);
    if (tab !== null) untrack(() => show(tab));
  });
  $effect(() => {
    const tab = tabForSelection(ui.objectSelection);
    if (tab !== null) untrack(() => show(tab));
  });
  $effect(() => {
    if (ui.historyOpen) untrack(() => show('history'));
  });
  $effect(() => {
    if (ui.generateOpen) untrack(() => show('generate'));
  });
  // A closed panel gives its place back.
  $effect(() => {
    if (!tabs.includes(ui.panelTab)) untrack(() => (ui.panelTab = previous));
  });

  async function keydown(event: KeyboardEvent, index: number): Promise<void> {
    const next = nextTabIndex(index, event.key, tabs.length);
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[next];
    if (tab === undefined) return;
    show(tab);
    await tick();
    document.getElementById(tabId(tab))?.focus();
  }
</script>

<aside class="panels" aria-label={t('editor.panels.label')} data-testid="editor-panels-column">
  <div class="tabs" role="tablist" aria-label={t('editor.panels.label')}>
    {#each tabs as tab, index (tab)}
      <button
        type="button"
        role="tab"
        id={tabId(tab)}
        aria-selected={ui.panelTab === tab}
        aria-controls={panelId(tab)}
        tabindex={ui.panelTab === tab ? 0 : -1}
        data-testid={`editor-tab-${tab}`}
        onclick={() => show(tab)}
        onkeydown={(event) => keydown(event, index)}>{panelTabLabel(tab)}</button
      >
    {/each}
    <button
      type="button"
      class="collapse button button-small button-ghost"
      aria-pressed="true"
      title={t('editor.panels.hide')}
      aria-label={t('editor.panels.hide')}
      data-testid="editor-panels"
      onclick={() => session.togglePanels()}><span aria-hidden="true">»</span></button
    >
  </div>
  {#each tabs as tab (tab)}
    <div
      class="body"
      role="tabpanel"
      id={panelId(tab)}
      aria-labelledby={tabId(tab)}
      hidden={ui.panelTab !== tab}
    >
      {#if tab === 'properties'}
        <PropertiesPanel {session} />
      {:else if tab === 'palette'}
        <PalettePanel {session} />
      {:else if tab === 'layers'}
        <LayersPanel {session} />
      {:else if tab === 'tokens'}
        <TokensPanel {session} state={tokensState} />
      {:else if tab === 'notes'}
        <NotesPanel {session} {gameId} />
      {:else if tab === 'ambient'}
        <AmbientPanel {session} />
      {:else if tab === 'history'}
        {@render history()}
      {:else}
        {@render generate()}
      {/if}
    </div>
  {/each}
</aside>

<style>
  .panels {
    grid-area: panels;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    border-left: var(--border-width) solid var(--color-border);
    background: var(--color-surface);
  }
  /* Two rows of three in the default width, more per row when the column is widened. */
  .tabs {
    position: relative;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(4.75rem, 1fr));
    padding: 0 2rem 0 var(--space-1);
    border-bottom: var(--border-width) solid var(--color-border);
  }
  .collapse {
    position: absolute;
    top: var(--space-1);
    right: var(--space-1);
    padding-inline: var(--space-2);
  }
  [role='tab'] {
    padding: var(--space-2) var(--space-1);
    white-space: nowrap;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-sm);
  }
  [role='tab']:hover {
    color: var(--color-text);
  }
  [role='tab'][aria-selected='true'] {
    border-bottom-color: var(--color-primary);
    color: var(--color-primary);
    font-weight: var(--font-weight-medium);
  }
  .body {
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }
  .body[hidden] {
    display: none;
  }
  /* The tab already names the panel. */
  .body :global(section > h2:first-child),
  .body :global(section > .head:first-child > h2) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
