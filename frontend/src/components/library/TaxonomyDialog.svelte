<script lang="ts">
  import Button from '../Button.svelte';
  import Modal from '../Modal.svelte';
  import SelectField from '../SelectField.svelte';
  import TextField from '../TextField.svelte';
  import type { LibraryModel } from '../../lib/assets/library.svelte';
  import { t } from '../../lib/i18n';
  import type { AssetCategory, AssetTag } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';

  interface Props {
    model: LibraryModel;
    open: boolean;
  }

  let { model, open = $bindable() }: Props = $props();

  const scope = $derived(model.ownScope);
  const categories = $derived(model.categories.filter((c) => c.scope === scope));
  const tags = $derived(model.tags.filter((tag) => tag.scope === scope));
  const parentOptions = $derived([
    { value: '', label: t('library.taxonomy.no_parent') },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ]);

  let categoryName = $state('');
  let parentId = $state('');
  let tagName = $state('');
  let busy = $state(false);
  let editingId = $state<string | null>(null);
  let editingName = $state('');

  async function run(action: () => Promise<unknown>, message: string): Promise<void> {
    busy = true;
    try {
      await action();
      await model.loadTaxonomy();
      toasts.success(message);
    } catch (error) {
      toasts.error(error);
    } finally {
      busy = false;
    }
  }

  function createCategory(event: SubmitEvent): void {
    event.preventDefault();
    const name = categoryName.trim();
    if (name === '') return;
    void run(async () => {
      await model.client.createCategory({
        name,
        parent_id: parentId === '' ? null : parentId,
        ...(scope === 'general' ? { scope } : {}),
      });
      categoryName = '';
    }, t('library.taxonomy.category_created'));
  }

  function startRename(category: AssetCategory): void {
    editingId = category.id;
    editingName = category.name;
  }

  function rename(event: SubmitEvent, category: AssetCategory): void {
    event.preventDefault();
    const name = editingName.trim();
    if (name === '' || name === category.name) {
      editingId = null;
      return;
    }
    void run(async () => {
      await model.client.updateCategory(category.id, { name });
      editingId = null;
    }, t('library.taxonomy.category_renamed'));
  }

  function removeCategory(category: AssetCategory): void {
    void run(
      () => model.client.deleteCategory(category.id),
      t('library.taxonomy.category_deleted', { name: category.name }),
    );
  }

  function createTag(event: SubmitEvent): void {
    event.preventDefault();
    const name = tagName.trim();
    if (name === '') return;
    void run(async () => {
      await model.client.createTag(name, scope);
      tagName = '';
    }, t('library.taxonomy.tag_created'));
  }

  function removeTag(tag: AssetTag): void {
    void run(
      () => model.client.deleteTag(tag.id),
      t('library.taxonomy.tag_deleted', { name: tag.name }),
    );
  }
</script>

<Modal bind:open title={t('library.taxonomy.title')}>
  <div class="stack">
    <section class="stack-sm" aria-labelledby="taxo-categories">
      <h3 id="taxo-categories">{t('library.taxonomy.categories')}</h3>
      {#if categories.length === 0}
        <p class="small muted">{t('library.taxonomy.no_categories')}</p>
      {:else}
        <ul class="items">
          {#each categories as category (category.id)}
            <li>
              {#if editingId === category.id}
                <form class="row" onsubmit={(event) => rename(event, category)}>
                  <TextField
                    label={t('library.fields.name')}
                    bind:value={editingName}
                    maxlength={80}
                  />
                  <Button type="submit" size="small" loading={busy}>{t('common.save')}</Button>
                  <button
                    type="button"
                    class="button button-small"
                    onclick={() => (editingId = null)}>{t('common.cancel')}</button
                  >
                </form>
              {:else}
                <span class="label">
                  {category.name}
                  {#if category.parent_id}
                    <span class="small muted">({model.categoryName(category.parent_id) ?? ''})</span
                    >
                  {/if}
                </span>
                <button
                  type="button"
                  class="button button-small"
                  onclick={() => startRename(category)}
                  aria-label={t('library.taxonomy.rename', { name: category.name })}
                  >{t('common.edit')}</button
                >
                <button
                  type="button"
                  class="button button-small button-danger"
                  disabled={busy}
                  onclick={() => removeCategory(category)}
                  aria-label={t('library.taxonomy.delete', { name: category.name })}
                  >{t('common.delete')}</button
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      <form class="row add" onsubmit={createCategory}>
        <TextField
          label={t('library.taxonomy.new_category')}
          bind:value={categoryName}
          maxlength={80}
        />
        <SelectField
          label={t('library.taxonomy.parent')}
          bind:value={parentId}
          options={parentOptions}
        />
        <Button type="submit" size="small" loading={busy}>{t('common.create')}</Button>
      </form>
    </section>

    <section class="stack-sm" aria-labelledby="taxo-tags">
      <h3 id="taxo-tags">{t('library.fields.tags')}</h3>
      {#if tags.length === 0}
        <p class="small muted">{t('library.taxonomy.no_tags')}</p>
      {:else}
        <ul class="chips">
          {#each tags as tag (tag.id)}
            <li class="badge">
              {tag.name}
              <button
                type="button"
                class="chip-remove"
                disabled={busy}
                onclick={() => removeTag(tag)}
                aria-label={t('library.taxonomy.delete', { name: tag.name })}>×</button
              >
            </li>
          {/each}
        </ul>
      {/if}
      <form class="row add" onsubmit={createTag}>
        <TextField label={t('library.taxonomy.new_tag')} bind:value={tagName} maxlength={50} />
        <Button type="submit" size="small" loading={busy}>{t('common.create')}</Button>
      </form>
    </section>
  </div>
</Modal>

<style>
  h3 {
    margin: 0;
    font-size: var(--font-size-md);
  }
  .stack-sm {
    display: grid;
    gap: var(--space-2);
  }
  .items {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .items li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .label {
    flex: 1;
  }
  .add {
    align-items: flex-end;
  }
  .add > :global(.field) {
    flex: 1 1 8rem;
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
</style>
