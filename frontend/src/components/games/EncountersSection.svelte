<script lang="ts">
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import EncounterDialog from './EncounterDialog.svelte';
  import type { GamePageModel } from '../../lib/games/game-page.svelte';
  import { t } from '../../lib/i18n';
  import type { Encounter, EncounterInput } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';

  /** Prepared encounters: groups of tokens with relative positions (no stats). */
  interface Props {
    model: GamePageModel;
  }

  let { model }: Props = $props();

  const names = $derived(new Map(model.tokens.map((token) => [token.id, token.name])));

  let editing = $state.raw<Encounter | null>(null);
  let dialogOpen = $state(false);
  let deleting = $state.raw<Encounter | null>(null);
  let confirmOpen = $state(false);
  let busy = $state(false);

  function create(): void {
    editing = null;
    dialogOpen = true;
  }

  function edit(encounter: Encounter): void {
    editing = encounter;
    dialogOpen = true;
  }

  async function save(input: EncounterInput): Promise<Encounter> {
    const encounter =
      editing === null
        ? await model.createEncounter(input)
        : await model.updateEncounter(editing.id, input);
    toasts.success(t('games.encounters.saved', { name: encounter.name }));
    return encounter;
  }

  function askDelete(encounter: Encounter): void {
    deleting = encounter;
    confirmOpen = true;
  }

  async function remove(): Promise<void> {
    const encounter = deleting;
    if (encounter === null) return;
    busy = true;
    try {
      await model.deleteEncounter(encounter.id);
      confirmOpen = false;
      toasts.success(t('games.encounters.deleted', { name: encounter.name }));
    } catch (error) {
      toasts.error(error);
    } finally {
      busy = false;
    }
  }

  function composition(encounter: Encounter): string {
    const list = encounter.tokens.map((p) => names.get(p.token_id) ?? '?');
    return list.length === 0 ? t('games.encounters.no_tokens') : list.join(', ');
  }
</script>

<section class="stack" aria-labelledby="encounters-title">
  <div class="section-head">
    <h2 id="encounters-title">{t('games.encounters.title')}</h2>
    <button
      type="button"
      class="button"
      onclick={create}
      disabled={model.tokens.length === 0}
      aria-describedby={model.tokens.length === 0 ? 'encounters-need-tokens' : undefined}
    >
      {t('games.encounters.create')}
    </button>
  </div>
  <p class="small muted">{t('games.encounters.intro')}</p>
  {#if model.tokens.length === 0}
    <p id="encounters-need-tokens" class="small muted">{t('games.encounters.need_tokens')}</p>
  {/if}
  {#if model.listsLoaded && model.encounters.length === 0}
    <p class="muted">{t('games.encounters.empty')}</p>
  {:else}
    <ul class="list">
      {#each model.encounters as encounter (encounter.id)}
        <li class="item">
          <div class="info">
            <h3>{encounter.name}</h3>
            <p class="small muted">
              {t('games.encounters.count', { count: encounter.tokens.length })} · {composition(
                encounter,
              )}
            </p>
            {#if encounter.notes}<p class="small notes">{encounter.notes}</p>{/if}
          </div>
          <div class="row actions">
            <button
              type="button"
              class="button button-small"
              onclick={() => edit(encounter)}
              aria-label={t('games.encounters.edit_named', { name: encounter.name })}
              >{t('common.edit')}</button
            >
            <button
              type="button"
              class="button button-small button-ghost"
              onclick={() => askDelete(encounter)}
              aria-label={t('games.encounters.delete_named', { name: encounter.name })}
              >{t('common.delete')}</button
            >
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<EncounterDialog bind:open={dialogOpen} encounter={editing} tokens={model.tokens} onsave={save} />

<ConfirmDialog
  bind:open={confirmOpen}
  title={t('games.encounters.delete_title')}
  message={t('games.encounters.delete_text', { name: deleting?.name ?? '' })}
  confirmLabel={t('common.delete')}
  danger
  {busy}
  onconfirm={remove}
/>

<style>
  .section-head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-lg);
  }
  p {
    margin: 0;
  }
  .list {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .item {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
  }
  .info {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
    flex: 1 1 16rem;
  }
  h3 {
    margin: 0;
    font-size: var(--font-size-md);
  }
  .notes {
    white-space: pre-line;
  }
</style>
