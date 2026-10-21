<script lang="ts">
  import AssetPicker from '../AssetPicker.svelte';
  import Button from '../Button.svelte';
  import CheckboxField from '../CheckboxField.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import ErrorAlert from '../ErrorAlert.svelte';
  import TextAreaField from '../TextAreaField.svelte';
  import TextField from '../TextField.svelte';
  import { FormState } from '../../lib/form.svelte';
  import {
    GAME_FIELD_RENAME,
    GAME_NAME_MAX,
    gamePatch,
    gameToDraft,
    SETTING_FLAGS,
    UNIT_LABEL_MAX,
    validateGameDraft,
    type GameDraft,
  } from '../../lib/games/game-form';
  import type { GamePageModel } from '../../lib/games/game-page.svelte';
  import { settingFlagLabel } from '../../lib/games/labels';
  import { canManageGame } from '../../lib/games/roles';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import type { Asset, GamePatch } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';

  /** Game settings (projet.md 18.1 p.3): GM only; the co-GM sees them read-only. */
  interface Props {
    model: GamePageModel;
  }

  let { model }: Props = $props();

  const { router } = services();
  const manage = $derived(canManageGame(model.role));
  // svelte-ignore state_referenced_locally
  let draft = $state<GameDraft>(gameToDraft(model.game!));
  let pickerOpen = $state(false);
  let formEl: HTMLFormElement | undefined = $state();
  const form = new FormState();
  let archiving = $state(false);
  let confirmOpen = $state(false);
  let deleting = $state(false);

  // Read-only view (co-GM): follow the game when it changes.
  $effect(() => {
    if (!manage && model.game) draft = gameToDraft(model.game);
  });

  function pick(asset: Asset): void {
    draft.cover_asset_id = asset.id;
    draft.cover_url = asset.urls.thumb;
  }

  function clearCover(): void {
    draft.cover_asset_id = null;
    draft.cover_url = null;
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const game = model.game;
    if (game === null) return;
    const holder: { patch: GamePatch | null } = { patch: null };
    const ok = await form.submit(
      async () => {
        if (holder.patch === null) return;
        // Optimistic: shown at once (title, card), rolled back if refused.
        const updated = await model.updateGame(holder.patch);
        draft = { ...gameToDraft(updated), cover_url: updated.cover_url ?? draft.cover_url };
      },
      {
        form: formEl,
        rename: GAME_FIELD_RENAME,
        validate: () => {
          const result = validateGameDraft(draft);
          if (!result.ok) return result.errors;
          holder.patch = gamePatch(game, {
            name: result.name,
            description: result.description,
            cover_asset_id: draft.cover_asset_id,
            settings: result.settings,
          });
          return {};
        },
      },
    );
    if (ok) {
      toasts.success(
        holder.patch === null ? t('games.settings.unchanged') : t('games.settings.saved'),
      );
    }
  }

  async function toggleArchive(): Promise<void> {
    const archived = model.game?.archived_at !== null;
    archiving = true;
    try {
      if (archived) await model.restore();
      else await model.archive();
      toasts.success(archived ? t('games.settings.restored') : t('games.settings.archived'));
    } catch (error) {
      toasts.error(error);
    } finally {
      archiving = false;
    }
  }

  async function remove(): Promise<void> {
    deleting = true;
    try {
      await model.remove();
      confirmOpen = false;
      toasts.success(t('games.settings.deleted', { name: model.game?.name ?? '' }));
      router.navigate('/');
    } catch (error) {
      toasts.error(error);
    } finally {
      deleting = false;
    }
  }
</script>

