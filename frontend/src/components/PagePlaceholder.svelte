<script lang="ts">
  import { t } from '../lib/i18n';
  import { href } from '../lib/services';
  import type { RouteParams } from '../router';

  interface Props {
    titleKey: string;
    /** Roadmap phase that delivers the page (projet.md section 23). */
    phase: string;
    params?: RouteParams;
  }

  let { titleKey, phase, params = {} }: Props = $props();
  const entries = $derived(Object.entries(params));
</script>

<section class="placeholder">
  <h1>{t(titleKey)}</h1>
  <p>{t('pages.placeholder.text', { phase })}</p>
  {#if entries.length > 0}
    <dl>
      {#each entries as [name, value] (name)}
        <dt>{name}</dt>
        <dd>{value}</dd>
      {/each}
    </dl>
  {/if}
  <p><a href={href('/')}>{t('common.home')}</a></p>
</section>

<style>
  .placeholder {
    max-width: 40rem;
    padding: var(--space-6);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
  }
  h1 {
    margin-top: 0;
  }
  p {
    color: var(--color-text-muted);
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-1) var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }
  dt {
    color: var(--color-text-muted);
  }
  dd {
    margin: 0;
  }
</style>
