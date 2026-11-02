<script lang="ts">
  import Modal from '../Modal.svelte';
  import type { MapNote, NoteAudience } from '../../editor/contracts-notes';
  import { describeError } from '../../lib/errors';
  import { gamesClient } from '../../lib/games/service';
  import { t } from '../../lib/i18n';
  import type { PanelProps } from '../../lib/sessions/console/panel-props';
  import type { Member } from '../../lib/types';

  /** Audience of a note: GM only, some players, all the players (note.share). */
  interface Props extends Pick<PanelProps, 'gameId' | 'send'> {
    open: boolean;
    note: MapNote;
  }
  let { open = $bindable(), note, gameId, send }: Props = $props();
  const uid = $props.id();

  let audience = $state<NoteAudience>('gm');
  let chosen = $state<string[]>([]);
  let members = $state.raw<Member[] | null>(null);
  let problem = $state('');
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    audience = note.audience;
    chosen = [...note.audience_users];
    problem = '';
  });

  $effect(() => {
    if (!open || audience !== 'players' || members !== null) return;
    gamesClient()
      .members(gameId)
      .then((list) => {
        members = list.filter((m) => m.role !== 'gm');
      })
      .catch((e: unknown) => {
        problem = describeError(e, t).message;
      });
  });

  const valid = $derived(audience !== 'players' || chosen.length > 0);

  function toggle(id: string, on: boolean): void {
    chosen = on ? [...chosen.filter((x) => x !== id), id] : chosen.filter((x) => x !== id);
  }

  async function apply(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!valid || busy) return;
    busy = true;
    const ok = await send([
      audience === 'players'
        ? { type: 'note.share', note_uid: note.uid, audience, users: chosen }
        : { type: 'note.share', note_uid: note.uid, audience },
    ]);
    busy = false;
    if (ok) open = false;
  }
</script>

<Modal bind:open title={t('sessions.share.title', { title: note.title })}>
  <form onsubmit={apply} data-testid="note-share-dialog">
    <fieldset>
      <legend>{t('sessions.share.audience')}</legend>
      <label
        ><input type="radio" bind:group={audience} value="gm" data-testid="share-gm" />
        {t('sessions.share.gm')}</label
      >
      <label
        ><input type="radio" bind:group={audience} value="players" data-testid="share-players" />
        {t('sessions.share.players')}</label
      >
      <label
        ><input type="radio" bind:group={audience} value="all" data-testid="share-all" />
        {t('sessions.share.all')}</label
      >
    </fieldset>
    {#if audience === 'players'}
      <fieldset aria-describedby={`${uid}-hint`}>
        <legend>{t('sessions.share.who')}</legend>
        {#if members === null}
          <p class="muted small">{t('common.loading')}</p>
        {:else if members.length === 0}
          <p class="muted small">{t('sessions.share.no_players')}</p>
        {/if}
        {#each members ?? [] as member (member.user.id)}
          <label
            ><input
              type="checkbox"
              checked={chosen.includes(member.user.id)}
              data-testid="share-user"
              data-user={member.user.id}
              onchange={(e) => toggle(member.user.id, e.currentTarget.checked)}
            />
            {member.user.username}</label
          >
        {/each}
        <p id={`${uid}-hint`} class="muted small">{t('sessions.share.hint')}</p>
      </fieldset>
    {/if}
    {#if problem !== ''}<p class="alert alert-error" role="alert">{problem}</p>{/if}
    <p class="actions">
      <button type="button" class="button" onclick={() => (open = false)}
        >{t('common.cancel')}</button
      >
      <button
        type="submit"
        class="button button-primary"
        disabled={!valid || busy}
        data-testid="share-apply">{t('sessions.share.apply')}</button
      >
    </p>
  </form>
</Modal>

<style>
  form {
    display: grid;
    gap: var(--space-3);
  }
  fieldset {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    margin-bottom: var(--space-1);
    color: var(--color-text-muted);
  }
  p {
    margin: 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
