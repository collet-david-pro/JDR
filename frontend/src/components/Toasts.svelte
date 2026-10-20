<script lang="ts">
  import { t } from '../lib/i18n';
  import { toasts } from '../stores/toasts.svelte';
</script>

<!-- Polite live region: messages are announced without interrupting (WCAG 4.1.3). -->
<div class="toasts" role="status" aria-live="polite" aria-relevant="additions">
  {#each toasts.items as toast (toast.id)}
    <div class="toast toast-{toast.kind}">
      <p class="text">
        {toast.message}
        {#if toast.requestId}
          <span class="request-id">{t('pages.error.request_id', { id: toast.requestId })}</span>
        {/if}
      </p>
      <button
        type="button"
        class="button button-ghost button-small"
        onclick={() => toasts.dismiss(toast.id)}
      >
        <span aria-hidden="true">×</span><span class="visually-hidden">{t('common.close')}</span>
      </button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: var(--space-4);
    bottom: var(--space-4);
    z-index: var(--z-toast);
    display: grid;
    gap: var(--space-2);
    width: min(24rem, calc(100vw - 2 * var(--space-4)));
  }
  .toast {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
    border: var(--border-width) solid var(--color-border);
    border-left-width: 4px;
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    box-shadow: var(--shadow-md);
    animation: toast-in var(--duration-normal) var(--easing);
  }
  .toast-success {
    border-left-color: var(--color-success);
  }
  .toast-error {
    border-left-color: var(--color-danger);
  }
  .toast-info {
    border-left-color: var(--color-primary);
  }
  .text {
    flex: 1;
    margin: 0;
  }
  .request-id {
    display: block;
    margin-top: var(--space-1);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(0.5rem);
    }
  }
</style>
