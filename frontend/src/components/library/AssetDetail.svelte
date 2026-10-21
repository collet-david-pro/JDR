<script lang="ts">
  import Button from '../Button.svelte';
  import SelectField from '../SelectField.svelte';
  import TextField from '../TextField.svelte';
  import { formatLabel, kindLabel } from '../../lib/assets/labels';
  import type { LibraryModel } from '../../lib/assets/library.svelte';
  import { formatBytes, formatDateTime } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import { ASSET_KINDS, type Asset, type AssetPatch, type AssetUsages } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';

  interface Props {
    model: LibraryModel;
    asset: Asset;
    onclose: () => void;
    ondelete: (asset: Asset) => void;
  }

  let { model, asset, onclose, ondelete }: Props = $props();
  const uid = $props.id();

  const editable = $derived(model.canEdit(asset));
  let name = $state('');
  let kind = $state('');
  let category = $state('');
  let newTag = $state('');
  let saving = $state(false);
  let usages = $state.raw<AssetUsages | null>(null);
  let usagesLoading = $state(false);
  let heading: HTMLHeadingElement | undefined = $state();

  // Reset the form and move the focus when another asset is shown.
  let shownId = '';
  $effect(() => {
    if (asset.id === shownId) return;
    shownId = asset.id;
    name = asset.name;
    kind = asset.kind;
    category = asset.category_id ?? '';
    usages = null;
    heading?.focus();
  });

  const kindOptions = ASSET_KINDS.map((value) => ({ value, label: kindLabel(value) }));
  const categoryOptions = $derived([
    { value: '', label: t('library.no_category') },
    ...model.categories
      .filter((c) => c.scope === asset.scope)
      .map((c) => ({ value: c.id, label: c.name })),
  ]);
  const tagSuggestions = $derived(
    model.tags.filter((tag) => !asset.tags.some((own) => own.name === tag.name)),
  );

  async function save(patch: AssetPatch): Promise<void> {
    saving = true;
    try {
      const updated = await model.client.update(asset.id, patch);
      model.upsert(updated);
      if (patch.tags !== undefined) void model.loadTaxonomy().catch(() => undefined);
      toasts.success(t('library.detail.saved'));
    } catch (error) {
      toasts.error(error);
    } finally {
      saving = false;
    }
  }

  function rename(event: SubmitEvent): void {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === asset.name) return;
    void save({ name: trimmed });
  }

  function addTag(event: SubmitEvent): void {
    event.preventDefault();
    const tag = newTag.trim();
    if (tag === '' || asset.tags.some((own) => own.name === tag)) return;
    newTag = '';
    void save({ tags: [...asset.tags.map((own) => own.name), tag] });
  }

  function removeTag(tagName: string): void {
    void save({ tags: asset.tags.filter((own) => own.name !== tagName).map((own) => own.name) });
  }

  async function toggleFavorite(): Promise<void> {
    const favorite = !asset.favorite;
    model.upsert({ ...asset, favorite }); // optimistic
    try {
      await model.client.setFavorite(asset.id, favorite);
    } catch (error) {
      model.upsert({ ...asset, favorite: !favorite });
      toasts.error(error);
    }
  }

  async function loadUsages(): Promise<void> {
    usagesLoading = true;
    try {
      usages = await model.client.usages(asset.id);
    } catch (error) {
      toasts.error(error);
    } finally {
      usagesLoading = false;
    }
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onclose();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="detail card" aria-labelledby={`${uid}-title`} onkeydown={keydown}>
  <header class="head">
    <h2 id={`${uid}-title`} tabindex="-1" bind:this={heading}>{asset.name}</h2>
    <button type="button" class="button button-ghost button-small" onclick={onclose}>
      <span aria-hidden="true">×</span><span class="visually-hidden">{t('common.close')}</span>
    </button>
  </header>

  <div class="preview">
    <img src={asset.urls.full} alt={asset.name} width={asset.width} height={asset.height} />
  </div>

  <dl class="facts small">
    <dt>{t('library.detail.format')}</dt>
    <dd>{formatLabel(asset.mime)}{asset.is_animated ? ` · ${t('library.animated')}` : ''}</dd>
    <dt>{t('library.detail.dimensions')}</dt>
    <dd>{t('library.detail.size_px', { width: asset.width, height: asset.height })}</dd>
    <dt>{t('library.detail.weight')}</dt>
    <dd>{formatBytes(asset.size_bytes)}</dd>
    {#if asset.is_animated}
      <dt>{t('library.detail.animation')}</dt>
      <dd>
        {t('library.detail.frames', {
          count: asset.frame_count,
          seconds: Math.round(asset.duration_ms / 100) / 10,
        })}
      </dd>
    {/if}
    <dt>{t('library.detail.scope')}</dt>
    <dd>{asset.scope === 'general' ? t('library.scope.general') : t('library.scope.mine')}</dd>
    <dt>{t('library.detail.created')}</dt>
    <dd>{formatDateTime(asset.created_at)}</dd>
  </dl>

  <Button size="small" onclick={toggleFavorite} aria-pressed={asset.favorite}>
    <span aria-hidden="true">{asset.favorite ? '★' : '☆'}</span>
    {t('library.favorite')}
  </Button>

  {#if editable}
    <form class="stack-sm" onsubmit={rename}>
      <TextField label={t('library.fields.name')} bind:value={name} maxlength={120} required />
      <Button type="submit" size="small" loading={saving}>{t('library.detail.rename')}</Button>
    </form>
    <SelectField
      label={t('library.fields.kind')}
      bind:value={kind}
      options={kindOptions}
      onchange={() => save({ kind: kind as Asset['kind'] })}
    />
    <SelectField
      label={t('library.fields.category')}
      bind:value={category}
      options={categoryOptions}
      onchange={() => save({ category_id: category === '' ? null : category })}
    />
  {:else}
    <p class="small muted">
      {t('library.fields.kind')} : {kindLabel(asset.kind)}
      {#if model.categoryName(asset.category_id)}
        · {t('library.fields.category')} : {model.categoryName(asset.category_id)}{/if}
    </p>
  {/if}

  <div class="tags">
    <h3 class="small">{t('library.fields.tags')}</h3>
    {#if asset.tags.length === 0}
      <p class="small muted">{t('library.detail.no_tags')}</p>
    {:else}
      <ul class="chips">
        {#each asset.tags as tag (tag.id)}
          <li class="badge">
            {tag.name}
            {#if editable}
              <button
                type="button"
                class="chip-remove"
                onclick={() => removeTag(tag.name)}
                aria-label={t('library.detail.remove_tag', { name: tag.name })}>×</button
              >
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if editable}
      <form class="row add-tag" onsubmit={addTag}>
        <TextField
          label={t('library.detail.add_tag')}
          bind:value={newTag}
          maxlength={50}
          list={`${uid}-tags`}
        />
        <Button type="submit" size="small" disabled={saving}>{t('common.create')}</Button>
        <datalist id={`${uid}-tags`}>
          {#each tagSuggestions as tag (tag.id)}<option value={tag.name}></option>{/each}
        </datalist>
      </form>
    {/if}
  </div>

  <div class="usages">
    <Button size="small" loading={usagesLoading} onclick={loadUsages}>
      {t('library.detail.show_usages')}
    </Button>
    {#if usages}
      {@render usageList(usages)}
    {/if}
  </div>

  {#if editable}
    <Button variant="danger" size="small" onclick={() => ondelete(asset)}>
      {t('common.delete')}
    </Button>
  {/if}
</aside>

{#snippet usageList(found: AssetUsages)}
  {#if found.maps.length === 0 && found.tokens.length === 0}
    <p class="small muted">{t('library.usages.none')}</p>
  {:else}
    <ul class="small">
      {#each found.maps as map (map.id)}
        <li>{t('library.usages.map', { name: map.name ?? t('library.usages.other_owner') })}</li>
      {/each}
      {#each found.tokens as token (token.id)}
        <li>
          {t('library.usages.token', { name: token.name ?? t('library.usages.other_owner') })}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<style>
  .detail {
    display: grid;
    gap: var(--space-3);
    align-content: start;
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-lg);
    overflow-wrap: anywhere;
  }
  h3 {
    margin: 0 0 var(--space-1);
  }
  .preview {
    display: grid;
    place-items: center;
    max-height: 22rem;
    overflow: hidden;
    border-radius: var(--radius-md);
    background: repeating-conic-gradient(
        var(--color-surface-sunken) 0% 25%,
        var(--color-surface) 0% 50%
      )
      50% / 1rem 1rem;
  }
  .preview img {
    max-width: 100%;
    max-height: 22rem;
    width: auto;
    height: auto;
    object-fit: contain;
  }
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
  }
  .facts dt {
    color: var(--color-text-muted);
  }
  .facts dd {
    margin: 0;
  }
  .stack-sm {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
  }
  .stack-sm > :global(.field) {
    width: 100%;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .chip-remove {
    margin-left: var(--space-1);
    padding: 0 var(--space-1);
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .add-tag {
    align-items: flex-end;
    margin-top: var(--space-2);
  }
  .add-tag > :global(.field) {
    flex: 1 1 8rem;
  }
  .usages ul {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-5);
  }
  .usages p {
    margin: var(--space-2) 0 0;
  }
</style>
