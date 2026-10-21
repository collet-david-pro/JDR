<script lang="ts">
  import { onDestroy } from 'svelte';
  import SelectField from '../SelectField.svelte';
  import { kindLabel, statusLabel } from '../../lib/assets/labels';
  import type { LibraryModel } from '../../lib/assets/library.svelte';
  import { prepareFile } from '../../lib/assets/reduce';
  import { assetNameFromFile } from '../../lib/assets/reduce-plan';
  import { failureText } from '../../lib/assets/upload-errors';
  import { UploadQueue, type UploadItem } from '../../lib/assets/upload-queue.svelte';
  import { formatBytes } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import { ASSET_KINDS, type AssetKind } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';

  interface Props {
    model: LibraryModel;
  }

  let { model }: Props = $props();

  let kind = $state<string>('object');
  let categoryId = $state('');
  let dragging = $state(false);
  let announcement = $state('');
  let input: HTMLInputElement | undefined = $state();
  const uid = $props.id();

  const kindOptions = ASSET_KINDS.map((value) => ({ value, label: kindLabel(value) }));
  const categoryOptions = $derived([
    { value: '', label: t('library.no_category') },
    ...model.categories
      .filter((category) => category.scope === model.ownScope)
      .map((category) => ({ value: category.id, label: category.name })),
  ]);
  const accept = $derived(
    (model.limits?.accepted_mimes ?? ['image/png', 'image/jpeg', 'image/webp', 'image/gif']).join(
      ',',
    ),
  );

  const queue = new UploadQueue({
    prepare: async (file, signal, onReduce) => {
      if (model.limits === null) await model.loadLimits();
      const limits = model.limits;
      if (limits === null) throw new Error('limits unavailable');
      return prepareFile(file, limits, { signal, onReduce });
    },
    send: (prepared, clientOpId, onProgress, signal) =>
      model.client.upload(
        prepared.blob,
        prepared.fileName,
        {
          kind: (ASSET_KINDS as readonly string[]).includes(kind) ? (kind as AssetKind) : 'object',
          name: assetNameFromFile(prepared.fileName),
          category_id: categoryId === '' ? null : categoryId,
          ...(model.admin ? { scope: 'general' as const } : {}),
          client_op_id: clientOpId,
        },
        { onProgress, signal },
      ),
    limits: () => model.limits,
    onDone: (item, result) => {
      if (result.duplicate) {
        toasts.info(t('library.upload.duplicate', { name: item.name }));
      }
      model.upsert(result.asset);
      void model.refreshStorage().catch(() => undefined);
    },
    onStatus: (item) => {
      if (item.status === 'uploading' || item.status === 'preparing') return;
      announcement = describe(item);
    },
  });

  onDestroy(() => queue.cancelAll());

  function describe(item: UploadItem): string {
    const status = statusLabel(item.status);
    const detail = item.failure ? ` : ${failureText(item.failure, t)}` : '';
    return `${item.name} — ${status}${detail}`;
  }

  function addFiles(list: FileList | null | undefined): void {
    if (!list || list.length === 0) return;
    queue.add([...list]);
    announcement = t('library.upload.added', { count: list.length });
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    dragging = false;
    addFiles(event.dataTransfer?.files);
  }

  function onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dragging = true;
  }

  function onPick(event: Event): void {
    const target = event.currentTarget as HTMLInputElement;
    addFiles(target.files);
    target.value = '';
  }
</script>

<section class="card upload" aria-labelledby={`${uid}-title`}>
  <h2 id={`${uid}-title`}>{t('library.upload.title')}</h2>
  <div class="row options">
    <SelectField label={t('library.fields.kind')} bind:value={kind} options={kindOptions} />
    <SelectField
      label={t('library.fields.category')}
      bind:value={categoryId}
      options={categoryOptions}
    />
  </div>

  <div
    class="dropzone"
    class:dragging
    role="group"
    aria-labelledby={`${uid}-drop`}
    ondragover={onDragOver}
    ondragleave={() => (dragging = false)}
    ondrop={onDrop}
  >
    <p id={`${uid}-drop`}>{t('library.upload.drop')}</p>
    <button type="button" class="button button-primary" onclick={() => input?.click()}>
      {t('library.upload.choose')}
    </button>
    <input
      bind:this={input}
      class="visually-hidden"
      type="file"
      multiple
      {accept}
      tabindex="-1"
      aria-hidden="true"
      onchange={onPick}
    />
    {#if model.limits}
      <p class="small muted">
        {t('library.upload.limits', {
          max: formatBytes(model.limits.max_upload_bytes),
          dimension: model.limits.max_dimension_px,
        })}
      </p>
    {/if}
  </div>

  <div class="visually-hidden" aria-live="polite" role="status">{announcement}</div>

  {#if queue.items.length > 0}
    <ul class="queue" aria-label={t('library.upload.queue')}>
      {#each queue.items as item (item.id)}
        <li class="item item-{item.status}">
          <div class="line">
            <span class="file">{item.name}</span>
            <span class="small muted">{formatBytes(item.size)}</span>
            <span class="status small">
              {statusLabel(item.status)}{#if item.reduced}
                · {t('library.upload.reduced')}{/if}{#if item.duplicate}
                · {t('library.upload.already')}{/if}
            </span>
            {#if item.status === 'error' || item.status === 'cancelled'}
              <button
                type="button"
                class="button button-small"
                onclick={() => queue.retry(item.id)}
                aria-label={t('library.upload.retry_file', { name: item.name })}
                >{t('common.retry')}</button
              >
            {:else if item.status !== 'done'}
              <button
                type="button"
                class="button button-small button-ghost"
                onclick={() => queue.cancel(item.id)}
                aria-label={t('library.upload.cancel_file', { name: item.name })}
                >{t('common.cancel')}</button
              >
            {/if}
          </div>
          {#if item.status === 'uploading'}
            <progress
              max="100"
              value={Math.round(item.progress * 100)}
              aria-label={t('library.upload.progress', { name: item.name })}
            ></progress>
          {/if}
          {#if item.failure}
            <p class="error small">{failureText(item.failure, t)}</p>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="row">
      {#if queue.busy}
        <button type="button" class="button button-small" onclick={() => queue.cancelAll()}>
          {t('library.upload.cancel_all')}
        </button>
      {/if}
      {#if queue.hasFinished}
        <button type="button" class="button button-small" onclick={() => queue.clearFinished()}>
          {t('library.upload.clear')}
        </button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .upload {
    display: grid;
    gap: var(--space-3);
  }
  .options > :global(*) {
    flex: 1 1 12rem;
  }
  .dropzone {
    display: grid;
    justify-items: center;
    gap: var(--space-2);
    padding: var(--space-5) var(--space-4);
    border: 2px dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-surface-sunken);
    text-align: center;
  }
  .dropzone.dragging {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
  }
  .dropzone p {
    margin: 0;
  }
  .queue {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .item {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--color-border);
    border-left-width: 4px;
    border-radius: var(--radius-md);
  }
  .item-done {
    border-left-color: var(--color-success);
  }
  .item-error {
    border-left-color: var(--color-danger);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .file {
    flex: 1 1 10rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  progress {
    width: 100%;
    accent-color: var(--color-primary);
  }
  .error {
    margin: 0;
    color: var(--color-danger);
  }
</style>
