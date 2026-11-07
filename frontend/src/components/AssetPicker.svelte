<script lang="ts">
  import Button from './Button.svelte';
  import Modal from './Modal.svelte';
  import SelectField from './SelectField.svelte';
  import TextField from './TextField.svelte';
  import AssetGrid from './library/AssetGrid.svelte';
  import { assetsClient } from '../lib/assets/service';
  import { CursorList } from '../lib/cursor-list.svelte';
  import { kindLabel } from '../lib/assets/labels';
  import { describeError } from '../lib/errors';
  import { t } from '../lib/i18n';
  import type { Asset, AssetCategory, AssetKind, AssetListScope, AssetTag } from '../lib/types';

  /**
   * Asset selection dialog (editor, tokens): grid filtered by kind, personal or general
   * library, search. Calls `onpick` with the chosen asset and closes.
   */
  interface Props {
    open: boolean;
    /** Only assets of this kind (all kinds when omitted). */
    kind?: AssetKind;
    title?: string;
    /** P14: kinds offered in a kind filter (the first one, or `kind`, selected first). */
    kinds?: readonly AssetKind[];
    /** P14: category and tag filters. */
    taxonomy?: boolean;
    onpick: (asset: Asset) => void;
  }

  let { open = $bindable(), kind, title, kinds, taxonomy = false, onpick }: Props = $props();

  let q = $state('');
  let scope = $state<string>('mine');
  // svelte-ignore state_referenced_locally
  let kindFilter = $state<string>(kind ?? kinds?.[0] ?? '');
  let category = $state('');
  let tag = $state('');
  let categories = $state<AssetCategory[]>([]);
  let tags = $state<AssetTag[]>([]);
  const client = assetsClient();
  const list = new CursorList<Asset>((cursor) =>
    client.list(
      {
        scope: (scope === 'general' ? 'general' : 'mine') satisfies AssetListScope,
        kind: (kinds !== undefined ? kindFilter : (kind ?? '')) as AssetKind | '',
        q,
        ...(category !== '' ? { category } : {}),
        ...(tag !== '' ? { tag } : {}),
      },
      cursor,
    ),
  );
  const kindOptions = $derived(
    (kinds ?? []).map((k) => ({ value: k as string, label: kindLabel(k) })),
  );
  const categoryOptions = $derived([
    { value: '', label: t('library.filters.all_categories') },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ]);
  const tagOptions = $derived([
    { value: '', label: t('library.filters.all_tags') },
    ...tags.map((x) => ({ value: x.id, label: x.name })),
  ]);
  $effect(() => {
    if (!open || !taxonomy) return;
    void client.categories().then(
      (c) => (categories = c),
      () => undefined,
    );
    void client.tags().then(
      (x) => (tags = x),
      () => undefined,
    );
  });
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
      {#if kinds !== undefined}
        <SelectField
          label={t('library.fields.kind')}
          bind:value={kindFilter}
          options={kindOptions}
          onchange={() => list.reload()}
        />
      {/if}
      {#if taxonomy}
        <SelectField
          label={t('library.fields.category')}
          bind:value={category}
          options={categoryOptions}
          onchange={() => list.reload()}
        />
        <SelectField
          label={t('library.fields.tag')}
          bind:value={tag}
          options={tagOptions}
          onchange={() => list.reload()}
        />
      {/if}
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
