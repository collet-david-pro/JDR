<script lang="ts">
  import AssetPicker from '../AssetPicker.svelte';
  import Button from '../Button.svelte';
  import CheckboxField from '../CheckboxField.svelte';
  import ColorField from '../ColorField.svelte';
  import ErrorAlert from '../ErrorAlert.svelte';
  import Modal from '../Modal.svelte';
  import SelectField from '../SelectField.svelte';
  import TextField from '../TextField.svelte';
  import { FormState } from '../../lib/form.svelte';
  import { tokenKindLabel } from '../../lib/games/labels';
  import {
    emptyTokenDraft,
    isTokenKind,
    TOKEN_FIELD_RENAME,
    TOKEN_NAME_MAX,
    tokenToDraft,
    validateToken,
    type TokenDraft,
  } from '../../lib/games/token-form';
  import { formatCellDistance } from '../../lib/games/units';
  import { t } from '../../lib/i18n';
  import {
    TOKEN_KINDS,
    type Asset,
    type GameSettings,
    type Token,
    type TokenInput,
    type UserRef,
  } from '../../lib/types';

  /** Token definition form (visual data only: no rule attribute, projet.md 1.2). */
  interface Props {
    open: boolean;
    /** null: new token. */
    token: Token | null;
    settings: GameSettings;
    owners: readonly UserRef[];
    onsave: (input: TokenInput) => Promise<Token>;
  }

  let { open = $bindable(), token, settings, owners, onsave }: Props = $props();

  let draft = $state<TokenDraft>(emptyTokenDraft());
  let kind = $state<string>('pc');
  let pickerOpen = $state(false);
  let formEl: HTMLFormElement | undefined = $state();
  const form = new FormState();

  $effect(() => {
    if (open) {
      draft = token === null ? emptyTokenDraft() : tokenToDraft(token);
      kind = draft.kind;
      form.reset();
    }
  });

  const kindOptions = TOKEN_KINDS.map((k) => ({ value: k, label: tokenKindLabel(k) }));
  const ownerOptions = $derived([
    { value: '', label: t('games.tokens.no_owner') },
    ...owners.map((u) => ({ value: u.id, label: u.username })),
  ]);

  /** "= 60 ft" next to a distance in cells. */
  function unitHint(cells: string): string | null {
    const text = formatCellDistance(cells, settings);
    return text === '' ? null : t('games.tokens.distance_hint', { distance: text });
  }

  function pick(asset: Asset): void {
    draft.asset_id = asset.id;
    draft.image_url = asset.urls.thumb;
  }

  function clearImage(): void {
    draft.asset_id = null;
    draft.image_url = null;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (isTokenKind(kind)) draft.kind = kind;
    const holder: { input: TokenInput | null } = { input: null };
    const ok = await form.submit(
      async () => {
        if (holder.input !== null) await onsave(holder.input);
      },
      {
        form: formEl,
        rename: TOKEN_FIELD_RENAME,
        validate: () => {
          const result = validateToken(draft);
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
  title={token === null ? t('games.tokens.create_title') : t('games.tokens.edit_title')}
>
  <form class="stack" novalidate bind:this={formEl} onsubmit={submit}>
    <div class="image-row">
      <div class="preview" aria-hidden="true">
        {#if draft.image_url}
          <img src={draft.image_url} alt="" />
        {:else}
          <span>{[...draft.name][0]?.toUpperCase() ?? '?'}</span>
        {/if}
      </div>
      <div class="row">
        <button type="button" class="button button-small" onclick={() => (pickerOpen = true)}>
          {draft.asset_id ? t('games.tokens.change_image') : t('games.tokens.choose_image')}
        </button>
        {#if draft.asset_id}
          <button type="button" class="button button-small button-ghost" onclick={clearImage}>
            {t('games.tokens.remove_image')}
          </button>
        {/if}
      </div>
    </div>

    <TextField
      label={t('games.tokens.name')}
      name="name"
      bind:value={draft.name}
      required
      maxlength={TOKEN_NAME_MAX}
      autocomplete="off"
      error={form.message('name')}
    />

    <div class="grid2">
      <SelectField
        label={t('games.tokens.kind')}
        name="kind"
        bind:value={kind}
        options={kindOptions}
        error={form.message('kind')}
      />
      <SelectField
        label={t('games.tokens.owner')}
        name="owner"
        bind:value={draft.owner}
        options={ownerOptions}
        hint={t('games.tokens.owner_hint')}
        error={form.message('owner')}
      />
    </div>

    <fieldset>
      <legend>{t('games.tokens.size')}</legend>
      <div class="grid2">
        <TextField
          label={t('games.tokens.size_w')}
          name="size_w"
          inputmode="decimal"
          bind:value={draft.size_w}
          error={form.message('size_w')}
        />
        <TextField
          label={t('games.tokens.size_h')}
          name="size_h"
          inputmode="decimal"
          bind:value={draft.size_h}
          error={form.message('size_h')}
        />
      </div>
    </fieldset>

    <fieldset>
      <legend>{t('games.tokens.vision')}</legend>
      <CheckboxField label={t('games.tokens.vision_enabled')} bind:checked={draft.vision_enabled} />
      <div class="grid2">
        <TextField
          label={t('games.tokens.vision_range')}
          name="vision_range"
          inputmode="decimal"
          bind:value={draft.vision_range}
          hint={unitHint(draft.vision_range)}
          error={form.message('vision_range')}
          disabled={!draft.vision_enabled}
        />
        <TextField
          label={t('games.tokens.vision_dark')}
          name="vision_dark"
          inputmode="decimal"
          bind:value={draft.vision_dark}
          hint={unitHint(draft.vision_dark)}
          error={form.message('vision_dark')}
          disabled={!draft.vision_enabled}
        />
      </div>
    </fieldset>

    <fieldset>
      <legend>{t('games.tokens.light')}</legend>
      <CheckboxField
        label={t('games.tokens.light_enabled')}
        hint={t('games.tokens.light_hint')}
        bind:checked={draft.light_enabled}
      />
      {#if draft.light_enabled}
        <div class="grid2">
          <TextField
            label={t('games.tokens.light_radius')}
            name="light_radius"
            inputmode="decimal"
            bind:value={draft.light_radius}
            hint={unitHint(draft.light_radius)}
            error={form.message('light_radius')}
          />
          <TextField
            label={t('games.tokens.light_dim_radius')}
            name="light_dim_radius"
            inputmode="decimal"
            bind:value={draft.light_dim_radius}
            hint={unitHint(draft.light_dim_radius)}
            error={form.message('light_dim_radius')}
          />
          <ColorField
            label={t('games.tokens.light_color')}
            name="light_color"
            bind:value={draft.light_color}
            error={form.message('light_color')}
          />
          <TextField
            label={t('games.tokens.light_intensity')}
            name="light_intensity"
            inputmode="decimal"
            bind:value={draft.light_intensity}
            hint={t('games.tokens.light_intensity_hint')}
            error={form.message('light_intensity')}
          />
        </div>
        <CheckboxField label={t('games.tokens.light_flicker')} bind:checked={draft.light_flicker} />
      {/if}
    </fieldset>

    <fieldset>
      <legend>{t('games.tokens.ring')}</legend>
      <CheckboxField label={t('games.tokens.ring_enabled')} bind:checked={draft.ring_enabled} />
      {#if draft.ring_enabled}
        <ColorField
          label={t('games.tokens.ring_color')}
          name="ring_color"
          bind:value={draft.ring_color}
          error={form.message('ring_color')}
        />
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

<AssetPicker bind:open={pickerOpen} kind="token" onpick={pick} />

<style>
  .image-row {
    display: flex;
    gap: var(--space-3);
    align-items: center;
  }
  .preview {
    width: 4rem;
    height: 4rem;
    flex: none;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: var(--radius-pill);
    background: var(--color-surface-sunken);
    font-size: var(--font-size-xl);
    color: var(--color-text-muted);
  }
  .preview img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
    gap: var(--space-3);
    align-items: start;
  }
  fieldset {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: var(--space-3) var(--space-4) var(--space-4);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }
  legend {
    padding: 0 var(--space-1);
    font-weight: var(--font-weight-medium);
  }
  .actions {
    justify-content: flex-end;
  }
</style>
