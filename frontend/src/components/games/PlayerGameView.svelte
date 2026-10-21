<script lang="ts">
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import TokenList from './TokenList.svelte';
  import { DEFAULT_SETTINGS } from '../../lib/games/game-form';
  import type { GamePageModel } from '../../lib/games/game-page.svelte';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * Player view of a game (projet.md 18.1 p.4). The server only sends the player's own
   * tokens (and their images); nothing else is assumed here.
   */
  interface Props {
    model: GamePageModel;
  }

  let { model }: Props = $props();

  const { auth, router } = services();
  const game = $derived(model.game);
  const settings = $derived({ ...DEFAULT_SETTINGS, ...game?.settings });
  let confirmOpen = $state(false);
  let leaving = $state(false);

  async function leave(): Promise<void> {
    const me = auth.user?.id;
    if (me === undefined || game === null) return;
    leaving = true;
    try {
      await model.removeMember(me);
      confirmOpen = false;
      toasts.success(t('games.player.left', { name: game.name }));
      router.navigate('/');
    } catch (error) {
      toasts.error(error);
    } finally {
      leaving = false;
    }
  }
</script>

{#if game}
  <div class="player-game">
    <header class="head">
      {#if game.cover_url}<img class="cover" src={game.cover_url} alt="" />{/if}
      <div>
        <h1>{game.name}</h1>
        <p class="muted">{t('games.card.gm', { name: game.gm.username })}</p>
      </div>
    </header>
    {#if game.description}<p class="description">{game.description}</p>{/if}

    <section class="card" aria-labelledby="current-session">
      <h2 id="current-session">{t('games.player.session')}</h2>
      <p class="muted">{t('games.player.no_session')}</p>
    </section>

    <section class="card stack" aria-labelledby="my-tokens">
      <h2 id="my-tokens">{t('games.player.tokens')}</h2>
      {#if !model.listsLoaded}
        <p class="muted" aria-busy="true">{t('common.loading')}</p>
      {:else if model.tokens.length === 0}
        <p class="muted">{t('games.player.no_tokens')}</p>
      {:else}
        <TokenList tokens={model.tokens} {settings} />
      {/if}
    </section>

    <div class="row">
      <button type="button" class="button button-danger" onclick={() => (confirmOpen = true)}>
        {t('games.player.leave')}
      </button>
    </div>
  </div>

  <ConfirmDialog
    bind:open={confirmOpen}
    title={t('games.player.leave_title')}
    message={t('games.player.leave_text', { name: game.name })}
    confirmLabel={t('games.player.leave')}
    danger
    busy={leaving}
    onconfirm={leave}
  />
{/if}

<style>
  .player-game {
    display: grid;
    gap: var(--space-4);
  }
  .head {
    display: flex;
    gap: var(--space-4);
    align-items: center;
  }
  .cover {
    width: 4.5rem;
    height: 4.5rem;
    object-fit: cover;
    border-radius: var(--radius-md);
  }
  h1 {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .head p,
  section p {
    margin: 0;
  }
  .description {
    margin: 0;
    white-space: pre-line;
  }
</style>
