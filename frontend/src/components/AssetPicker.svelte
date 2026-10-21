<script lang="ts">
  import Button from './Button.svelte';
  import Modal from './Modal.svelte';
  import SelectField from './SelectField.svelte';
  import TextField from './TextField.svelte';
  import AssetGrid from './library/AssetGrid.svelte';
  import { assetsClient } from '../lib/assets/service';
  import { CursorList } from '../lib/cursor-list.svelte';
  import { describeError } from '../lib/errors';
  import { t } from '../lib/i18n';
  import type { Asset, AssetKind, AssetListScope } from '../lib/types';

  /**
   * Asset selection dialog (editor, tokens): grid filtered by kind, personal or general
   * library, search. Calls `onpick` with the chosen asset and closes.
   */
  interface Props {
    open: boolean;
    /** Only assets of this kind (all kinds when omitted). */
    kind?: AssetKind;
    title?: string;
    onpick: (asset: Asset) => void;
  }

  let { open = $bindable(), kind, title, onpick }: Props = $props();

  let q = $state('');
  let scope = $state<string>('mine');
  const client = assetsClient();
  const list = new CursorList<Asset>((cursor) =>
    client.list(
      {
        scope: (scope === 'general' ? 'general' : 'mine') satisfies AssetListScope,
        kind: kind ?? '',
        q,
      },
      cursor,
    ),
  );
  const failure = $derived(list.error === null ? null : describeError(list.error, t));
  const scopeOptions = [
    { value: 'mine', label: t('library.scope.mine') },
    { value: 'general', label: t('library.scope.general') },
  ];

  let debounce: ReturnType<typeof setTimeout> | undefined;
  function search(): void {
    clearTimeout(debounce);
    debounce = setTimeout(() => void list.reload(), 300);
  }

  // Load when the dialog opens.
  $effect(() => {
    if (open) void list.reload();
    return () => clearTimeout(debounce);
  });

  function pick(asset: Asset): void {
    onpick(asset);
    open = false;
  }
</script>

<Modal bind:open title={title ?? t('asset_picker.title')}>
  <div class="picker">
    <div class="row filters">
      <TextField label={t('common.search')} type="search" bind:value={q} oninput={search} />
      <SelectField
        label={t('library.filters.scope')}
        bind:value={scope}
        options={scopeOptions}
        onchange={() => list.reload()}
      />
    </div>
    <p class="small muted">{t('asset_picker.hint')}</p>
    {#if list.items.length > 0}
      <div class="results">
        <AssetGrid items={list.items} label={t('asset_picker.results')} onactivate={pick} />
      </div>
    {:else if list.loaded && !list.loading}
      <p class="muted">{t('library.empty')}</p>
    {:else if !failure}
      <p class="muted">{t('common.loading')}</p>
    {/if}
    {#if failure}
      <p class="alert alert-error" role="alert">{failure.message}</p>
    {/if}
    {#if list.hasMore}
      <Button loading={list.loading} onclick={() => list.more()}>{t('common.load_more')}</Button>
    {/if}
  </div>
</Modal>

<style>
  .picker {
    display: grid;
    gap: var(--space-3);
  }
  .filters {
    align-items: flex-end;
  }
  .filters > :global(.field) {
    flex: 1 1 10rem;
  }
  .results {
    max-height: 60vh;
    overflow-y: auto;
    padding: var(--space-1);
  }
  p {
    margin: 0;
  }
</style>
