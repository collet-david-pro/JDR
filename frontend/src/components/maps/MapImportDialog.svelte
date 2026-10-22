<script lang="ts">
  import Button from '../Button.svelte';
  import Modal from '../Modal.svelte';
  import { formatBytes } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import { importErrorText, importFailure, issueText } from '../../lib/maps/import-labels';
  import type { MapImportModel } from '../../lib/maps/map-import.svelte';
  import type { MapDetail, MapImportResult } from '../../lib/types';

  /**
   * Map import (Maps tab, P4c): JSON document or ZIP with images; preview checked in the
   * browser, upload progress, report of the assets the server could not resolve.
   */
  interface Props {
    open: boolean;
    model: MapImportModel;
    onimported: (result: MapImportResult) => void;
    onopenmap: (map: MapDetail) => void;
  }

  let { open = $bindable(), model, onimported, onopenmap }: Props = $props();
  const uid = $props.id();
  const MAX_ISSUES_SHOWN = 10;
  const failure = $derived(model.error === null ? null : importFailure(model.error, t));

  function picked(event: Event & { currentTarget: HTMLInputElement }): void {
    const file = event.currentTarget.files?.[0];
    if (file !== undefined) void model.choose(file, file.name);
  }

  async function upload(): Promise<void> {
    const result = await model.upload();
    if (result !== null) onimported(result);
  }

  function closed(): void {
    model.reset();
  }
</script>

<Modal bind:open title={t('games.maps.import.title')} onclose={closed}>
  <div class="stack" data-testid="map-import-dialog" data-step={model.step}>
    {#if model.step !== 'uploading' && model.step !== 'done'}
      <div class="field">
        <label for={`${uid}-file`}>{t('games.maps.import.file')}</label>
        <input
          id={`${uid}-file`}
          type="file"
          accept=".json,.zip,application/json,application/zip"
          data-testid="map-import-file"
          onchange={picked}
        />
        <p class="small muted">{t('games.maps.import.file_hint')}</p>
      </div>
    {/if}

    {#if model.step === 'reading'}
      <p class="muted" aria-busy="true">{t('games.maps.import.reading')}</p>
    {:else if model.step === 'invalid' && model.fileError !== null}
      <div class="alert alert-error" role="alert" data-testid="map-import-invalid">
        <div class="stack">
          <span>{importErrorText(model.fileError.code, model.fileError.version)}</span>
          {#if model.fileError.issues.length > 0}
            <ul class="small issues">
              {#each model.fileError.issues.slice(0, MAX_ISSUES_SHOWN) as issue, i (i)}
                <li>{issueText(issue)}</li>
              {/each}
            </ul>
            {#if model.fileError.issues.length > MAX_ISSUES_SHOWN}
              <span class="small">
                {t('games.maps.import.more_issues', {
                  count: model.fileError.issues.length - MAX_ISSUES_SHOWN,
                })}
              </span>
            {/if}
          {/if}
        </div>
      </div>
    {/if}

    {#if model.preview !== null && model.step !== 'done'}
      {@const p = model.preview}
      <dl class="preview" data-testid="map-import-preview">
        <dt>{t('games.maps.import.preview.name')}</dt>
        <dd data-testid="map-import-name">{p.name}</dd>
        <dt>{t('games.maps.import.preview.size')}</dt>
        <dd>{t('games.maps.card.size', { width: p.width, height: p.height })}</dd>
        <dt>{t('games.maps.import.preview.file')}</dt>
        <dd>
          {p.container === 'zip'
            ? t('games.maps.import.preview.zip', { size: formatBytes(p.fileSize) })
            : t('games.maps.import.preview.json', { size: formatBytes(p.fileSize) })}
        </dd>
        <dt>{t('games.maps.import.preview.assets')}</dt>
        <dd data-testid="map-import-assets">
          {t('games.maps.import.preview.assets_count', { count: p.assets })}
          {#if p.container === 'zip'}
            · {t('games.maps.import.preview.bundled', { count: p.bundledAssets })}
          {/if}
        </dd>
        <dt>{t('games.maps.import.preview.content')}</dt>
        <dd>{t('games.maps.import.preview.cells', { count: p.cells })}</dd>
        {#if p.formatVersion !== 1}
          <dt>{t('games.maps.import.preview.format')}</dt>
          <dd>{t('games.maps.import.preview.migrated', { version: p.formatVersion })}</dd>
        {/if}
      </dl>
    {/if}

    {#if failure !== null && model.step === 'preview'}
      <div class="alert alert-error" role="alert" data-testid="map-import-error">
        <div class="stack">
          <span>{failure.message}</span>
          {#if failure.issues.length > 0}
            <ul class="small issues">
              {#each failure.issues.slice(0, MAX_ISSUES_SHOWN) as issue, i (i)}
                <li>{issue}</li>
              {/each}
            </ul>
            {#if failure.issues.length > MAX_ISSUES_SHOWN}
              <span class="small">
                {t('games.maps.import.more_issues', {
                  count: failure.issues.length - MAX_ISSUES_SHOWN,
                })}
              </span>
            {/if}
          {/if}
          {#if failure.requestId}
            <span class="small muted">{t('pages.error.request_id', { id: failure.requestId })}</span
            >
          {/if}
        </div>
      </div>
    {/if}

    {#if model.step === 'uploading'}
      <div class="stack">
        <label for={`${uid}-progress`}>{t('games.maps.import.uploading')}</label>
        <progress
          id={`${uid}-progress`}
          max="1"
          value={model.progress ?? undefined}
          data-testid="map-import-progress"
        ></progress>
      </div>
    {/if}

    {#if model.step === 'done' && model.result !== null}
      {@const r = model.result}
      <p class="alert alert-success" role="status" data-testid="map-import-done">
        {t('games.maps.import.done', { name: r.map.name })}
      </p>
      {#if r.missing_assets.length > 0}
        <div class="alert alert-warning" data-testid="map-import-missing">
          <div class="stack">
            <span>{t('games.maps.import.missing', { count: r.missing_assets.length })}</span>
            <ul class="small issues">
              {#each r.missing_assets as asset (asset.ref)}
                <li>
                  {asset.name === '' ? t('games.maps.import.unnamed') : asset.name}
                  <code class="muted">{asset.ref.slice(0, 19)}…</code>
                </li>
              {/each}
            </ul>
          </div>
        </div>
      {/if}
    {/if}

    <div class="row actions">
      {#if model.step === 'uploading'}
        <button type="button" class="button" onclick={() => model.cancel()}>
          {t('common.cancel')}
        </button>
      {:else if model.step === 'done' && model.result !== null}
        {@const map = model.result.map}
        <button type="button" class="button" onclick={() => (open = false)}>
          {t('common.close')}
        </button>
        <Button variant="primary" data-testid="map-import-open" onclick={() => onopenmap(map)}>
          {t('games.maps.import.open')}
        </Button>
      {:else}
        <button type="button" class="button" onclick={() => (open = false)}>
          {t('common.cancel')}
        </button>
        <Button
          variant="primary"
          disabled={model.step !== 'preview'}
          data-testid="map-import-submit"
          onclick={() => void upload()}>{t('games.maps.import.submit')}</Button
        >
      {/if}
    </div>
  </div>
</Modal>

<style>
  .preview {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-1) var(--space-3);
    margin: 0;
  }
  dt {
    color: var(--color-text-muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .issues {
    margin: 0;
    padding-left: var(--space-4);
  }
  progress {
    width: 100%;
  }
  .actions {
    justify-content: flex-end;
  }
  p {
    margin: 0;
  }
</style>
