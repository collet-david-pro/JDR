<script lang="ts">
  import Button from '../Button.svelte';
  import Modal from '../Modal.svelte';
  import ExportFields from './ExportFields.svelte';
  import { defaultForm, evaluateForm, type ExportForm } from '../../export/form';
  import { downloadTarget, pickFileTarget, type OutputTarget } from '../../export/output';
  import type { ExportHandle } from '../../export/run-export';
  import type { SnapshotPaletteEntry } from '../../export/scene';
  import type { ExportSource } from '../../export/types';
  import { t } from '../../lib/i18n';

  /**
   * PNG export (projet.md 17, 2.8): options with the final size live, then rendering in a
   * worker with progress and cancellation. The export code is loaded on demand.
   */
  interface Props {
    open: boolean;
    source: ExportSource;
    onclose: () => void;
  }

  let { open = $bindable(), source, onclose }: Props = $props();

  type Phase = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

  // svelte-ignore state_referenced_locally
  let form = $state<ExportForm>(defaultForm(source));
  let phase = $state<Phase>('idle');
  let progress = $state({ done: 0, total: 0 });
  let failed = $state<readonly SnapshotPaletteEntry[]>([]);
  let resultKind = $state<'file' | 'download'>('download');
  /** Where the last export ran (worker, or main thread fallback). */
  let where = $state<'worker' | 'main' | ''>('');
  let errorText = $state('');
  let handle: ExportHandle | null = null;
  let wasOpen = false;

  // Fresh options at each opening.
  $effect(() => {
    if (open && !wasOpen) {
      form = defaultForm(source);
      phase = 'idle';
      progress = { done: 0, total: 0 };
    }
    wasOpen = open;
  });

  const evaluation = $derived(evaluateForm(form, source));
  const running = $derived(phase === 'running');
  const percent = $derived(
    progress.total > 0 ? Math.floor((progress.done / progress.total) * 100) : 0,
  );

  async function exportNow(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const ev = evaluation;
    if (ev.options === null || running) return;
    let target: OutputTarget | null;
    try {
      // First await of the click handler: the picker needs the user activation.
      target = await pickFileTarget(ev.fileName, ev.mime, t('export_png.file_type'));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      target = null;
    }
    target ??= downloadTarget(ev.fileName, ev.mime);
    resultKind = target.kind;
    phase = 'running';
    progress = { done: 0, total: 0 };
    failed = [];
    errorText = '';
    try {
      const { startExport } = await import('../../export/run-export');
      handle = startExport({
        view: source.view,
        layers: ev.layers,
        options: ev.options,
        target,
        onProgress: (p) => (progress = { done: p.done, total: p.total }),
      });
      const outcome = await handle.done;
      failed = outcome.failed;
      where = outcome.where;
      phase = 'done';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        phase = 'cancelled';
      } else {
        phase = 'error';
        errorText = error instanceof Error ? error.message : String(error);
        await target.abort().catch(() => undefined);
      }
    } finally {
      handle = null;
    }
  }

  function cancel(): void {
    handle?.cancel();
  }

  function handleClose(): void {
    cancel();
    onclose();
  }
</script>

<Modal bind:open title={t('export_png.title')} onclose={handleClose}>
  <form class="stack" novalidate onsubmit={exportNow} data-testid="export-png-form">
    <fieldset class="fields" disabled={running}>
      <ExportFields bind:form {source} {evaluation} />
    </fieldset>

    {#if evaluation.missing.length > 0}
      <div class="alert alert-warning" role="status" data-testid="export-missing">
        {t('export_png.missing', { count: evaluation.missing.length })}
        <span class="names">{evaluation.missing.map((m) => m.name).join(', ')}</span>
      </div>
    {/if}

    <div
      class="progress"
      data-testid="export-progress"
      data-state={phase}
      data-done={progress.done}
      data-total={progress.total}
      data-where={where}
    >
      {#if phase === 'running'}
        <progress
          max={Math.max(1, progress.total)}
          value={progress.done}
          aria-label={t('export_png.progress_label')}
        ></progress>
      {/if}
      <p aria-live="polite" class="status">
        {#if phase === 'running'}
          {progress.total > 0
            ? t('export_png.progress', { done: progress.done, total: progress.total, percent })
            : t('export_png.preparing')}
        {:else if phase === 'done'}
          {resultKind === 'file' ? t('export_png.done_file') : t('export_png.done_download')}
        {:else if phase === 'cancelled'}
          {t('export_png.cancelled')}
        {:else if phase === 'error'}
          <span class="error">{t('export_png.failed', { error: errorText })}</span>
        {/if}
      </p>
      {#if phase === 'done' && failed.length > 0}
        <p class="alert alert-warning" data-testid="export-failed">
          {t('export_png.failed_images', { count: failed.length })}
          {failed.map((f) => f.name).join(', ')}
        </p>
      {/if}
    </div>

    <div class="actions">
      {#if running}
        <Button onclick={cancel} data-testid="export-cancel">{t('export_png.cancel')}</Button>
      {:else}
        <Button onclick={() => (open = false)}>{t('common.close')}</Button>
        <Button
          type="submit"
          variant="primary"
          disabled={evaluation.options === null}
          data-testid="export-start"
        >
          {t('export_png.start')}
        </Button>
      {/if}
    </div>
  </form>
</Modal>

<style>
  .fields {
    display: grid;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .names {
    display: block;
    font-size: var(--font-size-sm);
    overflow-wrap: anywhere;
  }
  .progress {
    display: grid;
    gap: var(--space-2);
  }
  progress {
    width: 100%;
  }
  .status {
    margin: 0;
    min-height: 1.5em;
  }
  .error {
    color: var(--color-danger);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
