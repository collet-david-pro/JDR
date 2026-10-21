<script lang="ts">
  import CheckboxField from '../CheckboxField.svelte';
  import { ApiError } from '../../lib/api';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import { usagesFromError } from '../../lib/assets/assets-client';
  import type { LibraryModel } from '../../lib/assets/library.svelte';
  import { t } from '../../lib/i18n';
  import type { Asset, AssetUsages } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';

  interface Props {
    model: LibraryModel;
    asset: Asset;
    onclose: () => void;
  }

  let { model, asset, onclose }: Props = $props();

  let open = $state(true);
  let busy = $state(false);
  let usages = $state.raw<AssetUsages | null>(null);
  let force = $state(false);

  $effect(() => {
    if (!open) onclose();
  });

  async function confirm(): Promise<void> {
    busy = true;
    try {
      await model.client.remove(asset.id, usages !== null && force);
      model.removeLocal(asset.id);
      void model.refreshStorage().catch(() => undefined);
      toasts.success(t('library.delete.done', { name: asset.name }));
      open = false;
    } catch (error) {
      const found = usagesFromError(error);
      if (found !== null) {
        usages = found;
      } else if (error instanceof ApiError && error.code === 'asset_in_use') {
        usages = await model.client.usages(asset.id).catch(() => ({ maps: [], tokens: [] }));
      } else {
        toasts.error(error);
      }
    } finally {
      busy = false;
    }
  }
</script>

<ConfirmDialog
  bind:open
  title={t('library.delete.title')}
  message={usages === null
    ? t('library.delete.confirm', { name: asset.name })
    : t('library.delete.in_use', { name: asset.name })}
  confirmLabel={usages === null ? t('common.delete') : t('library.delete.force_confirm')}
  danger
  {busy}
  confirmDisabled={usages !== null && !force}
  onconfirm={confirm}
>
  {#if usages}
    <ul class="small" aria-label={t('library.detail.show_usages')}>
      {#each usages.maps as map (map.id)}
        <li>{t('library.usages.map', { name: map.name ?? t('library.usages.other_owner') })}</li>
      {/each}
      {#each usages.tokens as token (token.id)}
        <li>
          {t('library.usages.token', { name: token.name ?? t('library.usages.other_owner') })}
        </li>
      {/each}
    </ul>
    <CheckboxField
      label={t('library.delete.force')}
      hint={t('library.delete.force_hint')}
      bind:checked={force}
    />
  {/if}
</ConfirmDialog>

<style>
  ul {
    margin: 0;
    padding-left: var(--space-5);
  }
</style>
