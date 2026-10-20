<script lang="ts">
  import { onMount } from 'svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import { describeError, type ErrorSummary } from '../../lib/errors';
  import { formatDateTime } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import type { MigrationRow } from '../../lib/types';

  const { api } = services();
  let rows = $state.raw<readonly MigrationRow[] | null>(null);
  let failure = $state.raw<ErrorSummary | null>(null);

  onMount(() => {
    api
      .get<MigrationRow[]>('/admin/migrations')
      .then(({ data }) => {
        rows = data;
      })
      .catch((error: unknown) => {
        failure = describeError(error, t);
      });
  });
</script>

<section class="card stack" aria-labelledby="migrations-title">
  <h2 id="migrations-title">{t('admin.migrations.title')}</h2>
  <ErrorAlert {failure} />
  {#if rows === null && failure === null}
    <p class="muted" aria-busy="true">{t('common.loading')}</p>
  {:else if rows !== null}
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th scope="col">{t('admin.migrations.version')}</th>
            <th scope="col">{t('admin.migrations.name')}</th>
            <th scope="col">{t('admin.migrations.status')}</th>
            <th scope="col">{t('admin.migrations.applied_at')}</th>
            <th scope="col">{t('admin.migrations.duration')}</th>
            <th scope="col">{t('admin.migrations.checksum')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.version)}
            <tr>
              <td>{row.version}</td>
              <td>{row.name}</td>
              <td><span class="badge">{row.status}</span></td>
              <td>{formatDateTime(row.applied_at)}</td>
              <td
                >{row.duration_ms === null
                  ? ''
                  : t('admin.migrations.ms', { ms: row.duration_ms })}</td
              >
              <td>
                <span class={['badge', row.checksum_ok ? 'badge-ok' : 'badge-error']}>
                  {row.checksum_ok
                    ? t('admin.migrations.checksum_ok')
                    : t('admin.migrations.checksum_bad')}
                </span>
              </td>
            </tr>
          {:else}
            <tr><td colspan="6" class="muted">{t('admin.migrations.empty')}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
