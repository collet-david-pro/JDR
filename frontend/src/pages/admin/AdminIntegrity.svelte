<script lang="ts">
  import ConfirmDialog from '../../components/ConfirmDialog.svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import AdminBasePack from './AdminBasePack.svelte';
  import {
    buildFixBody,
    groupIssues,
    isDestructive,
    issueParams,
    needsConfirmation,
    runCheck,
    withoutFixed,
    type CheckSlice,
    type FixResult,
    type IntegrityIssue,
  } from '../../lib/admin-integrity';
  import { describeError, type ErrorSummary } from '../../lib/errors';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';

  const { api } = services();

  let issues = $state.raw<readonly IntegrityIssue[] | null>(null);
  let running = $state(false);
  let progress = $state({ done: 0, total: 0 });
  let controller: AbortController | null = null;
  let failure = $state.raw<ErrorSummary | null>(null);
  let message = $state('');
  let fixing = $state(false);

  let confirmOpen = $state(false);
  let pending = $state.raw<readonly IntegrityIssue[]>([]);

  const groups = $derived(groupIssues(issues ?? []));
  const percent = $derived(
    progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100),
  );

  async function start(): Promise<void> {
    const current = new AbortController();
    controller = current;
    running = true;
    failure = null;
    message = '';
    progress = { done: 0, total: 0 };
    try {
      issues = await runCheck(
        async (cursor) =>
          (
            await api.post<CheckSlice>(
              '/admin/integrity/check',
              cursor === null ? {} : { cursor },
              { signal: current.signal },
            )
          ).data,
        { signal: current.signal, onProgress: (done, total) => (progress = { done, total }) },
      );
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        message = t('admin.integrity.cancelled');
      } else {
        failure = describeError(error, t);
      }
    } finally {
      running = false;
      controller = null;
    }
  }

  function cancel(): void {
    controller?.abort();
  }

  /** Asks for the confirmation first when a correction deletes something. */
  function request(list: readonly IntegrityIssue[]): void {
    if (list.length === 0) return;
    if (needsConfirmation(list)) {
      pending = list;
      confirmOpen = true;
      return;
    }
    void apply(list, false);
  }

  async function apply(list: readonly IntegrityIssue[], confirmed: boolean): Promise<void> {
    fixing = true;
    failure = null;
    message = '';
    try {
      const { data } = await api.post<FixResult>(
        '/admin/integrity/fix',
        buildFixBody(list, confirmed),
      );
      issues = withoutFixed(issues ?? [], data);
      message = t('admin.integrity.fixed', { n: data.fixed.length });
    } catch (error: unknown) {
      failure = describeError(error, t);
    } finally {
      fixing = false;
      confirmOpen = false;
    }
  }
</script>

<div class="stack">
  <AdminBasePack />
  <section class="card stack" aria-labelledby="integrity-title">
    <h2 id="integrity-title">{t('admin.integrity.title')}</h2>
    <p class="muted">{t('admin.integrity.intro')}</p>
    <div class="row">
      <button
        type="button"
        class="button button-primary"
        disabled={running || fixing}
        onclick={start}
      >
        {t('admin.integrity.run')}
      </button>
      {#if running}
        <button type="button" class="button" onclick={cancel}>{t('common.cancel')}</button>
      {/if}
    </div>
    {#if running}
      <progress max="100" value={percent} aria-label={t('admin.integrity.running')}></progress>
    {/if}
    <p class="small muted" role="status" aria-live="polite">
      {#if running}
        {t('admin.integrity.progress', { done: progress.done, total: progress.total })}
      {:else}
        {message}
      {/if}
    </p>
    <ErrorAlert {failure} />
  </section>

  {#if issues !== null && !running}
    {#if groups.length === 0}
      <p class="card" data-testid="integrity-none">{t('admin.integrity.none')}</p>
    {/if}
    {#each groups as group (group.kind)}
      <section class="card stack" aria-labelledby={`integrity-${group.kind}`}>
        <div class="row head">
          <h3 id={`integrity-${group.kind}`}>
            {t(`admin.integrity.group.${group.kind}`)}
            <span class="badge">{group.issues.length}</span>
          </h3>
          {#if group.safe.length > 1}
            <button
              type="button"
              class="button button-small"
              disabled={fixing}
              onclick={() => request(group.safe)}
            >
              {t('admin.integrity.fix_all', { n: group.safe.length })}
            </button>
          {/if}
        </div>
        <ul class="list">
          {#each group.issues as issue (issue.id)}
            <li class="row item">
              <span class={['badge', issue.severity === 'error' ? 'badge-error' : '']}>
                {t(`admin.integrity.severity.${issue.severity}`)}
              </span>
              <span class="grow">{t(`admin.integrity.desc.${issue.kind}`, issueParams(issue))}</span
              >
              {#if issue.fix !== null}
                <button
                  type="button"
                  class={['button button-small', isDestructive(issue) && 'button-danger']}
                  disabled={fixing}
                  onclick={() => request([issue])}
                >
                  {t(`admin.integrity.action.${issue.fix.action}`)}
                </button>
              {:else}
                <span class="small muted">{t('admin.integrity.no_fix')}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  title={t('admin.integrity.confirm_title')}
  message={t('admin.integrity.confirm_message', { n: pending.length })}
  confirmLabel={t('admin.integrity.confirm_button')}
  danger
  busy={fixing}
  onconfirm={() => void apply(pending, true)}
/>

<style>
  .head {
    justify-content: space-between;
    align-items: center;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }
  .item {
    align-items: center;
    gap: var(--space-3);
  }
  .grow {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  progress {
    width: 100%;
  }
</style>
