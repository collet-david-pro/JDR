<script lang="ts">
  import NoteDialog from './NoteDialog.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import MarkdownView from '../MarkdownView.svelte';
  import type { MapNote } from '../../editor/contracts-notes';
  import { linkedObjects, noteRemoveCommand } from '../../editor/model/note-commands';
  import { audienceBadge } from '../../editor/ui/note-labels';
  import { NotesView } from '../../editor/ui/notes-view.svelte';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';
  import { onDestroy, untrack } from 'svelte';

  /**
   * Notes of the map (P9b2a, GM only): list, search, add, edit, delete (with the number of
   * linked objects), and the reset of traps and secrets. Edits are undoable commands, except
   * the reset which only hides again what was revealed.
   */
  interface Props {
    session: EditorSession;
    /** Game of the map; null: no list of players to share a note with. */
    gameId: string | null;
  }

  let { session, gameId }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  const view = new NotesView(untrack(() => session.doc.notes));
  onDestroy(() => view.dispose());

  const SEARCH_FROM = 10;
  let query = $state('');
  let openUid = $state<string | null>(null);
  let dialogOpen = $state(false);
  let removing = $state.raw<MapNote | null>(null);
  let removeOpen = $state(false);

  const shown = $derived.by(() => {
    const q = query.trim().toLocaleLowerCase();
    const list = [...view.list].sort((a, b) => a.title.localeCompare(b.title));
    return q === '' ? list : list.filter((n) => n.title.toLocaleLowerCase().includes(q));
  });
  const dialogNote = $derived(view.get(ui.noteDialog?.uid ?? null) ?? null);
  const removeCount = $derived.by(() => {
    void ui.sceneVersion;
    return removing === null ? 0 : linkedObjects(session.doc, removing.uid).length;
  });

  $effect(() => {
    if (ui.noteDialog !== null) dialogOpen = true;
  });
  $effect(() => {
    if (!dialogOpen && ui.noteDialog !== null) ui.noteDialog = null;
  });

  function ask(note: MapNote): void {
    removing = note;
    removeOpen = true;
  }

  function remove(): void {
    const note = removing;
    removeOpen = false;
    removing = null;
    if (note === null) return;
    session.history.execute(noteRemoveCommand(note, linkedObjects(session.doc, note.uid)));
    if (openUid === note.uid) openUid = null;
  }

  function reset(): void {
    ui.resetSecretsOpen = false;
    session.history.applyUntracked([{ type: 'secrets.reset' }]);
    session.notify(t('editor.notes.reset_done'));
  }
</script>

<section class="panel" aria-labelledby={`${uid}-title`} data-testid="notes-panel">
  <h2 id={`${uid}-title`}>{t('editor.notes.title_panel')}</h2>

  <div class="row">
    <button
      type="button"
      class="button button-small"
      disabled={!ui.editable}
      data-testid="note-add"
      onclick={() => (ui.noteDialog = { uid: null, linkObject: null })}
    >
      {t('editor.notes.add')}
    </button>
  </div>

  {#if view.list.length > SEARCH_FROM}
    <label class="search">
      <span class="visually-hidden">{t('common.search')}</span>
      <input
        type="search"
        bind:value={query}
        placeholder={t('common.search')}
        data-testid="note-search"
      />
    </label>
  {/if}

  {#if view.list.length === 0}
    <p class="small muted">{t('editor.notes.empty')}</p>
  {:else}
    <ul data-testid="note-list">
      {#each shown as note (note.uid)}
        <li data-testid={`note-${note.uid}`}>
          <div class="head">
            <button
              type="button"
              class="name"
              aria-expanded={openUid === note.uid}
              onclick={() => (openUid = openUid === note.uid ? null : note.uid)}
            >
              {note.title}
            </button>
            <span class="badge" data-audience={note.audience}>{audienceBadge(note.audience)}</span>
          </div>
          {#if openUid === note.uid}
            <div class="body">
              <MarkdownView source={note.body} maxHeight="12rem" />
              <div class="row">
                <button
                  type="button"
                  class="button button-small"
                  disabled={!ui.editable}
                  data-testid="note-edit"
                  onclick={() => (ui.noteDialog = { uid: note.uid, linkObject: null })}
                  >{t('common.edit')}</button
                >
                <button
                  type="button"
                  class="button button-small button-danger"
                  disabled={!ui.editable}
                  data-testid="note-delete"
                  onclick={() => ask(note)}>{t('common.delete')}</button
                >
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <div class="row reset">
    <button
      type="button"
      class="button button-small"
      disabled={!ui.editable}
      data-testid="secrets-reset"
      onclick={() => (ui.resetSecretsOpen = true)}
    >
      {t('editor.notes.reset')}
    </button>
  </div>
</section>

<NoteDialog
  bind:open={dialogOpen}
  {session}
  {gameId}
  note={dialogNote}
  linkObject={ui.noteDialog?.linkObject ?? null}
/>

<ConfirmDialog
  bind:open={removeOpen}
  title={t('editor.notes.delete_title')}
  message={removeCount > 0
    ? t('editor.notes.delete_message_links', { title: removing?.title ?? '', count: removeCount })
    : t('editor.notes.delete_message', { title: removing?.title ?? '' })}
  confirmLabel={t('common.delete')}
  confirmTestId="note-delete-confirm"
  danger
  onconfirm={remove}
/>

<ConfirmDialog
  bind:open={ui.resetSecretsOpen}
  title={t('editor.notes.reset_title')}
  message={t('editor.notes.reset_message')}
  confirmLabel={t('editor.notes.reset_confirm')}
  confirmTestId="secrets-reset-confirm"
  danger
  onconfirm={reset}
/>

<style>
  .panel {
    padding: var(--space-3);
    border-bottom: var(--border-width) solid var(--color-border);
    font-size: var(--font-size-sm);
    display: grid;
    gap: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  p {
    margin: 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .search input {
    width: 100%;
  }
  ul {
    display: grid;
    gap: 2px;
    max-height: 16rem;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  .head {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    justify-content: space-between;
  }
  .name {
    flex: 1;
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .badge {
    flex: none;
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--color-surface-sunken);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }
  .body {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2) var(--space-2);
  }
  .reset {
    padding-top: var(--space-2);
    border-top: var(--border-width) solid var(--color-border);
  }
</style>
