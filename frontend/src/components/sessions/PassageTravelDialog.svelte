<script lang="ts">
  import Modal from '../Modal.svelte';
  import { t } from '../../lib/i18n';
  import { mapsClient } from '../../lib/maps/service';
  import { sessionsClient } from '../../lib/services';
  import { sessionProblem } from '../../lib/sessions/labels';
  import {
    carriableTokens,
    defaultPosition,
    travelBody,
    type Passage,
  } from '../../lib/sessions/console/passages';
  import type { SessionRun } from '../../lib/sessions/session-run.svelte';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * "Emprunter" (P9a2): destination, arrival position and the tokens carried along (none by default,
   * the players' first); confirming sends change-map with the focus and the tokens.
   */
  interface Props {
    run: SessionRun;
    passage: Passage;
    /** Server id of the shown floor (the tokens carried are those posed on it). */
    floorId: string;
    onclose: () => void;
  }

  let { run, passage, floorId, onclose }: Props = $props();
  const uid = $props.id();
  const snap = $derived(run.state);
  const destination = $derived(passage.destination);
  const tokens = $derived(snap === null ? [] : carriableTokens(snap, floorId));

  // Target grid: this map's, or fetched for another map.
  // svelte-ignore state_referenced_locally
  let grid = $state.raw<{ width: number; height: number } | null>(
    passage.sameMap && snap?.map ? snap.map.grid : null,
  );
  let x = $state('');
  let y = $state('');
  let picked = $state<readonly string[]>([]);
  let open = $state(true);
  let busy = $state(false);
  let failed = $state(false);
  let positioned = false;

  $effect(() => {
    const d = destination;
    if (d === null || grid !== null) return;
    let live = true;
    mapsClient()
      .get(d.mapId)
      .then((map) => {
        if (live) grid = { width: map.grid.width, height: map.grid.height };
      })
      .catch(() => {
        if (live) failed = true;
      });
    return () => {
      live = false;
    };
  });

  $effect(() => {
    if (grid === null || positioned) return;
    positioned = true;
    const p = defaultPosition(passage, grid);
    x = String(p.x);
    y = String(p.y);
  });

  const px = $derived(Number(x));
  const py = $derived(Number(y));
  const validPosition = $derived(
    x.trim() !== '' &&
      y.trim() !== '' &&
      Number.isFinite(px) &&
      Number.isFinite(py) &&
      grid !== null &&
      px >= 0 &&
      py >= 0 &&
      px <= grid.width &&
      py <= grid.height,
  );

  function toggle(tokenUid: string, on: boolean): void {
    picked = on ? [...picked, tokenUid] : picked.filter((u) => u !== tokenUid);
  }

  async function go(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (snap === null || destination === null || !validPosition) return;
    busy = true;
    try {
      await sessionsClient().changeMap(
        snap.session.id,
        travelBody(destination, { x: px, y: py }, picked),
      );
      await run.reload();
      open = false;
    } catch (error) {
      toasts.show('error', sessionProblem(error));
    } finally {
      busy = false;
    }
  }
</script>

<Modal bind:open title={t('sessions.passages.take_title')} {onclose}>
  <form class="travel" onsubmit={(e) => void go(e)} data-testid="travel-dialog">
    <p
      data-testid="travel-destination"
      data-map={destination?.mapId ?? ''}
      data-floor={destination?.floor ?? ''}
    >
      {t('sessions.passages.leads_to', {
        place:
          [passage.mapName, passage.floorName].filter((v) => v !== null && v !== '').join(' · ') ||
          '—',
      })}
    </p>
    {#if failed}
      <p class="small" role="alert">{t('sessions.passages.target_unavailable')}</p>
    {/if}
    <fieldset class="pos">
      <legend>{t('sessions.passages.position')}</legend>
      <label>
        <span>{t('editor.link.x')}</span>
        <input type="number" min="0" step="0.5" bind:value={x} data-testid="travel-x" />
      </label>
      <label>
        <span>{t('editor.link.y')}</span>
        <input type="number" min="0" step="0.5" bind:value={y} data-testid="travel-y" />
      </label>
    </fieldset>
    <fieldset>
      <legend>{t('sessions.passages.tokens')}</legend>
      {#if tokens.length === 0}
        <p class="small muted">{t('sessions.passages.no_tokens')}</p>
      {/if}
      {#each tokens as choice (choice.token.uid)}
        <label class="choice">
          <input
            type="checkbox"
            checked={picked.includes(choice.token.uid)}
            data-testid={`travel-token-${choice.token.uid}`}
            onchange={(e) => toggle(choice.token.uid, e.currentTarget.checked)}
          />
          {choice.name}
          {#if choice.player}<span class="muted">({t('sessions.passages.player')})</span>{/if}
        </label>
      {/each}
    </fieldset>
    <div class="actions">
      <button type="button" class="button" onclick={() => (open = false)} id={`${uid}-cancel`}>
        {t('common.cancel')}
      </button>
      <button
        type="submit"
        class="button button-primary"
        disabled={busy || !validPosition || destination === null}
        data-testid="travel-confirm">{t('sessions.passages.take')}</button
      >
    </div>
  </form>
</Modal>

<style>
  .travel {
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
  .pos {
    grid-template-columns: 1fr 1fr;
  }
  .pos legend {
    grid-column: 1 / -1;
  }
  legend {
    padding: 0;
    font-weight: var(--font-weight-medium);
  }
  label {
    display: grid;
    gap: 2px;
  }
  .choice {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  p {
    margin: 0;
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
  }
  input[type='number'] {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
  }
</style>
