<script lang="ts">
  import type { UpdateModel, UpdateSummary } from '../../lib/admin-update.svelte';
  import { formatBytes } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import Button from '../Button.svelte';
  import CheckboxField from '../CheckboxField.svelte';
  import ErrorAlert from '../ErrorAlert.svelte';

  let { model, summary }: { model: UpdateModel; summary: UpdateSummary } = $props();

  let confirmed = $state(false);
  let heading: HTMLElement | undefined = $state();
  const verified = $derived(summary.authenticity === 'verified');
  const lists = $derived([
    { key: 'added', paths: summary.changes.added, count: summary.files.added },
    { key: 'changed', paths: summary.changes.changed, count: summary.files.changed },
    { key: 'removed', paths: summary.changes.removed, count: summary.files.removed },
  ] as const);

  $effect(() => {
    void summary.id;
    heading?.focus();
  });
</script>

<section class="card stack" aria-labelledby="update-summary-title">
  <h3 id="update-summary-title" tabindex="-1" bind:this={heading}>
    {t('admin.update.summary.title')}
  </h3>
  <p>
    {t('admin.update.summary.versions', { from: summary.current, to: summary.version })}
    <span class="muted">({formatBytes(summary.size)})</span>
  </p>

  {#if verified}
    <p class="alert alert-success">{t('admin.update.summary.verified')}</p>
  {:else}
    <div class="alert alert-warning">
      <p>{t('admin.update.summary.unverified')}</p>
    </div>
  {/if}

  {#each summary.warnings.filter((w) => w.code !== 'unverified') as warning (warning.code)}
    <p class="alert alert-warning">{warning.message}</p>
  {/each}

  <ul class="counts">
    {#each lists as list (list.key)}
      <li>
        <details>
          <summary>{t(`admin.update.summary.files_${list.key}`, { count: list.count })}</summary>
          {#if list.paths.length > 0}
            <ul class="paths">
              {#each list.paths as path (path)}
                <li><code>{path}</code></li>
              {/each}
            </ul>
            {#if list.count > list.paths.length}
              <p class="small muted">
                {t('admin.update.summary.truncated', { shown: list.paths.length })}
              </p>
            {/if}
          {/if}
        </details>
      </li>
    {/each}
  </ul>

  <div>
    <h4>{t('admin.update.summary.migrations')}</h4>
    {#if summary.migrations.length === 0}
      <p class="muted">{t('admin.update.summary.no_migrations')}</p>
    {:else}
      <ul class="paths">
        {#each summary.migrations as migration (migration)}
          <li><code>{migration}</code></li>
        {/each}
      </ul>
    {/if}
  </div>

  <p class="muted">{t('admin.update.summary.maintenance')}</p>

  {#if !verified}
    <CheckboxField label={t('admin.update.summary.confirm_unverified')} bind:checked={confirmed} />
  {/if}

  <ErrorAlert failure={model.actionFailure} />

  <div class="row">
    <Button
      variant="primary"
      loading={model.busy}
      disabled={!verified && !confirmed}
      onclick={() => model.install(!verified && confirmed)}
    >
      {t('admin.update.summary.install')}
    </Button>
    <Button disabled={model.busy} onclick={() => model.discard()}>
      {t('admin.update.summary.discard')}
    </Button>
  </div>
</section>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .counts,
  .paths {
    margin: 0;
    padding-left: var(--space-4);
  }
  .paths {
    max-height: 12rem;
    overflow: auto;
    overflow-wrap: anywhere;
  }
  h3,
  h4 {
    margin: 0;
  }
</style>
