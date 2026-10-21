<script lang="ts">
  import Button from '../Button.svelte';
  import GameCard from './GameCard.svelte';
  import type { DashboardGames, ShelfState } from '../../lib/games/dashboard.svelte';
  import { describeError } from '../../lib/errors';
  import { formatDateTime } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import type { Game } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';

  /** Archived games and trash of the GM (loaded when the section is opened). */
  interface Props {
    model: DashboardGames;
  }

  let { model }: Props = $props();

  let view = $state<ShelfState>('archived');
  let open = $state(false);
  let busyId = $state<string | null>(null);

  const games = $derived(model.shelf[view]);
  const failure = $derived(model.shelfError === null ? null : describeError(model.shelfError, t));

  function toggle(event: Event): void {
    open = (event.currentTarget as HTMLDetailsElement).open;
    if (open && games === null) void model.loadShelf(view);
  }

  function choose(next: ShelfState): void {
    view = next;
    if (model.shelf[next] === null) void model.loadShelf(next);
  }

  async function restore(game: Game): Promise<void> {
    busyId = game.id;
    try {
      await model.restore(game, view);
      toasts.success(t('games.shelf.restored', { name: game.name }));
    } catch (error) {
      toasts.error(error);
    } finally {
      busyId = null;
    }
  }
</script>

<details class="shelf" ontoggle={toggle}>
  <summary>{t('games.shelf.title')}</summary>
  {#if open}
    <div class="content">
      <div class="row" role="group" aria-label={t('games.shelf.title')}>
        <button
          type="button"
          class="button button-small"
          aria-pressed={view === 'archived'}
          onclick={() => choose('archived')}>{t('games.shelf.archived')}</button
        >
        <button
          type="button"
          class="button button-small"
          aria-pressed={view === 'trash'}
          onclick={() => choose('trash')}>{t('games.shelf.trash')}</button
        >
      </div>
      {#if view === 'trash'}
        <p class="small muted">{t('games.shelf.trash_hint')}</p>
      {/if}
      {#if failure}
        <p class="alert alert-error" role="alert">{failure.message}</p>
      {:else if games === null}
        <p class="small muted" aria-busy="true">{t('common.loading')}</p>
      {:else if games.length === 0}
        <p class="small muted">
          {view === 'archived' ? t('games.shelf.archived_empty') : t('games.shelf.trash_empty')}
        </p>
      {:else}
        <ul class="list">
          {#each games as game (game.id)}
            <li>
              <GameCard {game} link={view === 'archived'}>
                {#snippet actions()}
                  {#if view === 'trash' && game.deleted_at}
                    <span class="small muted"
                      >{t('games.shelf.deleted_at', {
                        date: formatDateTime(game.deleted_at),
                      })}</span
                    >
                  {/if}
                  <Button
                    size="small"
                    loading={busyId === game.id}
                    onclick={() => restore(game)}
                    aria-label={t('games.shelf.restore_named', { name: game.name })}
                  >
                    {t('games.shelf.restore')}
                  </Button>
                {/snippet}
              </GameCard>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</details>

<style>
  .shelf summary {
    cursor: pointer;
    font-weight: var(--font-weight-medium);
  }
  .content {
    display: grid;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .button[aria-pressed='true'] {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
  }
  .list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  p {
    margin: 0;
  }
</style>
