<script lang="ts">
  import { sessionsClient } from '../../lib/services';
  import { t } from '../../lib/i18n';
  import { playerStatusLabel, sessionProblem } from '../../lib/sessions/labels';
  import type { PanelProps } from '../../lib/sessions/console/panel-props';
  import {
    assignablePlayers,
    playerRows,
    readiness,
    unassignedTokens,
  } from '../../lib/sessions/console/players';
  import { assignedTo } from '../../lib/sessions';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * Console panel "Joueurs": presence, readiness, kick, and token assignments (drag a token
   * onto a player, or use the list on each token; the list is the keyboard way).
   */
  let { run }: PanelProps = $props();
  const uid = $props.id();
  const snap = $derived(run.state);
  const sessionId = $derived(snap?.session.id ?? '');
  const rows = $derived(snap === null ? [] : playerRows(snap));
  const free = $derived(snap === null ? [] : unassignedTokens(snap));
  const players = $derived(snap === null ? [] : assignablePlayers(snap));
  const ready = $derived(snap === null ? { connected: 0, ready: 0 } : readiness(snap));
  let dragged = $state<string | null>(null);
  let over = $state<string | null>(null);

  async function assign(tokenId: string, userId: string | null): Promise<void> {
    try {
      await sessionsClient().assign(sessionId, tokenId, userId);
      await run.reload();
    } catch (error) {
      toasts.show('error', sessionProblem(error));
    }
  }

  async function kick(userId: string): Promise<void> {
    try {
      await sessionsClient().kick(sessionId, userId);
      // The GM is not told about a kick by an event: read the session again.
      await run.reload();
    } catch (error) {
      toasts.show('error', sessionProblem(error));
    }
  }

  function drop(event: DragEvent, userId: string): void {
    event.preventDefault();
    const tokenId = event.dataTransfer?.getData('text/plain') || dragged;
    dragged = null;
    over = null;
    if (tokenId) void assign(tokenId, userId);
  }
</script>

<section class="panel" aria-labelledby={`${uid}-title`} data-testid="players-panel">
  <h2 id={`${uid}-title`}>{t('sessions.players.title')}</h2>
  <p class="small muted" data-testid="players-ready">
    {t('sessions.players.ready_count', { ready: ready.ready, connected: ready.connected })}
  </p>
  {#if rows.length === 0}
    <p class="muted small" data-testid="players-empty">{t('sessions.players.empty')}</p>
  {:else}
    <ul class="players">
      {#each rows as { player, tokens } (player.user_id)}
        <li
          class:over={over === player.user_id}
          data-testid="player-row"
          data-user={player.user_id}
          ondragover={(e) => {
            e.preventDefault();
            over = player.user_id;
          }}
          ondragleave={() => (over = null)}
          ondrop={(e) => drop(e, player.user_id)}
        >
          <div class="line">
            <strong>{player.username}</strong>
            <span class="badge" data-status={player.status}>{playerStatusLabel(player.status)}</span
            >
            {#if player.status === 'connected'}
              <span class="small" class:muted={!player.ready}>
                {player.ready ? t('sessions.players.is_ready') : t('sessions.players.not_ready')}
              </span>
            {/if}
            {#if player.status !== 'kicked'}
              <button
                type="button"
                class="button button-small"
                onclick={() => kick(player.user_id)}
                aria-label={t('sessions.players.kick_named', { name: player.username })}
                >{t('sessions.players.kick')}</button
              >
            {/if}
          </div>
          {#if tokens.length > 0}
            <ul class="chips">
              {#each tokens as token (token.id)}
                <li>
                  <span
                    class="chip"
                    draggable="true"
                    role="listitem"
                    ondragstart={(e) => {
                      dragged = token.id;
                      e.dataTransfer?.setData('text/plain', token.id);
                    }}
                    ondragend={() => (dragged = null)}>{token.name}</span
                  >
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <h3>{t('sessions.players.assignments')}</h3>
  {#if snap === null || Object.keys(snap.definitions).length === 0}
    <p class="muted small">{t('sessions.players.no_tokens')}</p>
  {:else}
    <p class="muted small">{t('sessions.players.drag_hint')}</p>
    <ul class="assign">
      {#each Object.values(snap.definitions) as token (token.id)}
        <li>
          <span
            class="chip"
            class:free={assignedTo(snap, token.id) === null}
            draggable="true"
            role="listitem"
            ondragstart={(e) => {
              dragged = token.id;
              e.dataTransfer?.setData('text/plain', token.id);
            }}
            ondragend={() => (dragged = null)}>{token.name}</span
          >
          <select
            aria-label={t('sessions.players.owner_of', { name: token.name })}
            data-testid="assign-select"
            value={assignedTo(snap, token.id) ?? ''}
            onchange={(e) => assign(token.id, e.currentTarget.value || null)}
          >
            <option value="">{t('sessions.players.nobody')}</option>
            {#each players as p (p.user_id)}
              <option value={p.user_id}>{p.username}</option>
            {/each}
          </select>
        </li>
      {/each}
    </ul>
    {#if free.length > 0}
      <p class="small muted">{t('sessions.players.unassigned', { count: free.length })}</p>
    {/if}
  {/if}
</section>

<style>
  .panel {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--font-size-sm);
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  h2,
  h3 {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .players {
    display: grid;
    gap: var(--space-2);
  }
  .players > li {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2);
    border: var(--border-width) dashed var(--color-border);
    border-radius: var(--radius-md);
  }
  .players > li.over {
    border-color: var(--color-primary);
    background: var(--color-surface-sunken);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .line .button {
    margin-left: auto;
  }
  .chips,
  .assign li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    align-items: center;
  }
  .assign {
    display: grid;
    gap: var(--space-1);
  }
  .chip {
    padding: 2px var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: 999px;
    background: var(--color-surface);
    cursor: grab;
  }
  .chip.free {
    border-style: dashed;
  }
  select {
    margin-left: auto;
    padding: 2px var(--space-1);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
  }
</style>
