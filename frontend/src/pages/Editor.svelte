<script lang="ts">
  import Forbidden from './Forbidden.svelte';
  import NotFound from './NotFound.svelte';
  import EditorWorkspace from '../components/editor/EditorWorkspace.svelte';
  import { ApiError } from '../lib/api';
  import { describeError } from '../lib/errors';
  import { canEditContent } from '../lib/games/roles';
  import { gamesClient } from '../lib/games/service';
  import { t } from '../lib/i18n';
  import { mapsClient } from '../lib/maps/service';
  import type { PageProps } from '../lib/page';
  import { services } from '../lib/services';
  import type { Game, MapDetail } from '../lib/types';

  /**
   * Map editor (/games/:id/maps/:mapId/edit), GM and co-GM only: a player gets 403, a
   * non-member 404 (like the game page). The map is saved on the server (P4b); the old local
   * draft address (`local`) leads back to the Maps tab.
   */
  let { params, query }: PageProps = $props();

  type Status = 'loading' | 'not_found' | 'forbidden' | 'error' | 'ready';
  let status = $state<Status>('loading');
  let error = $state.raw<unknown>(null);
  let game = $state.raw<Game | null>(null);
  let map = $state.raw<MapDetail | null>(null);
  /** Bumped by a reload: the workspace is mounted again. */
  let generation = $state(0);
  const failure = $derived(error === null ? null : describeError(error, t));
  const gameId = $derived(params['id'] ?? '');
  const mapId = $derived(params['mapId'] ?? '');
  const debug = $derived(query.get('debug') === '1' || import.meta.env.DEV);

  async function load(gid: string, mid: string): Promise<void> {
    status = 'loading';
    error = null;
    try {
      const loadedGame = await gamesClient().get(gid);
      game = loadedGame;
      if (!canEditContent(loadedGame.my_role)) {
        status = 'forbidden';
        return;
      }
      const loadedMap = await mapsClient().get(mid);
      if (loadedMap.game_id !== loadedGame.id || loadedMap.deleted_at !== null) {
        status = 'not_found';
        return;
      }
      map = loadedMap;
      generation++;
      status = 'ready';
      document.title = `${loadedMap.name} · ${loadedGame.name} · ${t('app.name')}`;
    } catch (e) {
      error = e;
      status =
        e instanceof ApiError && e.status === 404
          ? 'not_found'
          : e instanceof ApiError && e.status === 403
            ? 'forbidden'
            : 'error';
    }
  }

  $effect(() => {
    if (mapId === 'local') {
      services().router.navigate(`/games/${gameId}?tab=maps`, { replace: true });
      return;
    }
    void load(gameId, mapId);
  });
</script>

{#if status === 'not_found'}
  <NotFound />
{:else if status === 'forbidden'}
  <Forbidden />
{:else if status === 'error'}
  <section class="system-page" role="alert">
    <h1>{t('pages.error.title')}</h1>
    <p>{failure?.message}</p>
    <button type="button" class="button" onclick={() => load(gameId, mapId)}
      >{t('common.retry')}</button
    >
  </section>
{:else if status === 'loading' || game === null || map === null}
  <p class="muted" aria-busy="true">{t('common.loading')}</p>
{:else}
  {#key generation}
    <EditorWorkspace
      gameId={game.id}
      gameName={game.name}
      {map}
      client={mapsClient()}
      loadTokens={() => gamesClient().tokens(game?.id ?? gameId)}
      onreload={() => load(gameId, mapId)}
      {debug}
    />
  {/key}
{/if}
