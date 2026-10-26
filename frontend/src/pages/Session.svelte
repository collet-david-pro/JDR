<script lang="ts">
  import Forbidden from './Forbidden.svelte';
  import NotFound from './NotFound.svelte';
  import PlayerSession from '../components/play/PlayerSession.svelte';
  import SessionConsole from '../components/sessions/SessionConsole.svelte';
  import { ApiError } from '../lib/api';
  import { describeError } from '../lib/errors';
  import { t } from '../lib/i18n';
  import type { PageProps } from '../lib/page';
  import { services, sessionsClient } from '../lib/services';
  import type { Session } from '../lib/sessions';

  /**
   * Session page (/sessions/:id). The GM (and co-GM) get the console; the players get the lobby and the game
   * view (components/play).
   */
  let { params }: PageProps = $props();
  const { auth } = services();

  type Status = 'loading' | 'not_found' | 'forbidden' | 'error' | 'ready';
  let status = $state<Status>('loading');
  let error = $state.raw<unknown>(null);
  let session = $state.raw<Session | null>(null);
  const failure = $derived(error === null ? null : describeError(error, t));
  const id = $derived(params['id'] ?? '');
  const userId = $derived(auth.user?.id ?? '');

  async function load(sessionId: string): Promise<void> {
    status = 'loading';
    error = null;
    try {
      session = await sessionsClient().get(sessionId);
      status = 'ready';
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
    void load(id);
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
    <button type="button" class="button" onclick={() => load(id)}>{t('common.retry')}</button>
  </section>
{:else if status === 'loading' || session === null}
  <p class="muted" aria-busy="true">{t('common.loading')}</p>
{:else if session.role === 'gm'}
  {#key session.id}
    <SessionConsole sessionId={session.id} gameId={session.game_id} {userId} />
  {/key}
{:else}
  {#key session.id}
    <PlayerSession sessionId={session.id} gameId={session.game_id} {userId} />
  {/key}
{/if}
