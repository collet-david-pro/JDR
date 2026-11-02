<script lang="ts">
  import AssetPicker from '../AssetPicker.svelte';
  import CheckboxField from '../CheckboxField.svelte';
  import MarkdownEditor from '../MarkdownEditor.svelte';
  import Modal from '../Modal.svelte';
  import TextField from '../TextField.svelte';
  import { noteAddCommand, noteLinkOp, noteUpdateCommand } from '../../editor/model/note-commands';
  import type { MapNote, NoteAudience, NoteObject } from '../../editor/contracts-notes';
  import { MAX_NOTE_TITLE } from '../../editor/model/NotesState';
  import {
    draftOf,
    draftValues,
    emptyDraft,
    validateDraft,
    type NoteDraft,
    type NoteErrors,
  } from '../../editor/ui/note-form';
  import type { EditorSession } from '../../editor/ui/session';
  import { newObjectUid } from '../../editor/util/uid';
  import { describeError } from '../../lib/errors';
  import { gamesClient } from '../../lib/games/service';
  import { t } from '../../lib/i18n';
  import type { Asset, Member } from '../../lib/types';

  /**
   * Create / edit a note (P9b2a). Nothing is sent while typing: Save makes one undoable command.
   * `linkObject`: uid of the pin / zone / trap / secret the new note is linked to.
   */
  interface Props {
    open: boolean;
    session: EditorSession;
    /** Game of the map; null: no list of players, so no "some players" audience. */
    gameId: string | null;
    /** null: new note. */
    note: MapNote | null;
    linkObject?: string | null;
  }

  let { open = $bindable(), session, gameId, note, linkObject = null }: Props = $props();

  let draft = $state<NoteDraft>(emptyDraft());
  let errors = $state.raw<NoteErrors>({});
  let imageUrl = $state<string | null>(null);
  let pickerOpen = $state(false);
  let members = $state.raw<readonly Member[] | null>(null);
  let membersError = $state<string | null>(null);

  $effect(() => {
    if (!open) return;
    draft = note === null ? emptyDraft() : draftOf(note);
    errors = {};
    imageUrl = null;
  });

  // The players of the game, loaded when the audience asks for them.
  $effect(() => {
    if (!open || gameId === null || draft.audience !== 'players' || members !== null) return;
    gamesClient()
      .members(gameId)
      .then((list) => {
        members = list.filter((m) => m.role !== 'gm');
      })
      .catch((e: unknown) => {
        membersError = describeError(e, t).message;
      });
  });

  const audiences = $derived<NoteAudience[]>(
    gameId === null ? ['gm', 'all'] : ['gm', 'players', 'all'],
  );

  function audienceText(a: NoteAudience): string {
    switch (a) {
      case 'gm':
        return t('editor.notes.audience.gm');
      case 'players':
        return t('editor.notes.audience.players');
      case 'all':
        return t('editor.notes.audience.all');
    }
  }

  function errorText(code: 'required' | 'too_long' | undefined): string | null {
    if (code === 'required') return t('validation.required');
    if (code === 'too_long') return t('validation.too_long');
    return null;
  }

  function toggleUser(id: string, on: boolean): void {
    draft.audience_users = on
      ? [...new Set([...draft.audience_users, id])]
      : draft.audience_users.filter((u) => u !== id);
  }

  function pick(asset: Asset): void {
    draft.asset_id = asset.id;
    imageUrl = asset.urls.thumb;
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    errors = validateDraft(draft, gameId !== null);
    if (Object.keys(errors).length > 0) return;
    const values = draftValues(draft);
    if (note === null) {
      const uid = newObjectUid();
      const base = noteAddCommand({ uid, ...values });
      const target = linkObject === null ? undefined : session.doc.object(linkObject);
      const link =
        target !== undefined && 'note' in target.props
          ? [noteLinkOp(target as NoteObject, uid)]
          : [];
      session.history.execute({ ...base, ops: [...base.ops, ...link] });
    } else {
      const command = noteUpdateCommand(note, values);
      if (command !== null) session.history.execute(command);
    }
    open = false;
  }
</script>

<Modal
  bind:open
  title={note === null ? t('editor.notes.create_title') : t('editor.notes.edit_title')}
>
  <form class="stack" novalidate onsubmit={submit} data-testid="note-dialog">
    <TextField
      label={t('editor.notes.title')}
      name="title"
      bind:value={draft.title}
      required
      maxlength={MAX_NOTE_TITLE}
      autocomplete="off"
      error={errorText(errors.title)}
    />

    <MarkdownEditor
      label={t('editor.notes.body')}
      bind:value={draft.body}
      error={errorText(errors.body)}
    />

    <div class="image-row">
      <button type="button" class="button button-small" onclick={() => (pickerOpen = true)}>
        {draft.asset_id ? t('editor.notes.image_change') : t('editor.notes.image_choose')}
      </button>
      {#if draft.asset_id}
        {#if imageUrl}<img src={imageUrl} alt="" width="48" height="48" />{/if}
        <button
          type="button"
          class="button button-small button-ghost"
          onclick={() => {
            draft.asset_id = null;
            imageUrl = null;
          }}>{t('editor.notes.image_remove')}</button
        >
      {/if}
    </div>

    <CheckboxField
      label={t('editor.notes.read_aloud')}
      hint={t('editor.notes.read_aloud_hint')}
      bind:checked={draft.read_aloud}
    />

    <fieldset>
      <legend>{t('editor.notes.audience.title')}</legend>
      {#each audiences as a (a)}
        <label class="choice">
          <input
            type="radio"
            name="audience"
            value={a}
            bind:group={draft.audience}
            data-testid={`audience-${a}`}
          />
          {audienceText(a)}
        </label>
      {/each}
      <p class="small muted">{t('editor.notes.audience.hint')}</p>
      {#if draft.audience === 'players'}
        {#if membersError}
          <p class="small" role="alert">{membersError}</p>
        {:else if members === null}
          <p class="small muted" aria-busy="true">{t('common.loading')}</p>
        {:else if members.length === 0}
          <p class="small muted">{t('editor.notes.audience.no_players')}</p>
        {:else}
          <ul class="players">
            {#each members as m (m.user.id)}
              <li>
                <CheckboxField
                  label={m.user.username}
                  checked={draft.audience_users.includes(m.user.id)}
                  onchange={(on) => toggleUser(m.user.id, on)}
                />
              </li>
            {/each}
          </ul>
        {/if}
        {#if errors.audience_users}
          <p class="error" role="alert">{t('editor.notes.audience.pick_one')}</p>
        {/if}
      {/if}
    </fieldset>

    <div class="row actions">
      <button type="button" class="button" onclick={() => (open = false)}>
        {t('common.cancel')}
      </button>
      <button type="submit" class="button button-primary" data-testid="note-save">
        {t('common.save')}
      </button>
    </div>
  </form>
</Modal>

<AssetPicker bind:open={pickerOpen} kind="background" onpick={pick} />

<style>
  .image-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .image-row img {
    object-fit: cover;
    border-radius: var(--radius-sm);
  }
  fieldset {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .choice {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .players {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 10rem;
    overflow: auto;
  }
  .actions {
    justify-content: flex-end;
  }
  .error {
    margin: 0;
    color: var(--color-danger);
  }
  p {
    margin: 0;
  }
</style>
