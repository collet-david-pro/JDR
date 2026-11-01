<script lang="ts">
  import type { EditorSession } from '../../editor/ui/session';
  import { saveStatusText, saveStatusTone } from '../../editor/sync/save-status';
  import { t } from '../../lib/i18n';

  /**
   * Permanent save state of the map (projet.md 15.1, 18.1 p.5), announced politely.
   * `onreload` is offered when the map must be loaded again (revision conflict).
   */
  interface Props {
    session: EditorSession;
    onreload?: (() => void) | undefined;
  }

  let { session, onreload }: Props = $props();
  const status = $derived(session.ui.save);
  const loading = $derived(session.ui.loading);
</script>

<span class="indicator" class:wide={status?.state === 'error'} role="status" aria-live="polite">
  {#if loading !== null}
    <span class="badge" data-testid="save-status" data-state="loading" aria-busy="true">
      {t('editor.save.loading', { done: loading.done, total: loading.total })}
    </span>
  {:else if status === null}
    <span class="badge" data-testid="save-status" data-state="loading" aria-busy="true">
      {t('editor.save.loading_map')}
    </span>
  {:else}
    {@const tone = saveStatusTone(status)}
    <span
      class="badge"
      class:badge-ok={tone === 'ok'}
      class:badge-warn={tone === 'warn'}
      class:badge-error={tone === 'error'}
      title={status.durable ? undefined : t('editor.save.memory_only')}
      data-testid="save-status"
      data-state={status.state}
      data-pending={status.pending}
      data-error={status.error ?? ''}
    >
      {#if status.state === 'saving'}<span class="dot" aria-hidden="true"></span>{/if}
      {saveStatusText(status)}
      {#if !status.durable}<span aria-hidden="true">*</span>{/if}
    </span>
    {#if status.state === 'error' && status.error === 'revision_conflict' && onreload}
      <button type="button" class="button button-small" onclick={onreload}>
        {t('common.reload')}
      </button>
    {/if}
  {/if}
</span>

<style>
  /* Fixed width: a longer status must not wrap the top bar, which would move the map under the
     pointer. Only the long error messages take the room they need. */
  .indicator {
    display: inline-flex;
    gap: var(--space-2);
    align-items: center;
    width: 19rem;
    max-width: 100%;
  }
  .indicator.wide {
    width: auto;
  }
  .badge {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
    white-space: nowrap;
  }
  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
  }
</style>
