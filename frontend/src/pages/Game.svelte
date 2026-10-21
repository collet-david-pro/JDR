<script lang="ts">
  import GameManager from '../components/games/GameManager.svelte';
  import PlayerGameView from '../components/games/PlayerGameView.svelte';
  import { describeError } from '../lib/errors';
  import { GamePageModel } from '../lib/games/game-page.svelte';
  import { gamesClient } from '../lib/games/service';
  import { t } from '../lib/i18n';
  import type { PageProps } from '../lib/page';
  import NotFound from './NotFound.svelte';

  let { params, query }: PageProps = $props();

  // A new model when the route parameter changes (navigation from one game to another).
  const model = $derived(new GamePageModel(gamesClient(), params['id'] ?? ''));
  const failure = $derived(model.error === null ? null : describeError(model.error, t));

  $effect(() => {
    void model.load();
  });

  // Document title: the game name.
  $effect(() => {
    const name = model.game?.name;
    if (name !== undefined) document.title = `${name} · ${t('app.name')}`;
  });
</script>

<!-- Game page (projet.md 18.1 p.3-4): GM/co-GM tabs, or the player view. -->
{#if model.status === 'not_found'}
  <NotFound />
{:else if model.status === 'error'}
  <section class="system-page" role="alert">
    <h1>{t('pages.error.title')}</h1>
    <p>{failure?.message}</p>
    {#if failure?.requestId}
      <p class="small muted">{t('pages.error.request_id', { id: failure.requestId })}</p>
    {/if}
    <button type="button" class="button" onclick={() => model.load()}>{t('common.retry')}</button>
  </section>
{:else if model.status === 'loading' || model.game === null}
  <p class="muted" aria-busy="true">{t('common.loading')}</p>
{:else if model.game.my_role === 'player'}
  <PlayerGameView {model} />
{:else}
  <GameManager {model} requestedTab={query.get('tab')} />
{/if}
