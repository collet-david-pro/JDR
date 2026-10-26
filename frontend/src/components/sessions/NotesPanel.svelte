<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { PanelProps } from '../../lib/sessions/console/panel-props';
  import { toasts } from '../../stores/toasts.svelte';

  /** Console panel "Notes": a text shown to the players to read aloud (`note.show`). */
  let { send }: PanelProps = $props();
  const uid = $props.id();
  const TITLE_MAX = 120;
  const BODY_MAX = 4000;
  let title = $state('');
  let body = $state('');
  let busy = $state(false);
  const valid = $derived(title.trim() !== '' || body.trim() !== '');

  async function show(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!valid) return;
    busy = true;
    const ok = await send([{ type: 'note.show', title: title.trim(), body: body.trim() }]);
    busy = false;
    if (ok) {
      toasts.success(t('sessions.notes.sent'));
      title = '';
      body = '';
    }
  }
</script>

<form class="panel" onsubmit={show} aria-labelledby={`${uid}-title`} data-testid="notes-panel">
  <h2 id={`${uid}-title`}>{t('sessions.notes.title')}</h2>
  <label class="field">
    <span>{t('sessions.notes.note_title')}</span>
    <input type="text" bind:value={title} maxlength={TITLE_MAX} autocomplete="off" />
  </label>
  <label class="field">
    <span>{t('sessions.notes.body')}</span>
    <textarea bind:value={body} maxlength={BODY_MAX} rows="8"></textarea>
  </label>
  <button type="submit" class="button button-primary" disabled={!valid || busy}
    >{t('sessions.notes.show')}</button
  >
</form>

<style>
  .panel {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--font-size-sm);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  input,
  textarea {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
  }
</style>
