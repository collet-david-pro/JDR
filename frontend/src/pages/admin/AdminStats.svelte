<script lang="ts">
  import { onMount } from 'svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import { describeError, type ErrorSummary } from '../../lib/errors';
  import { formatBytes } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import type { AdminStats } from '../../lib/types';

  const { api } = services();
  let stats = $state.raw<AdminStats | null>(null);
  let failure = $state.raw<ErrorSummary | null>(null);

  onMount(() => {
    api
      .get<AdminStats>('/admin/stats')
      .then(({ data }) => {
        stats = data;
      })
      .catch((error: unknown) => {
        failure = describeError(error, t);
      });
  });

  const number = new Intl.NumberFormat('fr');
  const cards = $derived(
    stats === null
      ? []
      : [
          { label: t('admin.stats.users'), value: number.format(stats.users.total) },
          { label: t('admin.stats.active'), value: number.format(stats.users.active) },
          { label: t('admin.stats.suspended'), value: number.format(stats.users.suspended) },
          { label: t('admin.stats.admins'), value: number.format(stats.users.admins) },
          { label: t('admin.stats.games'), value: number.format(stats.games) },
          { label: t('admin.stats.maps'), value: number.format(stats.maps) },
          { label: t('admin.stats.storage'), value: formatBytes(stats.storage_bytes) },
          { label: t('admin.stats.sessions'), value: number.format(stats.active_sessions) },
        ],
  );
</script>

<ErrorAlert {failure} />
{#if stats === null && failure === null}
  <p class="muted" aria-busy="true">{t('common.loading')}</p>
{:else}
  <dl class="stats">
    {#each cards as card (card.label)}
      <div class="card">
        <dt class="muted small">{card.label}</dt>
        <dd>{card.value}</dd>
      </div>
    {/each}
  </dl>
{/if}

<style>
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: var(--space-3);
    margin: 0;
  }
  dd {
    margin: var(--space-1) 0 0;
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-bold);
  }
</style>
