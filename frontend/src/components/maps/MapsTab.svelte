<script lang="ts">
  import MapCard from './MapCard.svelte';
  import MapCreateDialog from './MapCreateDialog.svelte';
  import MapEditDialog from './MapEditDialog.svelte';
  import { describeError } from '../../lib/errors';
  import { folderNames, isMapSort, MAP_SORTS, type MapSort } from '../../lib/maps/folders';
  import { MapsTabModel } from '../../lib/maps/maps-tab.svelte';
  import { mapsClient } from '../../lib/maps/service';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import type { Game, MapDetail, MapListState, MapPatch, MapSummary } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * Maps tab of the game page (projet.md 18.1 p.3): thumbnails grouped by folder, sort,
   * creation, rename / move, duplicate, trash with restoration, opening in the editor.
   */
  interface Props {
    game: Game;
  }

  let { game }: Props = $props();

  // svelte-ignore state_referenced_locally
  const model = new MapsTabModel(mapsClient(), game.id);
  const failure = $derived(model.error === null ? null : describeError(model.error, t));
  const folders = $derived(folderNames(model.maps));
  const uid = $props.id();

  let createOpen = $state(false);
  let createFolder = $state<string | null>(null);
  let editOpen = $state(false);
  let editing = $state.raw<MapSummary | null>(null);
  let busyId = $state<string | null>(null);

  $effect(() => {
    void model.load('active');
  });

  function sortLabel(sort: MapSort): string {
    switch (sort) {
      case 'manual':
        return t('games.maps.sort.manual');
      case 'name':
        return t('games.maps.sort.name');
      case 'updated':
        return t('games.maps.sort.updated');
    }
  }

  function showView(view: MapListState): void {
    if (model.view !== view) void model.load(view);
  }

  function openCreate(folder: string | null = null): void {
    createFolder = folder;
    createOpen = true;
  }

  function created(map: MapDetail): void {
    toasts.success(t('games.maps.created', { name: map.name }));
    services().router.navigate(
      `/games/${encodeURIComponent(game.id)}/maps/${encodeURIComponent(map.id)}/edit`,
    );
  }

  function edit(map: MapSummary): void {
    editing = map;
    editOpen = true;
  }

  async function save(map: MapSummary, patch: MapPatch): Promise<void> {
    await model.update(map.id, patch);
    toasts.success(t('games.maps.saved', { name: patch.name ?? map.name }));
  }

  async function act(map: MapSummary, action: () => Promise<unknown>, done: string): Promise<void> {
    busyId = map.id;
    try {
      await action();
      toasts.success(done);
    } catch (error) {
      toasts.error(error);
    } finally {
      busyId = null;
    }
  }
</script>

<div class="stack">
  <div class="head">
    <div class="views" role="group" aria-label={t('games.maps.views')}>
      <button
        type="button"
        class="button button-small"
        aria-pressed={model.view === 'active'}
        data-testid="maps-view-active"
        onclick={() => showView('active')}>{t('games.maps.view_active')}</button
      >
      <button
        type="button"
        class="button button-small"
        aria-pressed={model.view === 'trash'}
        data-testid="maps-view-trash"
        onclick={() => showView('trash')}>{t('games.maps.view_trash')}</button
      >
    </div>
    <label class="sort small" for={`${uid}-sort`}>
      {t('games.maps.sort.label')}
      <select
        id={`${uid}-sort`}
        class="select"
        value={model.sort}
        onchange={(e) => {
          const v = e.currentTarget.value;
          if (isMapSort(v)) model.sort = v;
        }}
      >
        {#each MAP_SORTS as sort (sort)}<option value={sort}>{sortLabel(sort)}</option>{/each}
      </select>
    </label>
    {#if model.view === 'active'}
      <button
        type="button"
        class="button button-primary"
        data-testid="map-new"
        onclick={() => openCreate()}>{t('games.maps.create')}</button
      >
    {/if}
  </div>

  {#if model.view === 'trash'}
    <p class="small muted">{t('games.maps.trash_intro')}</p>
  {/if}

  {#if model.status === 'error'}
    <div class="alert alert-error row" role="alert">
      <span>{failure?.message}</span>
      <button type="button" class="button button-small" onclick={() => model.load()}>
        {t('common.retry')}
      </button>
    </div>
  {:else if model.status !== 'ready'}
    <p class="muted" aria-busy="true">{t('common.loading')}</p>
  {:else if model.maps.length === 0}
    <p class="muted empty" data-testid="maps-empty">
      {model.view === 'trash' ? t('games.maps.trash_empty') : t('games.maps.empty')}
    </p>
  {:else}
    {#each model.groups as group (group.folder ?? '')}
      <section class="folder" aria-label={group.folder ?? t('games.maps.no_folder')}>
        <div class="folder-head">
          <h2>
            {#if group.folder === null}
              {t('games.maps.no_folder')}
            {:else}
              <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"
                ><path d="M1.5 3.5h5l1.5 1.5h6.5v8h-13z" /></svg
              >
              {group.path.join(' / ')}
            {/if}
            <span class="small muted">({group.maps.length})</span>
          </h2>
          {#if model.view === 'active' && group.folder !== null}
            <button
              type="button"
              class="button button-small button-ghost"
              onclick={() => openCreate(group.folder)}>{t('games.maps.create_here')}</button
            >
          {/if}
        </div>
        <ul class="grid">
          {#each group.maps as map (map.id)}
            <li>
              <MapCard
                {map}
                trash={model.view === 'trash'}
                busy={busyId === map.id}
                onedit={edit}
                onduplicate={(m) =>
                  act(m, () => model.duplicate(m.id), t('games.maps.duplicated', { name: m.name }))}
                ontrash={(m) =>
                  act(m, () => model.trash(m.id), t('games.maps.trashed', { name: m.name }))}
                onrestore={(m) =>
                  act(m, () => model.restore(m.id), t('games.maps.restored', { name: m.name }))}
              />
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>

<MapCreateDialog
  bind:open={createOpen}
  settings={game.settings}
  folder={createFolder}
  {folders}
  oncreate={(input) => model.create(input)}
  oncreated={created}
/>
<MapEditDialog bind:open={editOpen} map={editing} {folders} onsave={save} />

<style>
  .head,
  .folder-head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
  }
  .views {
    display: flex;
    gap: var(--space-1);
  }
  .sort {
    display: inline-flex;
    gap: var(--space-2);
    align-items: center;
    margin-left: auto;
  }
  .select {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-md);
  }
  .icon {
    width: 1em;
    height: 1em;
    vertical-align: -0.125em;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
  }
  .folder {
    display: grid;
    gap: var(--space-2);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .empty {
    padding: var(--space-6) var(--space-4);
    text-align: center;
    border: var(--border-width) dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
  }
  p {
    margin: 0;
  }
  .alert.row {
    justify-content: space-between;
  }
</style>
