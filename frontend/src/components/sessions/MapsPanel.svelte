<script lang="ts">
  import { onMount } from 'svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import { t } from '../../lib/i18n';
  import { mapsClient } from '../../lib/maps/service';
  import { sessionsClient } from '../../lib/services';
  import { sessionProblem } from '../../lib/sessions/labels';
  import type { PanelProps } from '../../lib/sessions/console/panel-props';
  import type { MapSummary } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';

  /** Console panel "Maps": change the map or the floor shown to everybody. */
  let { run, gameId }: PanelProps = $props();
  const uid = $props.id();
  const snap = $derived(run.state);
  const current = $derived(snap?.session.current_map_id ?? null);
  const floors = $derived(snap?.map?.floors ?? []);
  const currentFloor = $derived(snap?.session.current_floor_id ?? floors[0]?.id ?? null);
  let maps = $state.raw<readonly MapSummary[]>([]);
  let failed = $state(false);
  let target = $state('');
  let confirmOpen = $state(false);
  let busy = $state(false);

  onMount(() => {
    mapsClient()
      .list(gameId)
      .then((list) => {
        maps = list;
      })
      .catch(() => {
        failed = true;
      });
  });

  $effect(() => {
    if (target === '' && current !== null) target = current;
  });

  async function change(mapId: string, floorId?: string): Promise<void> {
    if (snap === null) return;
    busy = true;
    try {
      await sessionsClient().changeMap(snap.session.id, mapId, floorId);
      confirmOpen = false;
      await run.reload();
    } catch (error) {
      toasts.show('error', sessionProblem(error));
    } finally {
      busy = false;
    }
  }
</script>

<section class="panel" aria-labelledby={`${uid}-title`} data-testid="maps-panel">
  <h2 id={`${uid}-title`}>{t('sessions.maps.title')}</h2>
  {#if failed}
    <p class="small muted">{t('sessions.maps.unavailable')}</p>
  {:else if maps.length === 0}
    <p class="small muted">{t('sessions.maps.none')}</p>
  {:else}
    <label class="field">
      <span>{t('sessions.maps.map')}</span>
      <select bind:value={target} data-testid="maps-select">
        {#each maps as map (map.id)}
          <option value={map.id}
            >{map.name}{map.id === current ? ` (${t('sessions.maps.current')})` : ''}</option
          >
        {/each}
      </select>
    </label>
    <button
      type="button"
      class="button button-primary"
      disabled={target === '' || target === current || busy}
      data-testid="maps-change"
      onclick={() => (confirmOpen = true)}>{t('sessions.maps.change')}</button
    >
  {/if}
  {#if floors.length > 1 && current !== null}
    <label class="field">
      <span>{t('sessions.maps.floor')}</span>
      <select
        value={currentFloor ?? ''}
        onchange={(e) => change(current, e.currentTarget.value)}
        disabled={busy}
      >
        {#each floors as floor (floor.id)}<option value={floor.id}>{floor.name}</option>{/each}
      </select>
    </label>
  {/if}
</section>

<ConfirmDialog
  bind:open={confirmOpen}
  title={t('sessions.maps.confirm_title')}
  message={t('sessions.maps.confirm_text')}
  confirmLabel={t('sessions.maps.change')}
  {busy}
  onconfirm={() => change(target)}
/>

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
  .field {
    display: grid;
    gap: var(--space-1);
  }
  select {
    padding: 2px var(--space-1);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
  }
</style>
