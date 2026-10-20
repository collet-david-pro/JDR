<script lang="ts">
  import CopyField from '../../components/CopyField.svelte';
  import Modal from '../../components/Modal.svelte';
  import { formatDateTime } from '../../lib/format';
  import { t } from '../../lib/i18n';

  interface Props {
    title: string;
    url: string;
    expiresAt: string | null;
    onclose: () => void;
  }

  let { title, url, expiresAt, onclose }: Props = $props();
  let open = $state(true);
</script>

<Modal bind:open {title} {onclose}>
  <div class="stack">
    <p class="alert alert-warning">{t('admin.links.once')}</p>
    <CopyField label={t('admin.links.url')} value={url} />
    {#if expiresAt}
      <p class="small muted">{t('admin.links.expires', { date: formatDateTime(expiresAt) })}</p>
    {/if}
    <div class="row end">
      <button type="button" class="button button-primary" onclick={() => (open = false)}>
        {t('common.close')}
      </button>
    </div>
  </div>
</Modal>

<style>
  p {
    margin: 0;
  }
  .end {
    justify-content: flex-end;
  }
</style>
