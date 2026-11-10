<script lang="ts">
  import ViewControls from './ViewControls.svelte';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /** "Affichage" menu of the editor top bar: view mode, render switches, grid, performance. */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  let root: HTMLDivElement | undefined = $state();

  function outside(event: PointerEvent): void {
    if (ui.viewMenuOpen && root !== undefined && !root.contains(event.target as Node)) {
      ui.viewMenuOpen = false;
    }
  }
  function keydown(event: KeyboardEvent): void {
    if (ui.viewMenuOpen && event.key === 'Escape') {
      ui.viewMenuOpen = false;
      event.stopPropagation();
      root?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }
</script>

<svelte:window onpointerdown={outside} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="menu" bind:this={root} onkeydown={keydown}>
  <button
    type="button"
    class="button button-small"
    aria-expanded={ui.viewMenuOpen}
    aria-controls={`${uid}-panel`}
    data-testid="editor-view-menu"
    onclick={() => (ui.viewMenuOpen = !ui.viewMenuOpen)}
  >
    {t('editor.view.menu')} <span aria-hidden="true">▾</span>
  </button>
  <div id={`${uid}-panel`} class="panel" hidden={!ui.viewMenuOpen}>
    <ViewControls {session} />
  </div>
</div>

<style>
  .menu {
    position: relative;
  }
  .panel {
    position: absolute;
    top: calc(100% + var(--space-1));
    right: 0;
    z-index: 5;
    width: 16rem;
    padding: var(--space-3);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    box-shadow: var(--shadow-lg);
  }
  .panel[hidden] {
    display: none;
  }
</style>
