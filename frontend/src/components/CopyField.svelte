<script lang="ts">
  import { copyText } from '../lib/clipboard';
  import { t } from '../lib/i18n';
  import { toasts } from '../stores/toasts.svelte';

  interface Props {
    label: string;
    value: string;
  }

  let { label, value }: Props = $props();
  const uid = $props.id();

  async function copy(): Promise<void> {
    if (await copyText(value)) toasts.success(t('common.copied'));
    else toasts.info(t('common.copy_failed'));
  }
</script>

<div class="copy-field">
  <label for={`${uid}-value`}>{label}</label>
  <div class="row line">
    <input
      id={`${uid}-value`}
      type="text"
      readonly
      {value}
      onfocus={(e) => e.currentTarget.select()}
    />
    <button type="button" class="button" onclick={copy}>{t('common.copy')}</button>
  </div>
</div>

<style>
  .copy-field {
    display: grid;
    gap: var(--space-1);
  }
  label {
    font-weight: var(--font-weight-medium);
  }
  .line {
    flex-wrap: nowrap;
  }
  input {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-sunken);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }
</style>
