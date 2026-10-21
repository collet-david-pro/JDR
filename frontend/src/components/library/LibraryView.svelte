<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../Button.svelte';
  import Gauge from '../Gauge.svelte';
  import { LibraryModel } from '../../lib/assets/library.svelte';
  import { assetsClient } from '../../lib/assets/service';
  import { describeError } from '../../lib/errors';
  import { t } from '../../lib/i18n';
  import type { Asset } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';
  import AssetDetail from './AssetDetail.svelte';
  import AssetGrid from './AssetGrid.svelte';
  import DeleteAssetDialog from './DeleteAssetDialog.svelte';
  import LibraryFilters from './LibraryFilters.svelte';
  import PackDialog from './PackDialog.svelte';
  import TaxonomyDialog from './TaxonomyDialog.svelte';
  import UploadPanel from './UploadPanel.svelte';

  interface Props {
    /** Admin console tab: general library. */
    admin?: boolean;
    /** Heading level of the title (page = 1, admin tab = 2). */
    titleLevel?: 1 | 2;
  }

  let { admin = false, titleLevel = 1 }: Props = $props();

  // svelte-ignore state_referenced_locally
  const model = new LibraryModel(assetsClient(), { admin });
  let grid: ReturnType<typeof AssetGrid> | undefined = $state();
  let deleting = $state.raw<Asset | null>(null);
  let taxonomyOpen = $state(false);
  let packMode = $state<'export' | 'import'>('export');
  let packOpen = $state(false);
  let sentinel: HTMLElement | undefined = $state();

  const failure = $derived(model.list.error === null ? null : describeError(model.list.error, t));
  const title = $derived(admin ? t('library.general_title') : t('pages.library.title'));
  const selected = $derived(model.selected);

  let debounce: ReturnType<typeof setTimeout> | undefined;
  function filtersChanged(debounced: boolean): void {
    clearTimeout(debounce);
    if (debounced) debounce = setTimeout(() => void model.reload(), 300);
    else void model.reload();
  }

  onMount(() => {
    void model.reload();
    model.loadTaxonomy().catch((error: unknown) => toasts.error(error));
    model.loadLimits().catch(() => undefined);
    model.refreshStorage().catch(() => undefined);
    return () => clearTimeout(debounce);
  });

  // Infinite scrolling, in addition to the "load more" button.
  $effect(() => {
    if (sentinel === undefined || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && model.list.hasMore) {
        void model.list.more();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  function select(asset: Asset): void {
    model.selectedId = asset.id;
  }

  function closeDetail(): void {
    const id = model.selectedId;
    model.selectedId = null;
    if (id !== null) queueMicrotask(() => grid?.focusAsset(id));
  }

  function openPack(mode: 'export' | 'import'): void {
    packMode = mode;
    packOpen = true;
  }
</script>

<div class="library">
  <header class="row top">
    {#if titleLevel === 1}<h1>{title}</h1>{:else}<h2>{title}</h2>{/if}
    <div class="row">
      <button type="button" class="button" onclick={() => (taxonomyOpen = true)}>
        {t('library.taxonomy.open')}
      </button>
      <button type="button" class="button" onclick={() => openPack('import')}>
        {t('library.packs.import_title')}
      </button>
      <button type="button" class="button" onclick={() => openPack('export')}>
        {t('library.packs.export_title')}
      </button>
    </div>
  </header>

  <div class="intro">
    <UploadPanel {model} />
    {#if !admin}
      <section class="card" aria-labelledby="library-storage">
        <h2 id="library-storage">{t('dashboard.storage')}</h2>
        {#if model.storage}
          <Gauge
            label={t('storage.label')}
            used={model.storage.used_bytes}
            quota={model.storage.quota_bytes}
          />
        {:else}
          <p class="small muted">{t('common.loading')}</p>
        {/if}
      </section>
    {/if}
  </div>

  <LibraryFilters {model} onchange={filtersChanged} />

  <div class="content" class:with-detail={selected !== null}>
    <section aria-labelledby="library-results" aria-busy={model.list.loading ? 'true' : undefined}>
      <h2 id="library-results" class="visually-hidden">{t('library.results')}</h2>
      {#if model.list.items.length > 0}
        <AssetGrid
          bind:this={grid}
          items={model.list.items}
          label={t('library.results')}
          selectedId={model.selectedId}
          onactivate={select}
        />
      {:else if model.list.loaded && !model.list.loading}
        <p class="muted">{t('library.empty')}</p>
      {:else if !failure}
        <p class="muted">{t('common.loading')}</p>
      {/if}

      {#if failure}
        <p class="alert alert-error" role="alert">
          {failure.message}
          <button type="button" class="button button-small" onclick={() => model.reload()}>
            {t('common.retry')}
          </button>
        </p>
      {/if}

      {#if model.list.hasMore}
        <p class="more" bind:this={sentinel}>
          <Button loading={model.list.loading} onclick={() => model.list.more()}>
            {t('common.load_more')}
          </Button>
        </p>
      {/if}
    </section>

    {#if selected}
      <AssetDetail
        {model}
        asset={selected}
        onclose={closeDetail}
        ondelete={(asset) => (deleting = asset)}
      />
    {/if}
  </div>
</div>

{#if deleting}
  <DeleteAssetDialog {model} asset={deleting} onclose={() => (deleting = null)} />
{/if}
<TaxonomyDialog {model} bind:open={taxonomyOpen} />
{#if packOpen}
  <PackDialog {model} mode={packMode} bind:open={packOpen} />
{/if}

<style>
  .library {
    display: grid;
    gap: var(--space-5);
  }
  .top {
    justify-content: space-between;
  }
  h1,
  h2 {
    margin: 0;
  }
  .intro {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: var(--space-4);
    align-items: start;
  }
  .content {
    display: grid;
    gap: var(--space-4);
    align-items: start;
  }
  .content.with-detail {
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
  }
  .more {
    margin: var(--space-4) 0 0;
    text-align: center;
  }
  @media (max-width: 48rem) {
    .intro,
    .content.with-detail {
      grid-template-columns: minmax(0, 1fr);
    }
    /* The detail panel comes first on small screens. */
    .content.with-detail > :global(aside) {
      order: -1;
    }
  }
</style>
