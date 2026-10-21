<script lang="ts">
  import Button from '../Button.svelte';
  import ErrorAlert from '../ErrorAlert.svelte';
  import Modal from '../Modal.svelte';
  import TextAreaField from '../TextAreaField.svelte';
  import TextField from '../TextField.svelte';
  import EncounterGrid from './EncounterGrid.svelte';
  import { FormState } from '../../lib/form.svelte';
  import {
    ENCOUNTER_NAME_MAX,
    firstFreeCell,
    isPlaced,
    nudgeToken,
    parseOffset,
    placeToken,
    prunePlacements,
    removeToken,
    tokensAt,
    validateEncounter,
    type Cell,
  } from '../../lib/games/encounter-grid';
  import { t } from '../../lib/i18n';
  import type { Encounter, EncounterInput, EncounterToken, Token } from '../../lib/types';

  /** Encounter form: name, notes and composition (tokens + relative positions in cells). */
  interface Props {
    open: boolean;
    /** null: new encounter. */
    encounter: Encounter | null;
    tokens: readonly Token[];
    onsave: (input: EncounterInput) => Promise<Encounter>;
  }

  let { open = $bindable(), encounter, tokens, onsave }: Props = $props();

  let name = $state('');
  let notes = $state('');
  let placements = $state.raw<EncounterToken[]>([]);
  let selectedId = $state<string | null>(null);
  let addId = $state('');
  /** Invalid numeric offsets typed by the user (token id → field). */
  let offsetErrors = $state.raw<Readonly<Record<string, 'dx' | 'dy'>>>({});
  let formEl: HTMLFormElement | undefined = $state();
  const form = new FormState();
  const uid = $props.id();

  const names = $derived(new Map(tokens.map((token) => [token.id, token.name])));
  const available = $derived(tokens.filter((token) => !isPlaced(placements, token.id)));

  $effect(() => {
    if (open) {
      name = encounter?.name ?? '';
      notes = encounter?.notes ?? '';
      placements = prunePlacements(encounter?.tokens ?? [], new Set(tokens.map((tk) => tk.id)));
      selectedId = null;
      addId = '';
      offsetErrors = {};
      form.reset();
    }
  });

  function add(): void {
    const id = addId || available[0]?.id;
    if (!id) return;
    const cell = firstFreeCell(placements);
    placements = placeToken(placements, id, cell.dx, cell.dy);
    selectedId = id;
    addId = '';
  }

  function remove(id: string): void {
    placements = removeToken(placements, id);
    if (selectedId === id) selectedId = null;
  }

  /** Grid cell activated: place the selected token there, or select the token of the cell. */
  function activate(cell: Cell): void {
    if (selectedId !== null) {
      placements = placeToken(placements, selectedId, cell.dx, cell.dy);
      return;
    }
    selectedId = tokensAt(placements, cell)[0] ?? null;
  }

  function setOffset(id: string, axis: 'dx' | 'dy', text: string): void {
    const value = parseOffset(text);
    const current = placements.find((p) => p.token_id === id);
    if (current === undefined) return;
    if (value === null) {
      offsetErrors = { ...offsetErrors, [id]: axis };
      return;
    }
    const { [id]: _removed, ...rest } = offsetErrors;
    offsetErrors = rest;
    placements =
      axis === 'dx'
        ? placeToken(placements, id, value, current.dy)
        : placeToken(placements, id, current.dx, value);
  }

  function rowKeydown(event: KeyboardEvent, id: string): void {
    if (!event.altKey) return;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    placements = nudgeToken(placements, id, move[0], move[1]);
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const holder: { input: EncounterInput | null } = { input: null };
    const ok = await form.submit(
      async () => {
        if (holder.input !== null) await onsave(holder.input);
      },
      {
        form: formEl,
        validate: () => {
          if (Object.keys(offsetErrors).length > 0) return { offsets: 'invalid' };
          const result = validateEncounter(name, notes, placements);
          if (!result.ok) return result.errors;
          holder.input = result.input;
          return {};
        },
      },
    );
    if (ok) open = false;
  }
</script>

<Modal
  bind:open
  title={encounter === null ? t('games.encounters.create_title') : t('games.encounters.edit_title')}
