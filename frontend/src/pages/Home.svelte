<script lang="ts">
  import { onMount } from 'svelte';
  import ThemeControls from '../components/ThemeControls.svelte';
  import { errorMessage } from '../lib/errors';
  import { t } from '../lib/i18n';
  import type { PageProps } from '../lib/page';
  import { services } from '../lib/services';
  import { HealthCheck } from '../stores/health.svelte';

  // Route props (unused by this page).
  let _props: PageProps = $props();

  const { api, boot } = services();
  const health = new HealthCheck(api);

  onMount(() => {
    void health.run();
  });
</script>

<!-- Provisional home page (P0): API status and theme selection. Dashboard in P1/P3. -->
<section class="home">
  <header>
    <h1>{t('app.name')}</h1>
    <p class="subtitle">{t('app.tagline')}</p>
  </header>

  <div class="card" aria-live="polite" aria-busy={health.status === 'loading'}>
    <h2>{t('health.title')}</h2>
    <ul class="status-list">
      <li>
        {#if health.status === 'loading'}
          <span class="dot" aria-hidden="true"></span>{t('common.loading')}
        {:else if health.status === 'ok'}
          <span class="dot dot-ok" aria-hidden="true"></span>{t('health.status_ok')}
        {:else}
          <span class="dot dot-error" aria-hidden="true"></span>{t('health.unreachable')}
        {/if}
      </li>
      {#if health.data}
        <li>
          <span
            class="dot"
            class:dot-ok={health.data.db === 'ok'}
            class:dot-error={health.data.db !== 'ok'}
            aria-hidden="true"
          ></span>{t(`health.db_${health.data.db}`)}
          {#if health.data.dbVersion}
            <span class="muted">({t('health.db_version', { version: health.data.dbVersion })})</span
            >
          {/if}
        </li>
      {/if}
      <li class="muted">{t('common.version', { version: boot.version })}</li>
    </ul>

    {#if health.error}
      <p class="error" role="alert">
        {errorMessage(health.error, t)}
        {#if health.error.requestId}
          <br /><span class="muted"
            >{t('pages.error.request_id', { id: health.error.requestId })}</span
          >
        {/if}
      </p>
    {/if}

    <button
      type="button"
      class="button"
      onclick={() => health.run()}
      disabled={health.status === 'loading'}
    >
      {t('common.retry')}
    </button>
  </div>

  <div class="card">
    <ThemeControls />
  </div>
</section>

<style>
  .home {
    display: grid;
    gap: var(--space-5);
    max-width: 48rem;
  }
  header h1 {
    margin: 0;
  }
  .subtitle {
    margin: var(--space-2) 0 0;
    color: var(--color-text-muted);
  }
  .card {
    padding: var(--space-5);
    background: var(--color-surface);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
  }
  .card h2 {
    margin: 0 0 var(--space-4);
    font-size: var(--font-size-lg);
  }
  .status-list {
    display: grid;
    gap: var(--space-2);
    margin: 0 0 var(--space-4);
    padding: 0;
    list-style: none;
  }
  .dot {
    display: inline-block;
    width: 0.625rem;
    height: 0.625rem;
    margin-right: var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--color-border-strong);
  }
  .dot-ok {
    background: var(--color-success);
  }
  .dot-error {
    background: var(--color-danger);
  }
  .muted {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
  .error {
    color: var(--color-danger);
  }
</style>
