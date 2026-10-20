<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ErrorSummary } from '../lib/errors';
  import { t } from '../lib/i18n';

  interface Props {
    failure: ErrorSummary | null;
    children?: Snippet;
  }

  let { failure, children }: Props = $props();
</script>

{#if failure}
  <div class="alert alert-error" role="alert">
    <p>{failure.message}</p>
    {#if failure.requestId}
      <p class="small muted">{t('pages.error.request_id', { id: failure.requestId })}</p>
    {/if}
    {@render children?.()}
  </div>
{/if}

<style>
  p {
    margin: 0;
  }
  p + p {
    margin-top: var(--space-1);
  }
</style>
