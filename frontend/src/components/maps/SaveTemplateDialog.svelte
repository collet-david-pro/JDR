<script lang="ts">
  import Button from '../Button.svelte';
  import ErrorAlert from '../ErrorAlert.svelte';
  import Modal from '../Modal.svelte';
  import SelectField from '../SelectField.svelte';
  import TextField from '../TextField.svelte';
  import { ApiError } from '../../lib/api';
  import { FormState } from '../../lib/form.svelte';
  import { t } from '../../lib/i18n';
  import { MAP_NAME_MAX } from '../../lib/maps/map-form';
  import {
    PRIVATE_ASSETS,
    type MapTemplate,
    type SaveTemplateInput,
  } from '../../lib/maps/templates';
  import type { MapSummary } from '../../lib/types';

  /** Saves a map as a template: name, and (admins only) private or shared with the site. */
  interface Props {
    open: boolean;
    map: MapSummary | null;
    /** The scope choice is offered to admins only. */
    admin: boolean;
    onsave: (map: MapSummary, input: SaveTemplateInput) => Promise<MapTemplate>;
    onsaved: (template: MapTemplate) => void;
  }

  let { open = $bindable(), map, admin, onsave, onsaved }: Props = $props();

  let name = $state('');
  let scope = $state('private');
  let privateAssets = $state(false);
  let formEl: HTMLFormElement | undefined = $state();
  const form = new FormState();

  $effect(() => {
    if (open) {
      name = map?.name ?? '';
      scope = 'private';
      privateAssets = false;
      form.reset();
    }
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (map === null) return;
    const target = map;
    const result: { template: MapTemplate | null } = { template: null };
    privateAssets = false;
    const trimmed = name.trim();
    const ok = await form.submit(
      async () => {
        try {
          result.template = await onsave(target, {
            name: trimmed,
            scope: admin && scope === 'site' ? 'site' : 'private',
          });
        } catch (error) {
          if (error instanceof ApiError && error.fields['scope'] === PRIVATE_ASSETS) {
            privateAssets = true;
            return;
          }
          throw error;
        }
      },
      {
        form: formEl,
        validate: () =>
          trimmed === ''
            ? { name: 'required' }
            : trimmed.length > MAP_NAME_MAX
              ? { name: 'too_long' }
              : {},
      },
    );
    if (ok && result.template !== null) {
      open = false;
      onsaved(result.template);
    }
  }
</script>

<Modal bind:open title={t('games.maps.template.save_title')}>
  <form
    class="stack"
    novalidate
    bind:this={formEl}
    onsubmit={submit}
    data-testid="template-save-form"
  >
    <p class="small muted">{t('games.maps.template.save_intro')}</p>
    <TextField
      label={t('games.maps.template.name')}
      name="name"
      bind:value={name}
      required
      maxlength={MAP_NAME_MAX}
      autocomplete="off"
      error={form.message('name')}
    />
    {#if admin}
      <SelectField
        label={t('games.maps.template.scope')}
        name="scope"
        bind:value={scope}
        options={[
          { value: 'private', label: t('games.maps.template.scope_private') },
          { value: 'site', label: t('games.maps.template.scope_site') },
        ]}
        hint={t('games.maps.template.scope_hint')}
      />
    {/if}
    {#if privateAssets}
      <div class="alert alert-error" role="alert" data-testid="template-private-assets">
        {t('games.maps.template.private_assets')}
      </div>
    {/if}
    <ErrorAlert failure={form.failure} />
    <div class="row actions">
      <button type="button" class="button" onclick={() => (open = false)}>
        {t('common.cancel')}
      </button>
      <Button type="submit" variant="primary" loading={form.submitting} data-testid="template-save">
        {t('games.maps.template.save_submit')}
      </Button>
    </div>
  </form>
</Modal>

<style>
  p {
    margin: 0;
  }
  .actions {
    justify-content: flex-end;
  }
</style>
