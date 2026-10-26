<script lang="ts">
  import { onMount } from 'svelte';
  import SessionsNewDialog from './SessionsNewDialog.svelte';
  import { describeError } from '../../lib/errors';
  import { formatDateTime } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import { href, services, sessionsClient } from '../../lib/services';
  import type { Session } from '../../lib/sessions';
  import { isOpenSession, sessionStateLabel } from '../../lib/sessions/labels';
  import type { Game } from '../../lib/types';

  /** "Séances" tab of the game page (GM / co-GM): history and "Nouvelle séance". */
  interface Props {
    game: Game;
  }

  let { game }: Props = $props();
  const { router } = services();

  let sessions = $state.raw<readonly Session[]>([]);
  let nextCursor = $state<string | null>(null);
  let loaded = $state(false);
  let error = $state.raw<unknown>(null);
  let creating = $state(false);
  let loadingMore = $state(false);
  const failure = $derived(error === null ? null : describeError(error, t));
  const open = $derived(sessions.find((s) => isOpenSession(s.state)) ?? null);

  const sessionHref = (id: string): string => href(`/sessions/${encodeURIComponent(id)}`);

  async function load(): Promise<void> {
    error = null;
    try {
      const page = await sessionsClient().list(game.id);
      sessions = page.items;
      nextCursor = page.nextCursor;
    } catch (e) {
      error = e;
    } finally {
      loaded = true;
    }
  }

  async function more(): Promise<void> {
    if (nextCursor === null) return;
    loadingMore = true;
    try {
      const page = await sessionsClient().list(game.id, { cursor: nextCursor });
      sessions = [...sessions, ...page.items];
      nextCursor = page.nextCursor;
    } catch (e) {
      error = e;
    } finally {
      loadingMore = false;
    }
  }

  function exists(sessionId: string | null): void {
    if (sessionId !== null) router.navigate(`/sessions/${encodeURIComponent(sessionId)}`);
    else void load();
  }

  onMount(() => void load());
</script>

<section class="sessions" aria-labelledby="sessions-title" data-testid="sessions-tab">
  <div class="head">
    <h2 id="sessions-title">{t('sessions.tab.title')}</h2>
    <button
      type="button"
      class="button button-primary"
      data-testid="new-session"
      disabled={open !== null}
      onclick={() => (creating = true)}>{t('sessions.tab.new')}</button
    >
  </div>

  {#if open !== null}
    <div class="alert alert-info row" role="status" data-testid="open-session">
      <span>{t('sessions.tab.open_exists', { name: open.name })}</span>
      <a class="button button-primary" href={sessionHref(open.id)}>{t('sessions.tab.open')}</a>
    </div>
  {/if}

  {#if failure}
    <div class="alert alert-error row" role="alert">
      <span>{failure.message}</span>
      <button type="button" class="button button-small" onclick={load}>{t('common.retry')}</button>
    </div>
  {:else if !loaded}
    <p class="muted" aria-busy="true">{t('common.loading')}</p>
  {:else if sessions.length === 0}
    <p class="muted" data-testid="sessions-empty">{t('sessions.tab.empty')}</p>
  {:else}
    <ul class="list">
      {#each sessions as session (session.id)}
        <li class="card" data-testid="session-item" data-state={session.state}>
          <div class="info">
            <strong>{session.name}</strong>
            <span class="badge">{sessionStateLabel(session.state)}</span>
            <span class="small muted">{formatDateTime(session.created_at)}</span>
          </div>
          <a class="button button-small" href={sessionHref(session.id)}
            >{isOpenSession(session.state) ? t('sessions.tab.open') : t('sessions.tab.view')}</a
          >
        </li>
      {/each}
    </ul>
    {#if nextCursor !== null}
      <button type="button" class="button" disabled={loadingMore} onclick={more}
        >{t('common.load_more')}</button
      >
    {/if}
  {/if}
</section>

<SessionsNewDialog
  bind:open={creating}
  gameId={game.id}
  oncreate={(input) => sessionsClient().create(game.id, input)}
  oncreated={(session) => router.navigate(`/sessions/${encodeURIComponent(session.id)}`)}
  onexists={exists}
/>

<style>
  .sessions {
    display: grid;
    gap: var(--space-3);
  }
  .head,
  .row,
  li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
  }
  .list {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .info {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
</style>
