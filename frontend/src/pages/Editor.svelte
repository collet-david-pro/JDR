<script lang="ts">
  import Forbidden from './Forbidden.svelte';
  import NotFound from './NotFound.svelte';
  import EditorWorkspace from '../components/editor/EditorWorkspace.svelte';
  import type { GridSpec } from '../editor/contracts';
  import {
    DEFAULT_MAP_SIZE,
    MAX_MAP_SIZE,
    MIN_MAP_SIZE,
    gridFromSettings,
    parseMapSide,
  } from '../editor/ui/map-setup';
  import { ApiError } from '../lib/api';
  import { describeError } from '../lib/errors';
  import { canEditContent } from '../lib/games/roles';
  import { gamesClient } from '../lib/games/service';
  import { t } from '../lib/i18n';
  import type { PageProps } from '../lib/page';
  import { href } from '../lib/services';
  import type { Game } from '../lib/types';

  /**
   * Map editor (/games/:id/maps/:mapId/edit). P4a: local draft only (no server map yet, P4b);
   * GM and co-GM only (a player gets 403, a non-member 404 like the game page).
   */
  let { params, query }: PageProps = $props();

  type Status = 'loading' | 'not_found' | 'forbidden' | 'error' | 'setup' | 'ready';
  let status = $state<Status>('loading');
  let error = $state.raw<unknown>(null);
  let game = $state.raw<Game | null>(null);
  let grid = $state.raw<GridSpec | null>(null);
  let width = $state<number | null>(DEFAULT_MAP_SIZE.width);
  let height = $state<number | null>(DEFAULT_MAP_SIZE.height);
  let invalid = $state(false);
  const failure = $derived(error === null ? null : describeError(error, t));
  const gameId = $derived(params['id'] ?? '');
  const debug = $derived(query.get('debug') === '1' || import.meta.env.DEV);

  async function load(id: string): Promise<void> {
    status = 'loading';
    error = null;
    try {
      const loaded = await gamesClient().get(id);
      game = loaded;
      status = canEditContent(loaded.my_role) ? 'setup' : 'forbidden';
      document.title = `${loaded.name} · ${t('pages.editor.title')} · ${t('app.name')}`;
    } catch (e) {
      error = e;
      status = e instanceof ApiError && e.status === 404 ? 'not_found' : 'error';
    }
  }

  $effect(() => {
    void load(gameId);
  });

  function create(event: SubmitEvent): void {
    event.preventDefault();
    const w = width === null ? null : parseMapSide(width);
    const h = height === null ? null : parseMapSide(height);
    if (w === null || h === null || game === null) {
      invalid = true;
      return;
    }
    grid = gridFromSettings(game.settings, { width: w, height: h });
    status = 'ready';
  }
</script>

{#if status === 'not_found'}
  <NotFound />
{:else if status === 'forbidden'}
  <Forbidden />
{:else if status === 'error'}
  <section class="system-page" role="alert">
    <h1>{t('pages.error.title')}</h1>
    <p>{failure?.message}</p>
    <button type="button" class="button" onclick={() => load(gameId)}>{t('common.retry')}</button>
  </section>
{:else if status === 'loading' || game === null}
  <p class="muted" aria-busy="true">{t('common.loading')}</p>
{:else if status === 'setup' || grid === null}
  <section class="setup">
    <h1>{t('editor.draft.title')}</h1>
    <p class="alert alert-warning">{t('editor.draft.intro')}</p>
    <form onsubmit={create} novalidate data-testid="editor-setup">
      <div class="row">
        <label class="field">
          <span>{t('editor.draft.width')}</span>
          <input
            class="input"
            name="width"
            type="number"
            inputmode="numeric"
            min={MIN_MAP_SIZE}
            max={MAX_MAP_SIZE}
            required
            bind:value={width}
            aria-invalid={invalid}
            aria-describedby="editor-size-hint"
          />
        </label>
        <label class="field">
          <span>{t('editor.draft.height')}</span>
          <input
            class="input"
            name="height"
            type="number"
            inputmode="numeric"
            min={MIN_MAP_SIZE}
            max={MAX_MAP_SIZE}
            required
            bind:value={height}
            aria-invalid={invalid}
            aria-describedby="editor-size-hint"
          />
        </label>
      </div>
      <p
        id="editor-size-hint"
        class={invalid ? 'error' : 'small muted'}
        role={invalid ? 'alert' : undefined}
      >
        {invalid
          ? t('editor.draft.invalid', { min: MIN_MAP_SIZE, max: MAX_MAP_SIZE })
          : t('editor.draft.size_hint', { min: MIN_MAP_SIZE, max: MAX_MAP_SIZE })}
      </p>
      <div class="row">
        <a class="button" href={href(`/games/${game.id}?tab=maps`)}>{t('editor.back')}</a>
        <button type="submit" class="button button-primary" data-testid="editor-create">
          {t('editor.draft.create')}
        </button>
      </div>
    </form>
  </section>
{:else}
  <EditorWorkspace gameId={game.id} gameName={game.name} {grid} {debug} />
{/if}

<style>
  .setup {
    max-width: 36rem;
  }
  form {
    display: grid;
    gap: var(--space-3);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: end;
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .input {
    width: 8rem;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
  }
  .input[aria-invalid='true'] {
    border-color: var(--color-danger);
  }
  .error {
    color: var(--color-danger);
  }
  a.button {
    text-decoration: none;
  }
</style>
