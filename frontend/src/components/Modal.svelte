<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n';

  interface Props {
    open: boolean;
    title: string;
    children: Snippet;
    /** Called when the dialog closes (Escape, close button or open = false). */
    onclose?: () => void;
  }

  let { open = $bindable(), title, children, onclose }: Props = $props();

  const uid = $props.id();
  let dialog: HTMLDialogElement | undefined = $state();

  // Native modal dialog: focus trap, Escape, inert background and focus restoration.
  $effect(() => {
    if (dialog === undefined) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  function handleClose(): void {
    if (open) open = false;
    onclose?.();
  }
</script>

<dialog bind:this={dialog} aria-labelledby={`${uid}-title`} onclose={handleClose}>
  {#if open}
    <header>
      <h2 id={`${uid}-title`}>{title}</h2>
      <button type="button" class="button button-ghost close" onclick={() => (open = false)}>
        <span aria-hidden="true">×</span><span class="visually-hidden">{t('common.close')}</span>
      </button>
    </header>
    <div class="body">{@render children()}</div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(32rem, calc(100vw - 2 * var(--space-4)));
    max-height: calc(100vh - 2 * var(--space-6));
    padding: 0;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: var(--shadow-lg);
  }
  dialog::backdrop {
    background: var(--color-backdrop);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5) 0;
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-lg);
  }
  .close {
    font-size: var(--font-size-lg);
    line-height: 1;
  }
  .body {
    padding: var(--space-4) var(--space-5) var(--space-5);
  }
</style>