<div class="stack">
  <h2 class="visually-hidden">{t('games.tabs.settings')}</h2>
  {#if !manage}
    <p class="alert" role="note">{t('games.settings.read_only')}</p>
  {/if}

  <form class="stack" novalidate bind:this={formEl} onsubmit={save}>
    <fieldset class="card stack" disabled={!manage}>
      <legend>{t('games.settings.general')}</legend>
      <TextField
        label={t('games.fields.name')}
        name="name"
        bind:value={draft.name}
        required
        maxlength={GAME_NAME_MAX}
        autocomplete="off"
        error={form.message('name')}
      />
      <TextAreaField
        label={t('games.fields.description')}
        name="description"
        bind:value={draft.description}
        error={form.message('description')}
      />
      <div class="cover-row">
        <div class="cover" aria-hidden="true">
          {#if draft.cover_url}<img src={draft.cover_url} alt="" />{/if}
        </div>
        <div class="stack">
          <span class="label">{t('games.settings.cover')}</span>
          {#if manage}
            <div class="row">
              <button type="button" class="button button-small" onclick={() => (pickerOpen = true)}>
                {draft.cover_asset_id
                  ? t('games.settings.cover_change')
                  : t('games.settings.cover_choose')}
              </button>
              {#if draft.cover_asset_id}
                <button type="button" class="button button-small button-ghost" onclick={clearCover}>
                  {t('games.settings.cover_remove')}
                </button>
              {/if}
            </div>
          {:else if !draft.cover_asset_id}
            <span class="small muted">{t('games.settings.cover_none')}</span>
          {/if}
        </div>
      </div>
    </fieldset>

    <fieldset class="card stack" disabled={!manage}>
      <legend>{t('games.settings.play')}</legend>
      {#each SETTING_FLAGS as flag (flag)}
        {@const text = settingFlagLabel(flag)}
        <CheckboxField
          label={text.label}
          hint={text.hint}
          name={flag}
          bind:checked={draft[flag]}
          disabled={!manage}
        />
      {/each}
    </fieldset>

    <fieldset class="card stack" disabled={!manage}>
      <legend>{t('games.settings.grid')}</legend>
      <div class="grid3">
        <TextField
          label={t('games.settings.unit_label')}
          name="unit_label"
          bind:value={draft.unit_label}
          maxlength={UNIT_LABEL_MAX}
          hint={t('games.settings.unit_label_hint')}
          error={form.message('unit_label')}
        />
        <TextField
          label={t('games.settings.unit_per_cell')}
          name="unit_per_cell"
          inputmode="decimal"
          bind:value={draft.unit_per_cell}
          error={form.message('unit_per_cell')}
        />
        <TextField
          label={t('games.settings.default_cell_px')}
          name="default_cell_px"
          inputmode="numeric"
          bind:value={draft.default_cell_px}
          hint={t('games.settings.default_cell_px_hint')}
          error={form.message('default_cell_px')}
        />
      </div>
    </fieldset>

    {#if manage}
      <ErrorAlert failure={form.failure} />
      <div class="row">
        <Button type="submit" variant="primary" loading={form.submitting}>
          {t('common.save')}
        </Button>
      </div>
    {/if}
  </form>

  {#if manage}
    <section class="card stack danger" aria-labelledby="danger-zone">
      <h3 id="danger-zone">{t('games.settings.danger')}</h3>
      <div class="row">
        <Button loading={archiving} onclick={toggleArchive}>
          {model.game?.archived_at ? t('games.settings.unarchive') : t('games.settings.archive')}
        </Button>
        <span class="small muted">{t('games.settings.archive_hint')}</span>
      </div>
      <div class="row">
        <Button variant="danger" onclick={() => (confirmOpen = true)}>
          {t('games.settings.delete')}
        </Button>
        <span class="small muted">{t('games.settings.delete_hint')}</span>
      </div>
    </section>
  {/if}
</div>

<AssetPicker bind:open={pickerOpen} title={t('games.settings.cover_choose')} onpick={pick} />

<ConfirmDialog
  bind:open={confirmOpen}
  title={t('games.settings.delete_title')}
  message={t('games.settings.delete_text', { name: model.game?.name ?? '' })}
  confirmLabel={t('games.settings.delete')}
  danger
  busy={deleting}
  onconfirm={remove}
/>

<style>
  fieldset {
    margin: 0;
    min-width: 0;
  }
  legend {
    float: left;
    width: 100%;
    margin-bottom: var(--space-2);
    padding: 0;
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-bold);
  }
  .label {
    font-weight: var(--font-weight-medium);
  }
  .cover-row {
    display: flex;
    gap: var(--space-4);
    align-items: center;
  }
  .cover {
    width: 6rem;
    height: 4rem;
    flex: none;
    overflow: hidden;
    border-radius: var(--radius-md);
    background: var(--color-surface-sunken);
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .grid3 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
    gap: var(--space-3);
    align-items: start;
  }
  .danger {
    border-color: var(--color-danger);
  }
  .danger h3 {
    margin: 0;
    font-size: var(--font-size-lg);
  }
  p {
    margin: 0;
  }
</style>
