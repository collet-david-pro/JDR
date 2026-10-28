<script lang="ts">
  import { onMount } from 'svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import Button from '../../components/Button.svelte';
  import UpdateNotes from '../../components/admin/UpdateNotes.svelte';
  import UpdateSummary from '../../components/admin/UpdateSummary.svelte';
  import {
    RELEASES_URL,
    UpdateModel,
    isNewerRelease,
    isResumable,
    resumeUrl,
    type UpdateChannel,
  } from '../../lib/admin-update.svelte';
  import { formatBytes, formatDateTime } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';

  const model = new UpdateModel(services().api, t);
  const uid = $props.id();

  onMount(() => {
    void model.load();
  });

  const info = $derived(model.info);
  const check = $derived(model.check);
  const newer = $derived(isNewerRelease(check));
  const run = $derived(model.run);
  const uploading = $derived(model.phase !== 'idle');

  function onFile(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file !== undefined) void model.send(file);
    input.value = '';
  }

  function onChannel(event: Event): void {
    void model.setChannel((event.currentTarget as HTMLSelectElement).value as UpdateChannel);
  }
</script>

<section class="card stack" aria-labelledby="update-title">
  <h2 id="update-title">{t('admin.update.title')}</h2>
  <ErrorAlert failure={model.failure} />

  {#if info === null && model.failure === null}
    <p class="muted" aria-busy="true">{t('common.loading')}</p>
  {:else if info !== null}
    <dl class="facts">
      <dt>{t('admin.update.installed')}</dt>
      <dd data-testid="update-current">{info.current}</dd>
      <dt>{t('admin.update.db_version')}</dt>
      <dd>{info.db_version ?? '—'} / {info.required_db_version ?? '—'}</dd>
    </dl>

    {#if isResumable(run)}
      <div class="alert alert-warning" role="status">
        <p>{t('admin.update.run.title', { from: run.from, to: run.to })}</p>
        <p>{t(`admin.update.run.state_${run.state}`)}</p>
        <p>
          <a class="button button-primary" href={resumeUrl(info, run)}
            >{t('admin.update.run.resume')}</a
          >
        </p>
      </div>
    {/if}

    <div class="field">
      <label for="{uid}-channel">{t('admin.update.channel')}</label>
      <select id="{uid}-channel" value={info.channel} onchange={onChannel}>
        <option value="stable">{t('admin.update.channel_stable')}</option>
        <option value="prerelease">{t('admin.update.channel_prerelease')}</option>
      </select>
    </div>

    <h3>{t('admin.update.check.title')}</h3>
    <div>
      <Button loading={model.checking} onclick={() => model.runCheck()}>
        {t('admin.update.check.button')}
      </Button>
    </div>
    <div aria-live="polite">
      {#if model.retryAfter !== null}
        <p class="alert alert-warning">
          {t('admin.update.check.rate_limited', { seconds: model.retryAfter })}
        </p>
      {:else if check !== null}
        {#if check.error === 'unreachable' || check.error === 'invalid_response'}
          <p class="alert alert-warning">
            {t(`admin.update.check.error_${check.error}`)}
            <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer"
              >{t('admin.update.check.releases_link')}</a
            >
          </p>
        {:else if newer && check.latest !== null}
          <div class="alert alert-success stack">
            <p>
              <strong>{t('admin.update.check.available', { version: check.latest.version })}</strong
              >
              {#if check.latest.published_at}
                <span class="muted">
                  — {t('admin.update.check.published', {
                    date: formatDateTime(check.latest.published_at),
                  })}</span
                >
              {/if}
            </p>
            {#if check.latest.notes}
              <UpdateNotes notes={check.latest.notes} />
            {/if}
            <p class="links">
              {#if check.latest.update_asset !== null}
                <a href={check.latest.update_asset.url} target="_blank" rel="noopener noreferrer"
                  >{t('admin.update.check.download')}</a
                >
                <span class="muted">({formatBytes(check.latest.update_asset.size)})</span>
              {/if}
              {#if check.latest.html_url}
                <a href={check.latest.html_url} target="_blank" rel="noopener noreferrer"
                  >{t('admin.update.check.release_page')}</a
                >
              {/if}
            </p>
          </div>
        {:else}
          <p class="alert alert-success">{t('admin.update.check.up_to_date')}</p>
        {/if}
        <p class="small muted">
          {t('admin.update.check.checked_at', { date: formatDateTime(check.checked_at) })}
        </p>
      {/if}
    </div>

    <h3>{t('admin.update.upload.title')}</h3>
    {#if model.pending === null}
      <div class="field">
        <label for="{uid}-file">{t('admin.update.upload.label')}</label>
        <input
          id="{uid}-file"
          type="file"
          accept=".zip,application/zip"
          disabled={uploading}
          onchange={onFile}
          aria-describedby="{uid}-limits"
        />
        <p id="{uid}-limits" class="small muted">
          {t('admin.update.upload.limits', {
            max: formatBytes(info.upload_max_bytes),
            upload: info.php.upload_max_filesize,
            post: info.php.post_max_size,
          })}
        </p>
      </div>
      <div aria-live="polite">
        {#if model.phase === 'hashing'}
          <p>{t('admin.update.upload.hashing')}</p>
        {:else if model.phase === 'uploading' || model.phase === 'completing'}
          <p>
            {model.phase === 'completing'
              ? t('admin.update.upload.checking')
              : t('admin.update.upload.progress', { percent: model.percent })}
          </p>
          <progress max="100" value={model.percent} aria-label={t('admin.update.upload.title')}
          ></progress>
        {/if}
      </div>
      <ErrorAlert failure={model.uploadFailure} />
    {:else}
      <UpdateSummary {model} summary={model.pending} />
    {/if}
  {/if}
  {#if info === null || model.pending === null}
    <ErrorAlert failure={model.actionFailure} />
  {/if}
</section>

<style>
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
  }
  dd {
    margin: 0;
  }
  h2,
  h3 {
    margin: 0;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: 0;
  }
  progress {
    width: 100%;
  }
</style>
