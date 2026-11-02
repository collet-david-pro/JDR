<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from '../Modal.svelte';
  import MarkdownView from '../MarkdownView.svelte';
  import { t } from '../../lib/i18n';
  import { sessionsClient } from '../../lib/services';
  import type { SessionRun } from '../../lib/sessions/session-run.svelte';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * Notes the GM shared with this player (read only): a bar button with a counter and a panel.
   * Images come from GET /sessions/{id}/preload, read directly and cached by asset id.
   */
  interface Props {
    run: SessionRun;
  }
  let { run }: Props = $props();

  let open = $state(false);
  let current = $state<string | null>(null);
  let urls = $state.raw<Readonly<Record<string, string>>>({});
  let loaded = false;
  const tried: string[] = [];
  let known: ReadonlySet<string> | null = null;

  const notes = $derived(
    Object.values(run.state?.notes ?? {}).sort((a, b) => a.title.localeCompare(b.title)),
  );
  const selected = $derived(current === null ? undefined : run.state?.notes[current]);

  /** Opens a note (also called by the click on a pin of the map). */
  export function show(uid: string): void {
    if (run.state?.notes[uid] === undefined) return;
    current = uid;
    open = true;
  }

  // A note that disappears while it is open: back to the list.
  $effect(() => {
    if (current !== null && selected === undefined) current = null;
  });

  // Discreet toast for a note received after the first state.
  $effect(() => {
    const uids = new Set(Object.keys(run.state?.notes ?? {}));
    untrack(() => {
      if (known !== null) {
        for (const uid of uids) {
          if (!known.has(uid)) {
            toasts.info(t('play.notes.received', { title: run.state?.notes[uid]?.title ?? '' }));
          }
        }
      }
      known = uids;
    });
  });

  // Images: one read of the preload per change of the set of assets.
  $effect(() => {
    const wanted = notes.map((n) => n.asset_id).filter((a): a is string => a !== null);
    const missing = wanted.filter((id) => !(id in urls) && !tried.includes(id));
    if (missing.length === 0 || run.state === null) return;
    const id = run.state.session.id;
    untrack(() => {
      if (loaded) return;
      loaded = true;
      tried.push(...missing);
      sessionsClient()
        .preload(id)
        .then((preload) => {
          const next: Record<string, string> = { ...urls };
          for (const a of preload.assets) next[a.id] = a.url;
          urls = next;
        })
        .catch(() => undefined)
        .finally(() => (loaded = false));
    });
  });
</script>

{#if notes.length > 0}
  <button
    type="button"
    class="button button-small"
    data-testid="play-notes-button"
    onclick={() => {
      current = null;
      open = true;
    }}>{t('play.notes.button')} <span data-testid="play-notes-count">{notes.length}</span></button
  >
{/if}

<Modal bind:open title={selected?.title ?? t('play.notes.title')}>
  <div class="notes" data-testid="play-notes">
    {#if selected !== undefined}
      <MarkdownView source={selected.body} />
      {#if selected.asset_id !== null && urls[selected.asset_id] !== undefined}
        <img src={urls[selected.asset_id]} alt={selected.title} />
      {/if}
      <p>
        <button type="button" class="button" onclick={() => (current = null)}
          >{t('play.notes.back')}</button
        >
      </p>
    {:else}
      {#if notes.length === 0}<p class="muted">{t('play.notes.empty')}</p>{/if}
      <ul>
        {#each notes as note (note.uid)}
          <li>
            <button
              type="button"
              class="link"
              data-testid="play-note-item"
              onclick={() => (current = note.uid)}
              >{note.title === '' ? t('sessions.map_notes.untitled') : note.title}</button
            >
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</Modal>

<style>
  .notes {
    display: grid;
    gap: var(--space-3);
    min-width: min(28rem, 80vw);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  p {
    margin: 0;
  }
  img {
    max-width: 100%;
    max-height: 50vh;
    object-fit: contain;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--color-primary);
    font: inherit;
    cursor: pointer;
  }
</style>
