<script lang="ts">
  import CheckboxField from '../CheckboxField.svelte';
  import SelectField from '../SelectField.svelte';
  import TextField from '../TextField.svelte';
  import { kindLabel } from '../../lib/assets/labels';
  import type { LibraryModel } from '../../lib/assets/library.svelte';
  import { t } from '../../lib/i18n';
  import { ASSET_KINDS } from '../../lib/types';

  interface Props {
    model: LibraryModel;
    /** Called after a change; `debounced` for the search field. */
    onchange: (debounced: boolean) => void;
  }

  let { model, onchange }: Props = $props();

  const scopeOptions = [
    { value: 'mine', label: t('library.scope.mine') },
    { value: 'general', label: t('library.scope.general') },
  ];
  const kindOptions = [
    { value: '', label: t('library.filters.all_kinds') },
    ...ASSET_KINDS.map((value) => ({ value, label: kindLabel(value) })),
  ];
  const categoryOptions = $derived([
    { value: '', label: t('library.filters.all_categories') },
    ...model.categories.map((category) => ({
      value: category.id,
      label:
        category.scope === 'general' && !model.admin
          ? t('library.filters.general_item', { name: category.name })
          : category.name,
    })),
  ]);
  const tagOptions = $derived([
    { value: '', label: t('library.filters.all_tags') },
    ...model.tags.map((tag) => ({ value: tag.id, label: tag.name })),
  ]);
</script>

<div class="filters" role="search" aria-label={t('library.filters.label')}>
  <TextField
    label={t('common.search')}
    type="search"
    bind:value={model.q}
    oninput={() => onchange(true)}
  />
  {#if !model.admin}
    <SelectField
      label={t('library.filters.scope')}
      bind:value={model.scope}
      options={scopeOptions}
      onchange={() => onchange(false)}
    />
  {/if}
  <SelectField
    label={t('library.fields.kind')}
    bind:value={model.kind}
    options={kindOptions}
    onchange={() => onchange(false)}
  />
  <SelectField
    label={t('library.fields.category')}
    bind:value={model.category}
    options={categoryOptions}
    onchange={() => onchange(false)}
  />
  <SelectField
    label={t('library.fields.tag')}
    bind:value={model.tag}
    options={tagOptions}
    onchange={() => onchange(false)}
  />
  <div class="fav">
    <CheckboxField
      label={t('library.filters.favorites')}
      bind:checked={model.favorites}
      onchange={() => onchange(false)}
    />
  </div>
</div>

<style>
  .filters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
    gap: var(--space-3);
    align-items: end;
  }
  .fav {
    padding-bottom: var(--space-2);
  }
</style>
