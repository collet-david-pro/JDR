<script lang="ts">
  import { untrack } from 'svelte';
  import AssetPicker from '../AssetPicker.svelte';
  import Modal from '../Modal.svelte';
  import { ApiError } from '../../lib/api';
  import { t } from '../../lib/i18n';
  import { sessionsClient } from '../../lib/services';
  import { sessionProblem } from '../../lib/sessions/labels';
  import type { SessionRun } from '../../lib/sessions/session-run.svelte';
  import { toasts } from '../../stores/toasts.svelte';

  /** Edition of the pause screen shown on the projection screens (text + image). */
  interface Props {
    open: boolean;
    run: SessionRun;
  }

  /** Server limit (SessionInput::PAUSE_TEXT_MAX). */
  const TEXT_MAX = 2000;

  let { open = $bindable(), run }: Props = $props();
  const session = $derived(run.state?.session ?? null);
  let text = $state('');
  let assetId = $state<string | null>(null);
  let previewUrl = $state<string | null>(null);
  let pickerOpen = $state(false);
  let busy = $state(false);
  let imageError = $state(false);

  // Each opening starts from the saved pause screen.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      const pause = session?.pause_screen ?? null;
      text = pause?.text ?? '';
      assetId = pause?.asset_id ?? null;
      previewUrl = pause?.url ?? null;
      imageError = false;
    });
  });

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (session === null) return;
    const value = text.trim();
    busy = true;
    imageError = false;
    try {
      await sessionsClient().update(session.id, {
        pause_screen:
          value === '' && assetId === null
            ? null
            : { asset_id: assetId, text: value === '' ? null : value },
      });
      await run.reload();
      toasts.success(t('sessions.pause_screen.saved'));
      open = false;
    } catch (error) {
      if (error instanceof ApiError && error.fields['pause_screen.asset_id'] !== undefined) {
        imageError = true;
      } else {
        toasts.show('error', sessionProblem(error));
      }
    } finally {
      busy = false;
    }
  }
</script>

<Modal bind:open title={t('sessions.pause_screen.title')}>
  <form class="stack" onsubmit={save} data-testid="pause-screen-dialog">
    <label class="field">
      <span>{t('sessions.pause_screen.text')}</span>
      <textarea rows="4" maxlength={TEXT_MAX} bind:value={text} data-testid="pause-screen-text"
      ></textarea>
    </label>
    <div class="image">
      {#if previewUrl !== null && assetId !== null}
        <img src={previewUrl} alt="" class="preview" data-testid="pause-screen-preview" />
      {:else}
        <p class="small muted">{t('sessions.pause_screen.no_image')}</p>
      {/if}
      <div class="row">
        <button
          type="button"
          class="button button-small"
          data-testid="pause-screen-pick"
          onclick={() => (pickerOpen = true)}>{t('sessions.pause_screen.pick')}</button
        >
        {#if assetId !== null}
          <button
            type="button"
            class="button button-small"
            data-testid="pause-screen-remove-image"
            onclick={() => {
              assetId = null;
              previewUrl = null;
            }}>{t('sessions.pause_screen.remove_image')}</button
          >
        {/if}
      </div>
      {#if imageError}
        <p class="small alert alert-error" role="alert" data-testid="pause-screen-image-error">
          {t('sessions.pause_screen.image_invalid')}
        </p>
      {/if}
    </div>
    <div class="row actions">
      <button type="button" class="button" onclick={() => (open = false)}
        >{t('common.cancel')}</button
      >
      <button
        type="submit"
        class="button button-primary"
        disabled={busy}
        data-testid="pause-screen-save">{t('common.save')}</button
      >
    </div>
  </form>
</Modal>

<AssetPicker
  bind:open={pickerOpen}
  title={t('sessions.pause_screen.pick')}
  onpick={(asset) => {
    assetId = asset.id;
    previewUrl = asset.urls.thumb;
    imageError = false;
  }}
/>

<style>
  .field {
    display: grid;
    gap: var(--space-1);
  }
  textarea {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    font: inherit;
  }
  .preview {
    max-width: 100%;
    max-height: 12rem;
    border-radius: var(--radius-md);
  }
  .image {
    display: grid;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .actions {
    justify-content: flex-end;
  }
  p {
    margin: 0;
  }
</style>
