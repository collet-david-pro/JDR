<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { ConsoleTool } from '../../lib/sessions/console/console-input';
  import type { PanelProps } from '../../lib/sessions/console/panel-props';
  import { hideTokenOp, removeTokenOp, sendMapOps } from '../../lib/sessions/console/map-ops';
  import { sessionProblem } from '../../lib/sessions/labels';
  import { mapsClient } from '../../lib/maps/service';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * Console panel "Tokens": place a token of the game on the map (click on the map), hide or
   * reveal the placed ones, remove them. Placing / hiding / removing are map ops (like the
   * editor); revealing a token is the `reveal` action.
   */
  interface Props extends PanelProps {
    tool: ConsoleTool;
    ontool: (tool: ConsoleTool) => void;
  }

  let { run, send, selection, tool, ontool }: Props = $props();
  const uid = $props.id();
  const snap = $derived(run.state);
  const floor = $derived(run.scene?.floor ?? null);
  const defs = $derived(
    snap === null
      ? []
      : Object.values(snap.definitions).sort((a, b) => a.name.localeCompare(b.name)),
  );
  const placed = $derived(
    snap === null || floor === null
      ? []
      : Object.values(snap.tokens)
          .filter((tok) => tok.floor === floor)
          .map((tok) => ({ tok, name: snap.definitions[tok.token_id]?.name ?? tok.token_id })),
  );
  let tokenId = $state('');
  let hidden = $state(false);
  const placing = $derived(tool.kind === 'token');

  $effect(() => {
    if (tokenId === '' && defs[0] !== undefined) tokenId = defs[0].id;
  });

  function startPlacing(): void {
    if (tokenId !== '') ontool({ kind: 'token', tokenId, hidden });
  }

  async function ops(list: Parameters<typeof sendMapOps>[3]): Promise<void> {
    const s = run.state;
    if (s?.map == null) return;
    try {
      await sendMapOps(mapsClient(), s.map.id, s.mapRevision ?? s.map.revision, list);
    } catch (error) {
      toasts.show('error', sessionProblem(error));
    }
  }
</script>

<section class="panel" aria-labelledby={`${uid}-title`} data-testid="tokens-panel">
  <h2 id={`${uid}-title`}>{t('sessions.tokens.title')}</h2>
  {#if defs.length === 0}
    <p class="muted small">{t('sessions.tokens.no_definitions')}</p>
  {:else}
    <label class="field">
      <span>{t('sessions.tokens.definition')}</span>
      <select bind:value={tokenId} data-testid="token-definition">
        {#each defs as def (def.id)}<option value={def.id}>{def.name}</option>{/each}
      </select>
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={hidden} />
      {t('sessions.tokens.place_hidden')}
    </label>
    <div class="row">
      {#if placing}
        <button type="button" class="button button-primary" onclick={startPlacing}
          >{t('sessions.tokens.pick_another')}</button
        >
        <button type="button" class="button" onclick={() => ontool({ kind: 'select' })}
          >{t('sessions.tokens.stop_placing')}</button
        >
      {:else}
        <button
          type="button"
          class="button button-primary"
          data-testid="token-place"
          onclick={startPlacing}>{t('sessions.tokens.place')}</button
        >
      {/if}
    </div>
    {#if placing}<p class="small muted">{t('sessions.tokens.place_hint')}</p>{/if}
  {/if}

  <h3>{t('sessions.tokens.placed')}</h3>
  {#if placed.length === 0}
    <p class="muted small">{t('sessions.tokens.none_placed')}</p>
  {:else}
    <ul>
      {#each placed as { tok, name } (tok.uid)}
        <li class:selected={selection?.uid === tok.uid} data-testid="placed-token">
          <span class="name">{name}</span>
          {#if tok.hidden}<span class="badge">{t('sessions.tokens.hidden')}</span>{/if}
          {#if tok.hidden}
            <button
              type="button"
              class="button button-small"
              onclick={() => send([{ type: 'reveal', kind: 'token', uid: tok.uid }])}
              >{t('sessions.tokens.reveal')}</button
            >
          {:else}
            <button
              type="button"
              class="button button-small"
              onclick={() => ops([hideTokenOp(tok, true)])}>{t('sessions.tokens.hide')}</button
            >
          {/if}
          <button
            type="button"
            class="button button-small"
            aria-label={t('sessions.tokens.remove_named', { name })}
            onclick={() => ops([removeTokenOp(tok.uid)])}>{t('sessions.tokens.remove')}</button
          >
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .panel {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--font-size-sm);
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  h2,
  h3 {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .check,
  .row,
  li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  ul {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    padding: var(--space-1);
    border-radius: var(--radius-sm);
  }
  li.selected {
    background: var(--color-surface-sunken);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
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
