<script lang="ts">
  import Button from '../Button.svelte';
  import ErrorAlert from '../ErrorAlert.svelte';
  import Modal from '../Modal.svelte';
  import SelectField from '../SelectField.svelte';
  import TextField from '../TextField.svelte';
  import { FormState } from '../../lib/form.svelte';
  import {
    MAP_FOLDER_MAX,
    MAP_NAME_MAX,
    MAP_SIDE_MAX,
    MAP_SIDE_MIN,
    newMapDraft,
    validateMapDraft,
    type MapDraft,
  } from '../../lib/maps/map-form';
  import { t } from '../../lib/i18n';
  import type { GameSettings, MapDetail, MapInput } from '../../lib/types';

  /** New map: name, folder, size in cells, cell size and units (from the game settings). */
  interface Props {
    open: boolean;
    settings: Partial<GameSettings> | null;
    /** Folder pre-filled (e.g. the folder whose "new map" button was used). */
    folder?: string | null;
    folders: readonly string[];
    oncreate: (input: MapInput) => Promise<MapDetail>;
    oncreated: (map: MapDetail) => void;
  }

  let {
    open = $bindable(),
    settings,
    folder = null,
    folders,
    oncreate,
    oncreated,
  }: Props = $props();

  const uid = $props.id();
  // svelte-ignore state_referenced_locally
  let draft = $state<MapDraft>(newMapDraft(settings, folder));
  let formEl: HTMLFormElement | undefined = $state();
  const form = new FormState();

  // Fresh form at each opening.
  $effect(() => {
    if (open) {
      draft = newMapDraft(settings, folder);
      form.reset();
    }
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const result: { map: MapDetail | null } = { map: null };
    const checked = validateMapDraft(draft);
    const ok = await form.submit(
      async () => {
        if (checked.ok) result.map = await oncreate(checked.input);
      },
      { form: formEl, validate: () => (checked.ok ? {} : checked.errors) },
    );
    if (ok && result.map !== null) {
      open = false;
      oncreated(result.map);
    }
  }
</script>

<Modal bind:open title={t('games.maps.create_title')}>
  <form class="stack" novalidate bind:this={formEl} onsubmit={submit} data-testid="map-create-form">
    <TextField
      label={t('games.maps.fields.name')}
      name="name"
      bind:value={draft.name}
      required
      maxlength={MAP_NAME_MAX}
      autocomplete="off"
      error={form.message('name')}
    />
    <TextField
      label={t('games.maps.fields.folder')}
      name="folder"
      bind:value={draft.folder}
      maxlength={MAP_FOLDER_MAX}
      autocomplete="off"
      list={`${uid}-folders`}
      hint={t('games.maps.fields.folder_hint')}
      error={form.message('folder')}
    />
    <datalist id={`${uid}-folders`}>
      {#each folders as name (name)}<option value={name}></option>{/each}
    </datalist>
    <SelectField
      label={t('games.maps.fields.kind')}
      name="kind"
      bind:value={draft.kind}
      options={[
        { value: 'battle', label: t('games.maps.kinds.battle') },
        { value: 'world', label: t('games.maps.kinds.world') },
      ]}
    />
    <div class="grid">
      <TextField
        label={t('games.maps.fields.width')}
        name="width"
        inputmode="numeric"
        bind:value={draft.width}
        required
        error={form.message('width')}
      />
      <TextField
        label={t('games.maps.fields.height')}
        name="height"
        inputmode="numeric"
        bind:value={draft.height}
        required
        error={form.message('height')}
      />
    </div>
    <p class="small muted">
      {t('games.maps.fields.size_hint', { min: MAP_SIDE_MIN, max: MAP_SIDE_MAX })}
    </p>
    <div class="grid">
      <TextField
        label={t('games.maps.fields.cell_px')}
        name="cell_px"
        inputmode="numeric"
        bind:value={draft.cell_px}
        required
        error={form.message('cell_px')}
      />
      <TextField
        label={t('games.maps.fields.unit_per_cell')}
        name="unit_per_cell"
        inputmode="decimal"
        bind:value={draft.unit_per_cell}
        required
        error={form.message('unit_per_cell')}
      />
      <TextField
        label={t('games.maps.fields.unit_label')}
        name="unit_label"
        bind:value={draft.unit_label}
        required
        maxlength={10}
        error={form.message('unit_label')}
      />
    </div>
    <ErrorAlert failure={form.failure} />
    <div class="row actions">
      <button type="button" class="button" onclick={() => (open = false)}>
        {t('common.cancel')}
      </button>
      <Button type="submit" variant="primary" loading={form.submitting} data-testid="map-create">
        {t('games.maps.create_submit')}
      </Button>
    </div>
  </form>
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: var(--space-3);
    align-items: start;
  }
  p {
    margin: 0;
  }
  .actions {
    justify-content: flex-end;
  }
</style>
