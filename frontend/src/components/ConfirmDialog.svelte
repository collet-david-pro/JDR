<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n';
  import Button from './Button.svelte';
  import Modal from './Modal.svelte';

  interface Props {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    busy?: boolean;
    /** Disables the confirm button (e.g. password not typed yet). */
    confirmDisabled?: boolean;
    /** `data-testid` of the confirm button. */
    confirmTestId?: string;
    /** Extra content (a password field, an error...). */
    children?: Snippet;
    onconfirm: () => void;
  }

  let {
    open = $bindable(),
    title,
    message,
    confirmLabel,
    danger = false,
    busy = false,
    confirmDisabled = false,
    confirmTestId,
    children,
    onconfirm,
  }: Props = $props();

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    onconfirm();
  }
</script>

<Modal bind:open {title}>
  <form class="stack" onsubmit={submit}>
    <p class="message">{message}</p>
    {@render children?.()}
    <div class="row actions">
      <!-- Safe default: the cancel button gets the initial focus. -->
      <!-- svelte-ignore a11y_autofocus -->
      <button type="button" class="button" autofocus onclick={() => (open = false)}>
        {t('common.cancel')}
      </button>
      <Button
        type="submit"
        variant={danger ? 'danger' : 'primary'}
        loading={busy}
        disabled={confirmDisabled}
        data-testid={confirmTestId}
      >
        {confirmLabel}
      </Button>
    </div>
  </form>
</Modal>

<style>
  .message {
    margin: 0;
  }
  .actions {
    justify-content: flex-end;
  }
</style>
