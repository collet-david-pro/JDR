<script lang="ts">
  import Button from '../Button.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import ErrorAlert from '../ErrorAlert.svelte';
  import Modal from '../Modal.svelte';
  import TextField from '../TextField.svelte';
  import { describeError } from '../../lib/errors';
  import { FormState } from '../../lib/form.svelte';
  import { t } from '../../lib/i18n';
  import { MAP_NAME_MAX } from '../../lib/maps/map-form';
  import {
    templateSections,
    type MapTemplate,
    type TemplateSections,
  } from '../../lib/maps/templates';
  import type { MapDetail } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * "From a template": built-in and site templates, then the user's own; pick one, name the new
   * map, create it (same follow-up as a new map). A template can be deleted when allowed.
   */
  interface Props {
    open: boolean;
    list: () => Promise<MapTemplate[]>;
    create: (template: MapTemplate, name: string) => Promise<MapDetail>;
    remove: (template: MapTemplate) => Promise<void>;
    oncreated: (map: MapDetail) => void;
  }

  let { open = $bindable(), list, create, remove, oncreated }: Props = $props();

  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let loadError = $state.raw<unknown>(null);
  let sections = $state.raw<TemplateSections>({ shared: [], mine: [] });
  let selectedId = $state<string | null>(null);
  let name = $state('');
  let confirmOpen = $state(false);
  let toDelete = $state.raw<MapTemplate | null>(null);
  let deleting = $state(false);
  let formEl: HTMLFormElement | undefined = $state();
  const form = new FormState();
  const failure = $derived(loadError === null ? null : describeError(loadError, t));
  const empty = $derived(sections.shared.length === 0 && sections.mine.length === 0);
  const selected = $derived(
    [...sections.shared, ...sections.mine].find((x) => x.id === selectedId) ?? null,
  );

  async function load(): Promise<void> {
    status = 'loading';
    loadError = null;
    try {
      sections = templateSections(await list());
      status = 'ready';
      if (
        selectedId !== null &&
        ![...sections.shared, ...sections.mine].some((x) => x.id === selectedId)
      ) {
        selectedId = null;
      }
    } catch (error) {
      loadError = error;
      status = 'error';
    }
  }

  $effect(() => {
    if (open) {
      selectedId = null;
      name = '';
      form.reset();
      void load();
    }
  });

  function pick(template: MapTemplate): void {
    selectedId = template.id;
    name = template.name;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const template = selected;
    const trimmed = name.trim();
    const result: { map: MapDetail | null } = { map: null };
    const ok = await form.submit(
      async () => {
        if (template !== null) result.map = await create(template, trimmed);
      },
      {
        form: formEl,
        validate: () =>
          template === null
            ? {}
            : trimmed === ''
              ? { name: 'required' }
              : trimmed.length > MAP_NAME_MAX
                ? { name: 'too_long' }
                : {},
      },
    );
    if (ok && result.map !== null) {
      open = false;
      oncreated(result.map);
    }
  }

  function askDelete(template: MapTemplate): void {
    toDelete = template;
    confirmOpen = true;
  }

  async function confirmDelete(): Promise<void> {
    const template = toDelete;
    if (template === null) return;
    deleting = true;
    try {
      await remove(template);
      toasts.success(t('games.maps.template.deleted', { name: template.name }));
      confirmOpen = false;
      await load();
    } catch (error) {
      toasts.error(error);
      confirmOpen = false;
    } finally {
      deleting = false;
    }
  }
</script>

{#snippet group(title: string, items: readonly MapTemplate[], testid: string)}
  <section class="group" aria-labelledby={`${testid}-title`} data-testid={testid}>
    <h3 id={`${testid}-title`}>{title}</h3>
    {#if items.length === 0}
      <p class="small muted">{t('games.maps.template.section_empty')}</p>
    {:else}
      <ul class="list">
        {#each items as template (template.id)}
          <li class="item" data-selected={template.id === selectedId}>
            <button
              type="button"
              class="pick"
              aria-pressed={template.id === selectedId}
              data-testid="template-item"
              data-template-id={template.id}
              data-template-name={template.name}
              onclick={() => pick(template)}
            >
              <strong>{template.name}</strong>
              <span class="small muted">
                {t('games.maps.card.size', { width: template.width, height: template.height })}
                · {t('games.maps.template.floors', { count: template.floors })}
                {#if template.builtin}· {t('games.maps.template.builtin')}{/if}
              </span>
            </button>
            {#if template.can_delete}
              <button
                type="button"
                class="button button-small button-ghost"
                aria-label={t('games.maps.template.delete_label', { name: template.name })}
                data-testid="template-delete"
                onclick={() => askDelete(template)}>{t('games.maps.template.delete')}</button
              >
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/snippet}

<Modal bind:open title={t('games.maps.template.pick_title')}>
  <form class="stack" novalidate bind:this={formEl} onsubmit={submit} data-testid="template-picker">
    {#if status === 'loading'}
      <p class="muted" aria-busy="true">{t('common.loading')}</p>
    {:else if status === 'error'}
      <div class="alert alert-error row" role="alert">
        <span>{failure?.message}</span>
        <button type="button" class="button button-small" onclick={() => load()}>
          {t('common.retry')}
        </button>
      </div>
    {:else if empty}
      <p class="muted" data-testid="templates-empty">{t('games.maps.template.empty')}</p>
    {:else}
      {@render group(t('games.maps.template.section_shared'), sections.shared, 'templates-shared')}
      {@render group(t('games.maps.template.section_mine'), sections.mine, 'templates-mine')}
      <TextField
        label={t('games.maps.fields.name')}
        name="name"
        bind:value={name}
        required
        disabled={selected === null}
        maxlength={MAP_NAME_MAX}
        autocomplete="off"
        hint={selected === null ? t('games.maps.template.pick_hint') : null}
        error={form.message('name')}
      />
    {/if}
    <ErrorAlert failure={form.failure} />
    <div class="row actions">
      <button type="button" class="button" onclick={() => (open = false)}>
        {t('common.cancel')}
      </button>
      <Button
        type="submit"
        variant="primary"
        disabled={selected === null}
        loading={form.submitting}
        data-testid="template-create"
      >
        {t('games.maps.template.create_submit')}
      </Button>
    </div>
  </form>
</Modal>

<ConfirmDialog
  bind:open={confirmOpen}
  title={t('games.maps.template.delete_title')}
  message={t('games.maps.template.delete_message', { name: toDelete?.name ?? '' })}
  confirmLabel={t('games.maps.template.delete')}
  confirmTestId="template-delete-confirm"
  danger
  busy={deleting}
  onconfirm={confirmDelete}
/>

<style>
  .group {
    display: grid;
    gap: var(--space-2);
  }
  h3 {
    margin: 0;
    font-size: var(--font-size-md);
  }
  p {
    margin: 0;
  }
  .list {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .item {
    display: flex;
    gap: var(--space-2);
    align-items: stretch;
  }
  .pick {
    display: grid;
    flex: 1;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    text-align: left;
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
  }
  .pick[aria-pressed='true'] {
    border-color: var(--color-accent);
    background: var(--color-surface-sunken);
  }
  .alert.row {
    justify-content: space-between;
  }
  .actions {
    justify-content: flex-end;
  }
</style>
