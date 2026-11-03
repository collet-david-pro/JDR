<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../../components/Button.svelte';
  import CheckboxField from '../../components/CheckboxField.svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import { BackupModel } from '../../lib/admin-backup.svelte';
  import {
    BACKUP_KINDS,
    CONFIRM_WORD,
    acceptFor,
    maxBytes,
    type BackupKind,
  } from '../../lib/admin-backup';
  import { formatBytes } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import { href, services } from '../../lib/services';

  const model = new BackupModel(services().api, t);
  const uid = $props.id();

  onMount(() => {
    void model.load();
  });

  const info = $derived(model.info);
  const previous = $derived(info?.restore ?? null);

  function onFile(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    model.file = input.files?.[0] ?? null;
  }

  function onKind(kind: BackupKind): void {
    model.setKind(kind);
  }
</script>

<section class="card stack" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{t('admin.backup.title')}</h2>
  <p class="muted">{t('admin.backup.intro')}</p>
  <ErrorAlert failure={model.loadFailure} />

  {#if info === null}
    {#if model.loadFailure === null}
      <p class="muted" aria-busy="true">{t('common.loading')}</p>
    {/if}
  {:else}
    {#if previous !== null && previous.status !== 'done' && model.restorePhase === 'idle'}
      <p class="alert alert-warning" role="status">
        {previous.status === 'running'
          ? t('admin.backup.restore.previous_running')
          : t('admin.backup.restore.previous_failed')}
      </p>
    {/if}

    <h3>{t('admin.backup.create.title')}</h3>
    <p class="small muted">{t('admin.backup.create.hint')}</p>
    <div class="actions">
      {#each BACKUP_KINDS as kind (kind)}
        <Button
          variant="primary"
          loading={model.backupKind === kind}
          disabled={model.backupKind !== null || model.restoreBusy}
          onclick={() => void model.backup(kind)}
        >
          {t(`admin.backup.create.${kind}`)}
        </Button>
      {/each}
      {#if model.backupKind !== null}
        <Button onclick={() => void model.cancelBackup()}>{t('admin.backup.create.cancel')}</Button>
      {/if}
    </div>
    <div aria-live="polite">
      {#if model.backupKind !== null}
        <p>{t('admin.backup.create.progress', { percent: model.backupPercent })}</p>
        <progress max="100" value={model.backupPercent} aria-label={t('admin.backup.create.title')}
        ></progress>
      {:else if model.backupDone !== null}
        <p class="alert alert-success">
          {t('admin.backup.create.done', { name: model.backupDone })}
        </p>
      {/if}
    </div>
    <ErrorAlert failure={model.backupFailure} />

    <h3>{t('admin.backup.restore.title')}</h3>
    <p class="alert alert-warning">{t('admin.backup.restore.warning')}</p>
    <fieldset class="stack" disabled={model.restoreBusy}>
      <legend>{t('admin.backup.restore.kind')}</legend>
      {#each BACKUP_KINDS as kind (kind)}
        <label class="choice">
          <input
            type="radio"
            name="{uid}-kind"
            value={kind}
            checked={model.restoreKind === kind}
            onchange={() => onKind(kind)}
          />
          {t(`admin.backup.restore.kind_${kind}`)}
        </label>
      {/each}
    </fieldset>

    <div class="stack">
      <p>{t('admin.backup.restore.first')}</p>
      <div>
        <Button
          disabled={model.backupKind !== null || model.restoreBusy}
          onclick={() => void model.backup(model.restoreKind)}
        >
          {t(`admin.backup.restore.backup_first_${model.restoreKind}`)}
        </Button>
      </div>
    </div>

    <div class="field">
      <label for="{uid}-file">{t(`admin.backup.restore.file_${model.restoreKind}`)}</label>
      {#key model.restoreKind}
        <input
          id="{uid}-file"
          type="file"
          accept={acceptFor(model.restoreKind)}
          disabled={model.restoreBusy}
          onchange={onFile}
          aria-describedby="{uid}-limit"
        />
      {/key}
      <p id="{uid}-limit" class="small muted">
        {t('admin.backup.restore.limit', {
          max: formatBytes(maxBytes(model.restoreKind, info.limits)),
        })}
      </p>
    </div>

    <CheckboxField
      label={t('admin.backup.restore.understand')}
      bind:checked={model.understood}
      disabled={model.restoreBusy}
    />
    <div class="field">
      <label for="{uid}-word">{t('admin.backup.restore.word', { word: CONFIRM_WORD })}</label>
      <input
        id="{uid}-word"
        type="text"
        autocomplete="off"
        spellcheck="false"
        bind:value={model.word}
        disabled={model.restoreBusy}
      />
    </div>
    <div>
      <Button
        variant="danger"
        disabled={!model.canRestore}
        loading={model.restoreBusy}
        onclick={() => void model.restore()}
      >
        {t('admin.backup.restore.submit')}
      </Button>
    </div>

    <div aria-live="polite">
      {#if model.restorePhase === 'uploading' || model.restorePhase === 'restoring'}
        <p>
          {t(`admin.backup.restore.${model.restorePhase}`, { percent: model.restorePercent })}
        </p>
        <progress
          max="100"
          value={model.restorePercent}
          aria-label={t('admin.backup.restore.title')}
        ></progress>
      {:else if model.restoreOutcome?.kind === 'db'}
        <div class="alert alert-success stack" role="status">
          {#if model.restoreOutcome.schemaBehind}
            <p>{t('admin.backup.restore.done_db_behind')}</p>
            <p>
              <a class="button button-primary" href={info.update_url}
                >{t('admin.backup.restore.open_update')}</a
              >
            </p>
          {:else}
            <p>{t('admin.backup.restore.done_db')}</p>
            <p>
              <a class="button button-primary" href={href('/login')}
                >{t('admin.backup.restore.login')}</a
              >
            </p>
          {/if}
        </div>
      {:else if model.restoreOutcome?.kind === 'assets'}
        <div class="alert alert-success stack" role="status">
          <p>
            {t('admin.backup.restore.done_assets', {
              restored: model.restoreOutcome.restored,
              skipped: model.restoreOutcome.skipped,
              rejected: model.restoreOutcome.rejected,
            })}
          </p>
          {#if model.restoreOutcome.rejected_files.length > 0}
            <ul class="small">
              {#each model.restoreOutcome.rejected_files as name (name)}
                <li><code>{name}</code></li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>
    <ErrorAlert failure={model.restoreFailure} />
  {/if}
</section>

<style>
  h2,
  h3 {
    margin: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  progress {
    width: 100%;
  }
</style>
