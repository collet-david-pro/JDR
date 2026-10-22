<script lang="ts">
  import Button from '../Button.svelte';
  import Modal from '../Modal.svelte';
  import TextField from '../TextField.svelte';
  import { VERSION_LABEL_MAX } from '../../editor/versions/versions.svelte';
  import { t } from '../../lib/i18n';

  /** Named snapshot (Cmd/Ctrl+Shift+S, projet.md 15.3): label typed by the user (optional). */
  interface Props {
    open: boolean;
    busy: boolean;
    onsubmit: (label: string) => void;
  }

  let { open = $bindable(), busy, onsubmit }: Props = $props();
  let label = $state('');

  $effect(() => {
    if (open) label = '';
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    onsubmit(label);
  }
</script>

<Modal bind:open title={t('editor.versions.snapshot_title')}>
  <form class="stack" onsubmit={submit} data-testid="snapshot-form">
    <TextField
      label={t('editor.versions.label')}
      name="label"
      bind:value={label}
      maxlength={VERSION_LABEL_MAX}
      hint={t('editor.versions.label_hint')}
      autofocus
    />
    <div class="row actions">
      <button type="button" class="button" onclick={() => (open = false)}>
        {t('common.cancel')}
      </button>
      <Button type="submit" variant="primary" loading={busy} data-testid="snapshot-submit">
        {t('editor.versions.snapshot_submit')}
      </Button>
    </div>
  </form>
</Modal>

<style>
  .actions {
    justify-content: flex-end;
  }
</style>
