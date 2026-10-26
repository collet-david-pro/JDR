<script lang="ts">
  import { t } from '../../lib/i18n';
  import { playerStatusLabel } from '../../lib/sessions/labels';
  import { preloadRatio, type PreloadProgress } from '../../lib/sessions/play/preload';
  import type { SessionState } from '../../lib/sessions';
  import NetworkIndicator from './NetworkIndicator.svelte';

  /**
   * Lobby of a player (projet.md 18.1 p.7): the players, the tokens assigned to the player, the
   * preload bar, the "ready" switch and "waiting for the GM".
   */
  interface Props {
    state: SessionState;
    progress: PreloadProgress;
    ready: boolean;
    busy: boolean;
    onready: (ready: boolean) => void;
    onretry: () => void;
    onleave: () => void;
  }
  let { state, progress, ready, busy, onready, onretry, onleave }: Props = $props();

  const session = $derived(state.session);
  const mine = $derived(session.assignments.filter((a) => a.user_id === state.me));
  const percent = $derived(Math.round(preloadRatio(progress) * 100));
  const hasMap = $derived(session.current_map_id !== null);
  const loaded = $derived(progress.status === 'done');
  const running = $derived(session.state === 'running');

  function size(bytes: number): string {
    return bytes >= 1048576
      ? `${(bytes / 1048576).toFixed(1)} Mo`
      : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  }
</script>

<section class="lobby stack" data-testid="play-lobby" data-state={session.state}>
  <header class="head">
    <h1>{session.name}</h1>
    <NetworkIndicator />
  </header>

  <div class="card stack">
    <h2>{t('play.lobby.players')}</h2>
    <ul class="players" data-testid="play-players">
      {#each session.players as player (player.user_id)}
        <li data-testid="play-player" data-ready={player.ready}>
          <span class="who"
            >{player.username}{#if player.user_id === state.me}
              <span class="muted">({t('play.lobby.you')})</span>{/if}</span
          >
          <span class="muted">{playerStatusLabel(player.status)}</span>
          <span class="badge" class:on={player.ready}
            >{player.ready ? t('play.lobby.ready_state') : t('play.lobby.not_ready')}</span
          >
        </li>
      {/each}
    </ul>
  </div>

  <div class="card stack">
    <h2>{t('play.lobby.tokens')}</h2>
    {#if mine.length === 0}
      <p class="muted" data-testid="play-no-tokens">{t('play.lobby.no_tokens')}</p>
    {:else}
      <ul class="tokens" data-testid="play-tokens">
        {#each mine as a (a.token_id)}
          {@const def = state.definitions[a.token_id]}
          <li data-testid="play-token">
            {#if def?.image}
              <img src={def.image.thumb} alt="" width="40" height="40" />
            {:else}
              <span class="ph" aria-hidden="true"></span>
            {/if}
            <span>{def?.name ?? t('play.lobby.token_unknown')}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="card stack">
    <h2>{t('play.lobby.preload')}</h2>
    {#if !hasMap}
      <p class="muted" data-testid="play-no-map">{t('play.lobby.no_map')}</p>
    {:else if progress.status === 'error'}
      <p class="alert alert-error" role="alert">{t('play.lobby.preload_failed')}</p>
      <p><button type="button" class="button" onclick={onretry}>{t('common.retry')}</button></p>
    {:else}
      <div
        class="bar"
        role="progressbar"
        aria-label={t('play.lobby.preload')}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={percent}
        data-testid="play-progress"
        data-status={progress.status}
      >
        <span style:width={`${percent}%`}></span>
      </div>
      <p class="muted">
        {#if loaded}
          {t('play.lobby.preload_done')}
        {:else}
          {t('play.lobby.preload_progress', { done: progress.done, total: progress.total })}
        {/if}
        {#if progress.totalBytes > 0}
          · {size(progress.loadedBytes)} / {size(progress.totalBytes)}{/if}
      </p>
      {#if progress.errors > 0}
        <p class="alert alert-warning" role="status">
          {t('play.lobby.preload_errors', { count: progress.errors })}
        </p>
        {#if loaded}
          <p>
            <button type="button" class="button button-small" onclick={onretry}
              >{t('common.retry')}</button
            >
          </p>
        {/if}
      {/if}
    {/if}
  </div>

  <div class="card stack">
    <label class="ready">
      <input
        type="checkbox"
        checked={ready}
        disabled={busy || !hasMap || !loaded}
        data-testid="play-ready"
        onchange={(e) => onready(e.currentTarget.checked)}
      />
      <span>{t('play.lobby.ready')}</span>
    </label>
    {#if !running}
      <p class="muted" data-testid="play-waiting">{t('play.lobby.waiting_gm')}</p>
    {:else if hasMap}
      <p class="muted" aria-busy="true">{t('common.loading')}</p>
    {/if}
  </div>

  <p>
    <button type="button" class="button button-ghost" onclick={onleave} data-testid="play-leave"
      >{t('play.leave')}</button
    >
  </p>
</section>

<style>
  .lobby {
    max-width: 40rem;
    margin: 0 auto;
    padding: var(--space-4);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  h1,
  h2 {
    margin: 0;
  }
  h2 {
    font-size: var(--font-size-lg);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .players li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    justify-content: space-between;
  }
  .badge {
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    border: var(--border-width) solid var(--color-border);
    font-size: var(--font-size-sm);
  }
  .badge.on {
    background: var(--color-success-bg, transparent);
    font-weight: 600;
  }
  .tokens li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .tokens img,
  .ph {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    object-fit: cover;
    background: var(--color-surface-sunken);
  }
  .bar {
    height: 0.75rem;
    border-radius: var(--radius-sm);
    background: var(--color-surface-sunken);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--color-accent, currentColor);
    transition: width 0.2s;
  }
  .ready {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.75rem;
  }
  p {
    margin: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .bar span {
      transition: none;
    }
  }
</style>