>
  <form class="stack" novalidate bind:this={formEl} onsubmit={submit}>
    <TextField
      label={t('games.encounters.name')}
      name="name"
      bind:value={name}
      required
      maxlength={ENCOUNTER_NAME_MAX}
      autocomplete="off"
      error={form.message('name')}
    />
    <TextAreaField
      label={t('games.encounters.notes')}
      name="notes"
      bind:value={notes}
      rows={3}
      error={form.message('notes')}
    />

    <fieldset class="stack">
      <legend>{t('games.encounters.composition')}</legend>
      <div class="row add">
        <label class="visually-hidden" for={`${uid}-add`}>{t('games.encounters.add_label')}</label>
        <select id={`${uid}-add`} bind:value={addId} disabled={available.length === 0}>
          <option value="">{t('games.encounters.add_placeholder')}</option>
          {#each available as token (token.id)}
            <option value={token.id}>{token.name}</option>
          {/each}
        </select>
        <button
          type="button"
          class="button button-small"
          onclick={add}
          disabled={available.length === 0}>{t('games.encounters.add')}</button
        >
      </div>

      {#if placements.length === 0}
        <p class="small muted">{t('games.encounters.no_tokens')}</p>
      {:else}
        <p id={`${uid}-help`} class="small muted">{t('games.encounters.grid.help')}</p>
        <ul class="placements" aria-describedby={`${uid}-help`}>
          {#each placements as placement (placement.token_id)}
            {@const tokenName = names.get(placement.token_id) ?? '?'}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <li
              class:selected={selectedId === placement.token_id}
              onkeydown={(event) => rowKeydown(event, placement.token_id)}
            >
              <button
                type="button"
                class="button button-small select"
                aria-pressed={selectedId === placement.token_id}
                onclick={() =>
                  (selectedId = selectedId === placement.token_id ? null : placement.token_id)}
              >
                {tokenName}
              </button>
              <label class="offset">
                <span>dx</span>
                <input
                  inputmode="decimal"
                  value={String(placement.dx)}
                  aria-label={t('games.encounters.dx_of', { name: tokenName })}
                  aria-invalid={offsetErrors[placement.token_id] === 'dx' ? 'true' : undefined}
                  onchange={(event) =>
                    setOffset(placement.token_id, 'dx', event.currentTarget.value)}
                />
              </label>
              <label class="offset">
                <span>dy</span>
                <input
                  inputmode="decimal"
                  value={String(placement.dy)}
                  aria-label={t('games.encounters.dy_of', { name: tokenName })}
                  aria-invalid={offsetErrors[placement.token_id] === 'dy' ? 'true' : undefined}
                  onchange={(event) =>
                    setOffset(placement.token_id, 'dy', event.currentTarget.value)}
                />
              </label>
              <button
                type="button"
                class="button button-small button-ghost"
                onclick={() => remove(placement.token_id)}
                aria-label={t('games.encounters.remove_named', { name: tokenName })}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          {/each}
        </ul>
        {#if Object.keys(offsetErrors).length > 0 || form.errors['offsets']}
          <p class="small error" role="alert">{t('games.encounters.offset_invalid')}</p>
        {/if}
        {#if form.errors['tokens']}
          <p class="small error" role="alert">{t('games.encounters.too_many')}</p>
        {/if}
        <p class="small muted" aria-live="polite">
          {#if selectedId !== null}
            {t('games.encounters.grid.placing', { name: names.get(selectedId) ?? '?' })}
          {:else}
            {t('games.encounters.grid.select_first')}
          {/if}
        </p>
        <EncounterGrid {placements} {names} {selectedId} onactivate={activate} />
      {/if}
    </fieldset>

    <ErrorAlert failure={form.failure} />
    <div class="row actions">
      <button type="button" class="button" onclick={() => (open = false)}>
        {t('common.cancel')}
      </button>
      <Button type="submit" variant="primary" loading={form.submitting}>{t('common.save')}</Button>
    </div>
  </form>
</Modal>

<style>
  fieldset {
    margin: 0;
    padding: var(--space-3) var(--space-4) var(--space-4);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }
  legend {
    padding: 0 var(--space-1);
    font-weight: var(--font-weight-medium);
  }
  p {
    margin: 0;
  }
  select,
  .offset input {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface-raised);
  }
  .add select {
    flex: 1 1 10rem;
  }
  .placements {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .placements li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-1);
    border-radius: var(--radius-sm);
  }
  .placements li.selected {
    background: var(--color-primary-soft);
  }
  .select {
    flex: 1 1 8rem;
    justify-content: flex-start;
    overflow-wrap: anywhere;
  }
  .select[aria-pressed='true'] {
    border-color: var(--color-primary);
  }
  .offset {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
    font-size: var(--font-size-sm);
  }
  .offset input {
    width: 4.5rem;
  }
  .offset input[aria-invalid='true'] {
    border-color: var(--color-danger);
  }
  .error {
    color: var(--color-danger);
  }
  .actions {
    justify-content: flex-end;
  }
</style>
