<script lang="ts">
  import type { ExportKind } from '../../editor/ui/export-source';
  import { t } from '../../lib/i18n';

  /** "Exporter" menu of the editor top bar (P4c): JSON, ZIP with images, PNG image. */
  interface Props {
    /** An export is being downloaded. */
    busy: boolean;
    disabled: boolean;
    onexport: (kind: ExportKind) => void;
  }

  let { busy, disabled, onexport }: Props = $props();
  const uid = $props.id();
  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();

  function choose(kind: ExportKind): void {
    open = false;
    onexport(kind);
  }

  function outside(event: PointerEvent): void {
    if (open && root !== undefined && !root.contains(event.target as Node)) open = false;
  }

  function keydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') {
      open = false;
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
    aria-expanded={open}
    aria-controls={`${uid}-list`}
    aria-busy={busy ? 'true' : undefined}
    disabled={disabled || busy}
    data-testid="editor-export"
    onclick={() => (open = !open)}
  >
    {t('editor.export.button')} <span aria-hidden="true">▾</span>
  </button>
  {#if open}
    <ul id={`${uid}-list`} class="list" aria-label={t('editor.export.button')}>
      <li>
        <button type="button" data-testid="export-json" onclick={() => choose('json')}>
          {t('editor.export.json')}
        </button>
      </li>
      <li>
        <button type="button" data-testid="export-zip" onclick={() => choose('zip')}>
          {t('editor.export.zip')}
        </button>
      </li>
      <li>
        <button type="button" data-testid="export-png" onclick={() => choose('png')}>
          {t('editor.export.png')}
        </button>
      </li>
    </ul>
  {/if}
</div>

<style>
  .menu {
    position: relative;
  }
  .list {
    position: absolute;
    top: calc(100% + var(--space-1));
    right: 0;
    z-index: 5;
    min-width: 14rem;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    box-shadow: var(--shadow-lg);
  }
  .list button {
    display: block;
    width: 100%;
    padding: var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    font-size: var(--font-size-sm);
    text-align: left;
    cursor: pointer;
  }
  .list button:hover,
  .list button:focus-visible {
    background: var(--color-surface-sunken);
  }
</style>
