<script lang="ts">
  import PassageTravelDialog from './PassageTravelDialog.svelte';
  import { t } from '../../lib/i18n';
  import { mapsClient } from '../../lib/maps/service';
  import { passagesOf, shownFloor, type Passage } from '../../lib/sessions/console/passages';
  import type { PanelProps } from '../../lib/sessions/console/panel-props';
  import type { MapLinks } from '../../lib/types';

  /**
   * Console panel "Passages" (P9a2): the stairs, portals and linked doors of the shown floor with where
   * they lead; "Emprunter" opens the travel dialog. A broken link is flagged and cannot be taken. Selecting
   * a stairs or a portal on the console map does the same.
   */
  let { run, selection }: PanelProps = $props();
  const uid = $props.id();
  const snap = $derived(run.state);
  const floorId = $derived(snap === null ? null : shownFloor(snap));
  let links = $state.raw<MapLinks | null>(null);
  let taking = $state.raw<Passage | null>(null);

  // Where the links lead (and which are broken): read again when the map changes.
  $effect(() => {
    const mapId = snap?.session.current_map_id ?? null;
    void snap?.mapRevision;
    if (mapId === null) {
      links = null;
      return;
    }
    let live = true;
    mapsClient()
      .links(mapId)
      .then((answer) => {
        if (live) links = answer;
      })
      .catch(() => {
        if (live) links = null;
      });
    return () => {
      live = false;
    };
  });

  const passages = $derived(
    snap === null || floorId === null ? [] : passagesOf(snap, floorId, links),
  );

  // A stairs or a portal selected on the map is taken like from the list.
  $effect(() => {
    if (selection === null || selection.kind !== 'object') return;
    const hit = passages.find((p) => p.uid === selection.uid && p.type !== 'door');
    if (hit !== undefined && hit.destination !== null) taking = hit;
  });

  function kindLabel(p: Passage): string {
    switch (p.type) {
      case 'stairs':
        return t('editor.objects.types.stairs');
      case 'portal':
        return t('editor.objects.types.portal');
      case 'door':
        return t('editor.objects.types.door');
    }
  }

  function place(p: Passage): string {
    return [p.mapName, p.floorName].filter((v) => v !== null && v !== '').join(' · ');
  }
</script>

<section class="panel" aria-labelledby={`${uid}-title`} data-testid="passages-panel">
  <h2 id={`${uid}-title`}>{t('sessions.passages.title')}</h2>
  {#if passages.length === 0}
    <p class="small muted">{t('sessions.passages.none')}</p>
  {:else}
    <ul>
      {#each passages as p (p.uid)}
        <li data-testid={`passage-${p.uid}`}>
          <div class="info">
            <strong>{kindLabel(p)}</strong>
            {#if p.destination === null}
              <span class="broken" data-testid={`passage-broken-${p.uid}`}
                >{t('sessions.passages.broken')}</span
              >
            {:else}
              <span class="muted"
                >{t('sessions.passages.leads_to', { place: place(p) || '—' })}</span
              >
            {/if}
          </div>
          <button
            type="button"
            class="button button-small"
            disabled={p.destination === null}
            data-testid={`passage-take-${p.uid}`}
            onclick={() => (taking = p)}>{t('sessions.passages.take')}</button
          >
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if taking !== null && floorId !== null}
  <PassageTravelDialog {run} passage={taking} {floorId} onclose={() => (taking = null)} />
{/if}

<style>
  .panel {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--font-size-sm);
  }
  h2,
  p {
    margin: 0;
  }
  h2 {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  ul {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    justify-content: space-between;
  }
  .info {
    display: grid;
    gap: 2px;
  }
  .broken {
    color: var(--color-danger, #b3261e);
  }
</style>
