<script lang="ts">
  import { untrack } from 'svelte';
  import AssetPicker from '../AssetPicker.svelte';
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
  import type { Asset, GameSettings, MapDetail, MapInput } from '../../lib/types';
  import type { ImageGeometry } from '../../editor/contracts-images';
  import {
    DEFAULT_IMAGE_CELL_PX,
    mapFromImage,
    mapFromImageSize,
    type MapAxis,
  } from '../../editor/images/calibration';
  import { uploadImage } from '../../editor/images/library';
  import { assetsClient } from '../../lib/assets/service';

  /** New map: name, folder, size in cells, cell size and units (from the game settings). */
  interface Props {
    open: boolean;
    settings: Partial<GameSettings> | null;
    /** Folder pre-filled (e.g. the folder whose "new map" button was used). */
    folder?: string | null;
    folders: readonly string[];
    oncreate: (input: MapInput) => Promise<MapDetail>;
    oncreated: (map: MapDetail) => void;
    /** P14: adds the background image to the map just created (map read again). */
    onimage?: (map: MapDetail, assetId: string, geometry: ImageGeometry) => Promise<MapDetail>;
  }

  let {
    open = $bindable(),
    settings,
    folder = null,
    folders,
    oncreate,
    oncreated,
    onimage,
  }: Props = $props();

  // ---- P14: map from an image ----
  let image = $state<Asset | null>(null);
  let imageCellPx = $state(String(DEFAULT_IMAGE_CELL_PX));
  /** Size from the cell of the image, or from the size of the map wanted (cells). */
  let imageMode = $state<'cell_px' | 'map'>('cell_px');
  let imageAxis = $state<MapAxis>('width');
  let imageMapCells = $state('30');
  let pickerOpen = $state(false);
  let uploading = $state(false);
  let imageError = $state<string | null>(null);
  const fromImage = $derived(
    image === null
      ? null
      : imageMode === 'map'
        ? mapFromImageSize(
            { width: image.width, height: image.height },
            imageAxis,
            Number(imageMapCells),
          )
        : mapFromImage({ width: image.width, height: image.height }, Number(imageCellPx)),
  );

  function useImage(asset: Asset): void {
    image = asset;
    imageError = null;
  }

  // The size of the map follows the image and the size of one of its cells.
  $effect(() => {
    const plan = fromImage;
    if (plan !== null) untrack(() => applyImageSize(plan));
  });

  function applyImageSize(plan: NonNullable<typeof fromImage>): void {
    draft.width = String(plan.width);
    draft.height = String(plan.height);
    draft.cell_px = String(plan.cellPx);
    if (draft.name.trim() === '' && image !== null) draft.name = image.name;
  }

  async function sendImage(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    uploading = true;
    imageError = null;
    try {
      useImage((await uploadImage(assetsClient(), file, 'background', t)).asset);
    } catch (e) {
      imageError = e instanceof Error ? e.message : t('errors.unknown');
    } finally {
      uploading = false;
    }
  }

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
      image = null;
      imageError = null;
      imageMode = 'cell_px';
    }
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const result: { map: MapDetail | null } = { map: null };
    const checked = validateMapDraft(draft);
    const ok = await form.submit(
      async () => {
        if (checked.ok) result.map = await oncreate(checked.input);
        const plan = fromImage;
        if (result.map !== null && image !== null && plan !== null && onimage !== undefined) {
          result.map = await onimage(result.map, String(image.id), plan.geometry);
        }
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
    {#if onimage !== undefined}
      <fieldset class="from-image" data-testid="map-from-image">
        <legend>{t('games.maps.from_image.title')}</legend>
        <div class="row">
          <Button size="small" onclick={() => (pickerOpen = true)}>
            {t('games.maps.from_image.choose')}
          </Button>
          <label class="button button-small upload">
            {t('games.maps.from_image.upload')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onchange={sendImage}
              disabled={uploading}
              data-testid="map-from-image-upload"
            />
          </label>
          {#if image !== null}
            <span class="small" data-testid="map-from-image-name"
              >{t('games.maps.from_image.chosen', {
                name: image.name,
                width: image.width,
                height: image.height,
              })}</span
            >
          {/if}
        </div>
        {#if imageError !== null}<p class="alert alert-error" role="alert">{imageError}</p>{/if}
        {#if image !== null}
          <div class="row" role="radiogroup">
            <label class="check">
              <input
                type="radio"
                name={`${uid}-image-mode`}
                value="cell_px"
                bind:group={imageMode}
              />
              {t('games.maps.from_image.mode_cell_px')}
            </label>
            <label class="check">
              <input
                type="radio"
                name={`${uid}-image-mode`}
                value="map"
                bind:group={imageMode}
                data-testid="map-from-image-mode-map"
              />
              {t('games.maps.from_image.mode_map')}
            </label>
          </div>
          {#if imageMode === 'map'}
            <SelectField
              label={t('editor.images.map_axis')}
              name="image_axis"
              bind:value={imageAxis}
              options={[
                { value: 'width', label: t('games.maps.from_image.axis_width') },
                { value: 'height', label: t('games.maps.from_image.axis_height') },
              ]}
            />
            <TextField
              label={t('games.maps.from_image.map_cells')}
              name="image_map_cells"
              inputmode="numeric"
              bind:value={imageMapCells}
              hint={t('games.maps.from_image.map_cells_hint')}
            />
          {:else}
            <TextField
              label={t('games.maps.from_image.cell_px')}
              name="image_cell_px"
              inputmode="decimal"
              bind:value={imageCellPx}
              hint={t('games.maps.from_image.cell_px_hint')}
            />
          {/if}
        {/if}
      </fieldset>
    {/if}
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

{#if onimage !== undefined}
  <AssetPicker
    bind:open={pickerOpen}
    kinds={['background', 'object', 'texture', 'token']}
    taxonomy
    title={t('games.maps.from_image.choose')}
    onpick={useImage}
  />
{/if}

<style>
  .from-image {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
  }
  .upload {
    position: relative;
    overflow: hidden;
    cursor: pointer;
  }
  .upload input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: var(--space-3);
    align-items: start;
  }
  .check {
    display: inline-flex;
    gap: var(--space-2);
    align-items: center;
  }
  p {
    margin: 0;
  }
  .actions {
    justify-content: flex-end;
  }
</style>
