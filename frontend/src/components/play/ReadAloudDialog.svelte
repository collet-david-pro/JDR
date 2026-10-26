<script lang="ts">
  import Modal from '../Modal.svelte';
  import { t } from '../../lib/i18n';
  import type { ReadAloud } from '../../lib/sessions/session-run.svelte';

  /** Text read aloud by the GM (note.read_aloud): a new text replaces the previous one. */
  interface Props {
    note: ReadAloud | null;
  }
  let { note }: Props = $props();

  let open = $state(false);
  let shown = $state.raw<ReadAloud | null>(null);

  $effect(() => {
    if (note !== null && note.eventId !== shown?.eventId) {
      shown = note;
      open = true;
    }
  });
</script>

{#if shown !== null}
  <Modal bind:open title={shown.title === '' ? t('play.read_aloud.title') : shown.title}>
    <div class="read" data-testid="play-readaloud">
      <p class="body">{shown.body}</p>
      <p class="actions">
        <button type="button" class="button" onclick={() => (open = false)}
          >{t('common.close')}</button
        >
      </p>
    </div>
  </Modal>
{/if}

<style>
  .body {
    white-space: pre-line;
    margin: 0 0 var(--space-4);
  }
  .actions {
    margin: 0;
    text-align: end;
  }
</style>
