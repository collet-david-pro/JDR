<script lang="ts">
  import Button from '../Button.svelte';
  import ErrorAlert from '../ErrorAlert.svelte';
  import Modal from '../Modal.svelte';
  import TextField from '../TextField.svelte';
  import { FormState } from '../../lib/form.svelte';
  import {
    MAP_FOLDER_MAX,
    MAP_NAME_MAX,
    checkFolder,
    checkMapName,
    mapPatch,
  } from '../../lib/maps/map-form';
  import { t } from '../../lib/i18n';
  import type { MapPatch, MapSummary } from '../../lib/types';
  import { collectErrors } from '../../lib/validation';

  /** Rename a map and move it to another folder. */
  interface Props {
    open: boolean;
    map: MapSummary | null;
    folders: readonly string[];
    onsave: (map: MapSummary, patch: MapPatch) => Promise<unknown>;
  }

  let { open = $bindable(), map, folders, onsave }: Props = $props();

  const uid = $props.id();
  let name = $state('');
  let folder = $state('');
  let formEl: HTMLFormElement | undefined = $state();
  const form = new FormState();

  $effect(() => {
    if (open && map !== null) {
      name = map.name;
      folder = map.folder ?? '';
      form.reset();
    }
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const current = map;
    if (current === null) return;
    const patch = mapPatch(current, name, folder);
    const ok = await form.submit(
      async () => {
        if (Object.keys(patch).length > 0) await onsave(current, patch);
      },
      {
        form: formEl,
        validate: () => collectErrors({ name: checkMapName(name), folder: checkFolder(folder) }),
      },
    );
    if (ok) open = false;
  }
</script>

<Modal bind:open title={t('games.maps.edit_title')}>
  <form class="stack" novalidate bind:this={formEl} onsubmit={submit} data-testid="map-edit-form">
    <TextField
      label={t('games.maps.fields.name')}
      name="name"
      bind:value={name}
      required
      maxlength={MAP_NAME_MAX}
      autocomplete="off"
      error={form.message('name')}
    />
    <TextField
      label={t('games.maps.fields.folder')}
      name="folder"
      bind:value={folder}
      maxlength={MAP_FOLDER_MAX}
      autocomplete="off"
      list={`${uid}-folders`}
      hint={t('games.maps.fields.folder_hint')}
      error={form.message('folder')}
    />
    <datalist id={`${uid}-folders`}>
      {#each folders as f (f)}<option value={f}></option>{/each}
    </datalist>
    <ErrorAlert failure={form.failure} />
    <div class="row actions">
      <button type="button" class="button" onclick={() => (open = false)}>
        {t('common.cancel')}
      </button>
      <Button type="submit" variant="primary" loading={form.submitting}>
        {t('common.save')}
      </Button>
    </div>
  </form>
</Modal>

<style>
  .actions {
    justify-content: flex-end;
  }
</style>
