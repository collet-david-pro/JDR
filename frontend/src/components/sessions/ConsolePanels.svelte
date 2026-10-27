<script lang="ts">
  import { tick } from 'svelte';
  import AmbiancePanel from './AmbiancePanel.svelte';
  import DisplaysPanel from './DisplaysPanel.svelte';
  import MapsPanel from './MapsPanel.svelte';
  import NotesPanel from './NotesPanel.svelte';
  import PlayersPanel from './PlayersPanel.svelte';
  import RevealPanel from './RevealPanel.svelte';
  import TokensPanel from './TokensPanel.svelte';
  import { nextTabIndex } from '../../lib/games/roles';
  import { t } from '../../lib/i18n';
  import type { ConsoleTool } from '../../lib/sessions/console/console-input';
  import type { PanelProps } from '../../lib/sessions/console/panel-props';

  /**
   * Side panels of the console (WAI-ARIA tabs): Players, Tokens, Reveal, Ambiance, Notes, Maps, Screens.
   */
  interface Props extends PanelProps {
    tool: ConsoleTool;
    ontool: (tool: ConsoleTool) => void;
  }

  let props: Props = $props();
  const PANELS = ['players', 'tokens', 'reveal', 'ambiance', 'notes', 'maps', 'displays'] as const;
  type PanelId = (typeof PANELS)[number];
  const uid = $props.id();
  let current = $state<PanelId>('players');
  const tabId = (p: PanelId): string => `${uid}-tab-${p}`;
  const panelId = (p: PanelId): string => `${uid}-panel-${p}`;

  function label(p: PanelId): string {
    switch (p) {
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

  async function keydown(event: KeyboardEvent, index: number): Promise<void> {
    const next = nextTabIndex(index, event.key, PANELS.length);
    if (next === null) return;
    event.preventDefault();
    const panel = PANELS[next];
    if (panel === undefined) return;
    current = panel;
    await tick();
    document.getElementById(tabId(panel))?.focus();
  }
</script>

<div class="panels">
  <div class="tabs" role="tablist" aria-label={t('sessions.panels.label')}>
    {#each PANELS as panel, index (panel)}
      <button
        type="button"
        role="tab"
        id={tabId(panel)}
        aria-selected={current === panel}
        aria-controls={panelId(panel)}
        tabindex={current === panel ? 0 : -1}
        data-testid={`panel-tab-${panel}`}
        onclick={() => (current = panel)}
        onkeydown={(event) => keydown(event, index)}
        >{label(panel)}{#if panel === 'displays' && props.displays.reusable.length > 0}<span
            class="dot"
            data-testid="panel-tab-displays-reusable"
            title={t('sessions.displays.reusable', { count: props.displays.reusable.length })}
          ></span>{/if}</button
      >
    {/each}
  </div>
  <div
    class="body"
    role="tabpanel"
    id={panelId(current)}
    aria-labelledby={tabId(current)}
    tabindex="0"
  >
    {#if current === 'players'}
      <PlayersPanel {...props} />
    {:else if current === 'tokens'}
      <TokensPanel {...props} />
    {:else if current === 'reveal'}
      <RevealPanel {...props} />
    {:else if current === 'ambiance'}
      <AmbiancePanel {...props} />
    {:else if current === 'notes'}
      <NotesPanel {...props} />
    {:else if current === 'maps'}
      <MapsPanel {...props} />
    {:else}
      <DisplaysPanel {...props} />
    {/if}
  </div>
</div>

<style>
  .panels {
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 0;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    border-bottom: var(--border-width) solid var(--color-border);
  }
  [role='tab'] {
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-sm);
  }
  [role='tab'][aria-selected='true'] {
    border-bottom-color: var(--color-primary);
    color: var(--color-primary);
    font-weight: var(--font-weight-medium);
  }
  .dot {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    margin-left: var(--space-1);
    border-radius: 50%;
    background: var(--color-primary);
  }
  .body {
    min-height: 0;
    overflow-y: auto;
  }
</style>
