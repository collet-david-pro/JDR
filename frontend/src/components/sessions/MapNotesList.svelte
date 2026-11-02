<script lang="ts">
  import MarkdownView from '../MarkdownView.svelte';
  import NoteShareDialog from './NoteShareDialog.svelte';
  import type { MapNote } from '../../editor/contracts-notes';
  import { audienceBadge } from '../../editor/ui/note-labels';
  import { t } from '../../lib/i18n';
  import { consoleUi } from '../../lib/sessions/console/console-ui.svelte';
  import type { PanelProps } from '../../lib/sessions/console/panel-props';

  /**
   * Notes of the map (GM): title, audience, preview, "Read" (note.show, audience unchanged) and
   * "Share" (note.share). Notes are edited in the map editor, not here.
   */
  interface Props extends Pick<PanelProps, 'run' | 'gameId' | 'send'> {
    /** Note to unfold (a pin or a zone selected on the map). */
    focus?: string | null;
  }
  let { run, gameId, send, focus = null }: Props = $props();

  let opened = $state<string | null>(null);
  let sharing = $state.raw<MapNote | null>(null);
  let shareOpen = $state(false);

  const notes = $derived(
    Object.values(run.state?.notes ?? {})
      .filter((n): n is MapNote => 'audience' in n)
      .sort((a, b) => a.title.localeCompare(b.title)),
  );

  $effect(() => {
    if (focus !== null && focus in (run.state?.notes ?? {})) opened = focus;
  });

  // Palette: "share this note" opens the share dialog.
  $effect(() => {
    const requested = consoleUi.shareRequest;
    const note = requested === null ? undefined : notes.find((n) => n.uid === requested);
    if (note === undefined) return;
    consoleUi.shareRequest = null;
    share(note);
  });

  function share(note: MapNote): void {
    sharing = note;
    shareOpen = true;
  }
</script>

<section class="notes" aria-label={t('sessions.map_notes.title')} data-testid="map-notes">
  <h3>{t('sessions.map_notes.title')}</h3>
  {#if notes.length === 0}
    <p class="muted small">{t('sessions.map_notes.empty')}</p>
  {/if}
  <ul>
    {#each notes as note (note.uid)}
      <li data-testid="map-note" data-uid={note.uid} data-audience={note.audience}>
        <div class="head">
          <button
            type="button"
            class="link"
            aria-expanded={opened === note.uid}
            onclick={() => (opened = opened === note.uid ? null : note.uid)}
            >{note.title === '' ? t('sessions.map_notes.untitled') : note.title}</button
          >
          <span class="badge" data-testid="map-note-audience">{audienceBadge(note.audience)}</span>
        </div>
        {#if opened === note.uid}
          <MarkdownView source={note.body} maxHeight="12rem" />
        {/if}
        <div class="row">
          <button
            type="button"
            class="button button-small"
            data-testid="map-note-read"
            onclick={() => send([{ type: 'note.show', note_uid: note.uid }])}
            >{t('sessions.map_notes.read')}</button
          >
          <button
            type="button"
            class="button button-small"
            data-testid="map-note-share"
            onclick={() => share(note)}>{t('sessions.map_notes.share')}</button
          >
        </div>
      </li>
    {/each}
  </ul>
</section>

{#if sharing !== null}
  <NoteShareDialog
    bind:open={shareOpen}
    note={notes.find((n) => n.uid === sharing?.uid) ?? sharing}
    {gameId}
    {send}
  />
{/if}

<style>
  .notes {
    display: grid;
    gap: var(--space-2);
  }
  h3 {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  li {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
  }
  .head,
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--color-primary);
    font: inherit;
    font-weight: var(--font-weight-medium);
    cursor: pointer;
    text-align: start;
  }
  .badge {
    font-size: var(--font-size-xs, 0.75rem);
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-surface-sunken);
    color: var(--color-text-muted);
  }
  p {
    margin: 0;
  }
</style>
