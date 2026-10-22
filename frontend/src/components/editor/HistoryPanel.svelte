<script lang="ts">
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import { versionKindLabel } from '../../editor/versions/labels';
  import { PendingOpsError, type VersionsModel } from '../../editor/versions/versions.svelte';
  import { describeError } from '../../lib/errors';
  import { formatBytes, formatDateTime } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import type { MapVersion } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * History panel (projet.md 2.5, 11.4 "Versions", 18.1 p.5): snapshots of the map (kind,
   * label, author, date, size), manual snapshot, restoration after confirmation.
   */
  interface Props {
    model: VersionsModel;
    /** False until the map is loaded and saved on the server. */
    ready: boolean;
    onsnapshot: () => void;
    onclose: () => void;
  }

  let { model, ready, onsnapshot, onclose }: Props = $props();
  const uid = $props.id();
  const failure = $derived(model.error === null ? null : describeError(model.error, t));

  let confirmOpen = $state(false);
  let target = $state.raw<MapVersion | null>(null);

  $effect(() => {
    void model.load();
  });

  function askRestore(version: MapVersion): void {
    target = version;
    confirmOpen = true;
  }

  async function restore(): Promise<void> {
    const version = target;
    if (version === null) return;
    try {
      await model.restore(version);
      confirmOpen = false;
    } catch (error) {
      confirmOpen = false;
      if (error instanceof PendingOpsError) toasts.show('error', t('editor.versions.pending_ops'));
      else toasts.error(error);
    }
  }

  function title(version: MapVersion): string {
    return version.label ?? versionKindLabel(version.kind);
  }
</script>

<section class="history" aria-labelledby={`${uid}-title`} data-testid="history-panel">
  <div class="head">
    <h2 id={`${uid}-title`}>{t('editor.versions.title')}</h2>
    <div class="row">
      <button
        type="button"
        class="button button-small"
        aria-haspopup="dialog"
        disabled={!ready || model.busy !== null}
        data-testid="history-snapshot"
        onclick={onsnapshot}>{t('editor.versions.snapshot')}</button
      >
      <button
        type="button"
        class="button button-small button-ghost"
        aria-label={t('editor.versions.close')}
        title={t('editor.versions.close')}
        onclick={onclose}><span aria-hidden="true">×</span></button
      >
    </div>
  </div>

  {#if model.status === 'error'}
    <div class="alert alert-error" role="alert">
      <span>{failure?.message}</span>
      <button type="button" class="button button-small" onclick={() => model.load()}>
        {t('common.retry')}
      </button>
    </div>
  {:else if model.status !== 'ready'}
    <p class="small muted" aria-busy="true">{t('common.loading')}</p>
  {:else if model.versions.length === 0}
    <p class="small muted" data-testid="history-empty">{t('editor.versions.empty')}</p>
  {:else}
    <ol class="list" data-testid="history-list">
      {#each model.versions as version (version.id)}
        <li
          class="version"
          data-testid="history-version"
          data-kind={version.kind}
          data-version-id={version.id}
        >
          <div class="line">
            <strong class="name" title={title(version)}>{title(version)}</strong>
            <span class="badge small" data-kind={version.kind}
              >{versionKindLabel(version.kind)}</span
            >
          </div>
          <p class="small muted">
            {formatDateTime(version.created_at)}
            {#if version.created_by}· {version.created_by.username}{/if}
            · {formatBytes(version.size_bytes)}
          </p>
          <button
            type="button"
            class="button button-small"
            disabled={!ready || model.busy !== null}
            aria-label={t('editor.versions.restore_label', { name: title(version) })}
            data-testid="history-restore"
            onclick={() => askRestore(version)}>{t('editor.versions.restore')}</button
          >
        </li>
      {/each}
    </ol>
  {/if}
</section>

<ConfirmDialog
  bind:open={confirmOpen}
  title={t('editor.versions.restore_title')}
  message={target === null
    ? ''
    : t('editor.versions.restore_message', {
        name: title(target),
        date: formatDateTime(target.created_at),
      })}
  confirmLabel={t('editor.versions.restore_confirm')}
  busy={model.busy === 'restore'}
  onconfirm={restore}
/>

<style>
  .history {
    padding: var(--space-3);
    border-bottom: var(--border-width) solid var(--color-border);
  }
  .head,
  .line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
  }
  .head {
    margin-bottom: var(--space-2);
  }
  .row {
    display: flex;
    gap: var(--space-1);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  p {
    margin: 0;
  }
  .list {
    display: grid;
    gap: var(--space-2);
    max-height: 22rem;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  .version {
    display: grid;
    gap: var(--space-1);
    justify-items: start;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface-sunken);
  }
  .line {
    width: 100%;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-sm);
  }
  .badge {
    flex: none;
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--color-border);
  }
  .badge[data-kind='manual'] {
    background: var(--color-primary-soft);
  }
</style>
