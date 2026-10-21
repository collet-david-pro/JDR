<script lang="ts">
  import type { Snippet } from 'svelte';
  import { roleLabel } from '../../lib/games/labels';
  import { t } from '../../lib/i18n';
  import { href } from '../../lib/services';
  import type { Game } from '../../lib/types';

  interface Props {
    game: Game;
    /** Shows the GM name (games where I play). */
    showGm?: boolean;
    /** Archived/trashed games: no link, actions instead. */
    link?: boolean;
    actions?: Snippet;
  }

  let { game, showGm = false, link = true, actions }: Props = $props();
  const uid = $props.id();
</script>

<article class="game-card" aria-labelledby={`${uid}-name`}>
  <div class="cover" aria-hidden="true">
    {#if game.cover_url}
      <img src={game.cover_url} alt="" loading="lazy" decoding="async" />
    {:else}
      <span class="initial">{[...game.name][0]?.toUpperCase() ?? '?'}</span>
    {/if}
  </div>
  <div class="body">
    <h3 id={`${uid}-name`}>
      {#if link}
        <a href={href(`/games/${encodeURIComponent(game.id)}`)}>{game.name}</a>
      {:else}
        {game.name}
      {/if}
    </h3>
    {#if showGm}
      <p class="small muted">{t('games.card.gm', { name: game.gm.username })}</p>
    {/if}
    {#if game.my_role !== 'gm'}
      <p><span class="badge">{roleLabel(game.my_role)}</span></p>
    {/if}
    <ul class="counts small muted">
      <li>{t('games.counts.maps', { count: game.counts.maps })}</li>
      <li>{t('games.counts.tokens', { count: game.counts.tokens })}</li>
      <li>{t('games.counts.members', { count: game.counts.members })}</li>
    </ul>
    {#if actions}<div class="row actions">{@render actions()}</div>{/if}
  </div>
</article>

<style>
  .game-card {
    position: relative;
    display: grid;
    grid-template-columns: 4.5rem 1fr;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
  }
  .game-card:focus-within {
    border-color: var(--color-primary);
  }
  .cover {
    width: 4.5rem;
    height: 4.5rem;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-primary-soft);
    display: grid;
    place-items: center;
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .initial {
    font-family: var(--font-heading);
    font-size: var(--font-size-2xl);
    color: var(--color-primary);
  }
  .body {
    display: grid;
    gap: var(--space-1);
    align-content: start;
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--font-size-md);
    overflow-wrap: anywhere;
  }
  h3 a {
    color: inherit;
  }
  /* The whole card is clickable; the link stays the only focusable element. */
  h3 a::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  p {
    margin: 0;
  }
  .counts {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .actions {
    position: relative;
    z-index: 1;
    margin-top: var(--space-1);
  }
</style>
