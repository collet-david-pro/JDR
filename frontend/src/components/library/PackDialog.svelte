<script lang="ts">
  import { onDestroy } from 'svelte';
  import Button from '../Button.svelte';
  import Modal from '../Modal.svelte';
  import SelectField from '../SelectField.svelte';
  import { ApiError } from '../../lib/api';
  import { JobFailedError, jobErrorCode, runJob } from '../../lib/assets/jobs';
  import type { LibraryModel } from '../../lib/assets/library.svelte';
  import { errorMessage, errorMessageKey } from '../../lib/errors';
  import { t, tryT } from '../../lib/i18n';
  import type { Job } from '../../lib/types';

  interface Props {
    model: LibraryModel;
    mode: 'export' | 'import';
    open: boolean;
  }

  let { model, mode, open = $bindable() }: Props = $props();
  const uid = $props.id();

  type Phase = 'idle' | 'uploading' | 'running' | 'done' | 'failed' | 'cancelled';
  let phase = $state<Phase>('idle');
  let percent = $state(0);
  let job = $state.raw<Job | null>(null);
  let failure = $state<string | null>(null);
  let categoryId = $state('');
  let file = $state.raw<File | null>(null);
  let controller: AbortController | null = null;

  const categoryOptions = $derived([
    { value: '', label: t('library.packs.all_assets') },
    ...model.categories
      .filter((c) => c.scope === model.ownScope)
      .map((c) => ({ value: c.id, label: c.name })),
  ]);
  const busy = $derived(phase === 'uploading' || phase === 'running');
  const progressText = $derived(
    phase === 'uploading'
      ? t('library.packs.sending', { percent })
      : job !== null
        ? t('library.packs.progress', {
            done: job.progress.done,
            total: job.progress.total,
            percent: job.progress.percent,
          })
        : '',
  );

  onDestroy(() => controller?.abort());

  function reset(): void {
    phase = 'idle';
    percent = 0;
    job = null;
    failure = null;
  }

  function describeFailure(error: unknown): string {
    if (error instanceof JobFailedError) {
      const code = jobErrorCode(error.job);
      return (code !== null ? tryT(errorMessageKey(code)) : null) ?? t('library.packs.failed');
    }
    return errorMessage(error, t);
  }

  async function start(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || (mode === 'import' && file === null)) return;
    reset();
    controller = new AbortController();
    const signal = controller.signal;
    try {
      let started: Job;
      if (mode === 'import' && file !== null) {
        phase = 'uploading';
        started = await model.client.importPack(
          file,
          file.name,
          model.admin ? 'general' : undefined,
          {
            signal,
            onProgress: (loaded, total) => {
              if (total > 0) percent = Math.round((loaded / total) * 100);
            },
          },
        );
      } else {
        started = await model.client.exportPack(
          categoryId === '' ? {} : { category_id: categoryId },
        );
      }
      phase = 'running';
      job = await runJob(started, {
        step: (id, s) => model.client.stepJob(id, s),
        cancel: (id) => model.client.cancelJob(id),
        onProgress: (current) => (job = current),
        signal,
      });
      phase = 'done';
      if (mode === 'import') {
        void model.reload();
        void model.loadTaxonomy().catch(() => undefined);
        void model.refreshStorage().catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'aborted') {
        phase = 'cancelled';
      } else {
        phase = 'failed';
        failure = describeFailure(error);
      }
    } finally {
      controller = null;
    }
  }

  function cancel(): void {
    controller?.abort();
  }

  function pickFile(event: Event): void {
    file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
  }

  function summary(result: unknown): string | null {
    if (typeof result !== 'object' || result === null) return null;
    const r = result as Record<string, unknown>;
    if (typeof r['imported'] !== 'number') return null;
    return t('library.packs.import_summary', {
      imported: r['imported'],
      duplicates: typeof r['duplicates'] === 'number' ? r['duplicates'] : 0,
      failed: typeof r['failed'] === 'number' ? r['failed'] : 0,
    });
  }
</script>

<Modal
  bind:open
  title={mode === 'export' ? t('library.packs.export_title') : t('library.packs.import_title')}
  onclose={cancel}
>
  <form class="stack" onsubmit={start}>
    {#if mode === 'export'}
      <p class="small muted">{t('library.packs.export_text')}</p>
      <SelectField
        label={t('library.fields.category')}
        bind:value={categoryId}
        options={categoryOptions}
        disabled={busy}
      />
    {:else}
      <p class="small muted">{t('library.packs.import_text')}</p>
      <div class="field">
        <label for={`${uid}-file`}>{t('library.packs.file')}</label>
        <input
          id={`${uid}-file`}
          type="file"
          accept=".zip,application/zip"
          disabled={busy}
          onchange={pickFile}
        />
      </div>
    {/if}

    {#if phase !== 'idle'}
      <div class="progress">
        <progress
          max="100"
          value={phase === 'uploading' ? percent : (job?.progress.percent ?? 0)}
          aria-labelledby={`${uid}-progress`}
        ></progress>
        <p id={`${uid}-progress`} class="small" role="status" aria-live="polite">
          {#if phase === 'done'}
            {mode === 'export' ? t('library.packs.export_done') : t('library.packs.import_done')}
            {summary(job?.result) ?? ''}
          {:else if phase === 'cancelled'}
            {t('library.packs.cancelled')}
          {:else if phase === 'failed'}
            {failure}
          {:else}
            {progressText}
          {/if}
        </p>
      </div>
    {/if}

    <div class="row actions">
      {#if busy}
        <button type="button" class="button" onclick={cancel}>{t('common.cancel')}</button>
      {/if}
      {#if phase === 'done' && mode === 'export' && job}
        <a class="button button-primary" href={model.client.jobDownloadUrl(job.id)} download
          >{t('library.packs.download')}</a
        >
      {:else}
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={mode === 'import' && file === null}
        >
          {mode === 'export' ? t('library.packs.export_start') : t('library.packs.import_start')}
        </Button>
      {/if}
    </div>
  </form>
</Modal>

<style>
  .field {
    display: grid;
    gap: var(--space-1);
  }
  label {
    font-weight: var(--font-weight-medium);
  }
  .progress {
    display: grid;
    gap: var(--space-1);
  }
  progress {
    width: 100%;
    accent-color: var(--color-primary);
  }
  .progress p {
    margin: 0;
  }
  .actions {
    justify-content: flex-end;
  }
</style>
