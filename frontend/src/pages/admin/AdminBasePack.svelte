<script lang="ts">
  import ConfirmDialog from '../../components/ConfirmDialog.svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import { runBasePack, type BasePackReport } from '../../lib/admin-base-pack';
  import { describeError, type ErrorSummary } from '../../lib/errors';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';

  const { api } = services();

  let confirmOpen = $state(false);
  let running = $state(false);
  let progress = $state({ done: 0, total: 0 });
  let report = $state.raw<BasePackReport | null>(null);
  let failure = $state.raw<ErrorSummary | null>(null);

  async function install(): Promise<void> {
    running = true;
    failure = null;
    report = null;
    progress = { done: 0, total: 0 };
    try {
      report = await runBasePack(
        async (resume) =>
          (await api.post<BasePackReport>('/admin/base-pack/install', resume ? { resume } : {}))
            .data,
        (done, total) => (progress = { done, total }),
      );
    } catch (error: unknown) {
      failure = describeError(error, t);
    } finally {
      running = false;
      confirmOpen = false;
    }
  }
</script>

<section class="card stack" aria-labelledby="basepack-title">
  <h2 id="basepack-title">{t('admin.basepack.title')}</h2>
  <p class="muted">{t('admin.basepack.intro')}</p>
  <div class="row">
    <button
      type="button"
      class="button button-primary"
      data-testid="basepack-install"
      disabled={running}
      onclick={() => (confirmOpen = true)}
    >
      {t('admin.basepack.button')}
    </button>
  </div>
  <p class="small muted" role="status" aria-live="polite" data-testid="basepack-status">
    {#if running}
      {t('admin.basepack.running', { done: progress.done, total: progress.total })}
    {:else if report !== null}
      {#if report.busy}
        {t('admin.basepack.busy')}
      {:else}
        {t('admin.basepack.report', {
          installed: report.installed,
          present: report.present,
          failed: report.failed.length,
        })}
      {/if}
    {/if}
  </p>
  {#if report !== null && report.failed.length > 0}
    <h3>{t('admin.basepack.failed_title')}</h3>
    <ul class="small">
      {#each report.failed as item (item.key)}
        <li>
          {t('admin.basepack.failed_item', { name: item.name, key: item.key, reason: item.reason })}
        </li>
      {/each}
    </ul>
  {/if}
  <ErrorAlert {failure} />
</section>

<ConfirmDialog
  bind:open={confirmOpen}
  title={t('admin.basepack.confirm_title')}
  message={t('admin.basepack.confirm_message')}
  confirmLabel={t('admin.basepack.confirm_button')}
  busy={running}
  onconfirm={() => void install()}
/>
