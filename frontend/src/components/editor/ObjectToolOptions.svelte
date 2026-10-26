<script lang="ts">
  import { LIGHT_PRESET_IDS } from '../../editor/tools/object-common';
  import { FOG_BRUSH_MAX, FOG_BRUSH_MIN } from '../../editor/tools/types';
  import {
    FOG_SHAPES,
    WALL_KINDS,
    WINDOW_KINDS,
    fogShapeLabel,
    lightPresetLabel,
    wallKindLabel,
    windowKindLabel,
  } from '../../editor/ui/scene-labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /** Options of the P5 object tools: wall (W), door / window (D), light (L), token (K), fog (F). */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  const tokenName = $derived(
    ui.tokenId === null ? null : (ui.tokenDefs.find((d) => d.id === ui.tokenId)?.name ?? null),
  );
</script>

{#if ui.tool === 'wall'}
  <label class="field">
    <span>{t('editor.options.wall_kind')}</span>
    <select class="select" bind:value={ui.wallKind} data-testid="wall-kind">
      {#each WALL_KINDS as kind (kind)}
        <option value={kind}>{wallKindLabel(kind)}</option>
      {/each}
    </select>
  </label>
  <label class="field">
    <span>{t('editor.options.thickness', { value: ui.wallThickness })}</span>
    <input type="range" min="0.05" max="2" step="0.05" bind:value={ui.wallThickness} />
  </label>
  <label class="choice">
    <input type="checkbox" bind:checked={ui.wallRoom} data-testid="wall-room" />
    {t('editor.options.wall_room')}
  </label>
  <p class="small muted">
    {ui.wallRoom ? t('editor.options.wall_room_hint') : t('editor.options.wall_hint')}
  </p>
{:else if ui.tool === 'door'}
  <fieldset>
    <legend>{t('editor.options.opening')}</legend>
    <label class="choice">
      <input
        type="radio"
        name={`${uid}-opening`}
        value="door"
        bind:group={ui.openingKind}
        data-testid="opening-door"
      />
      {t('editor.objects.types.door')}
    </label>
    <label class="choice">
      <input
        type="radio"
        name={`${uid}-opening`}
        value="window"
        bind:group={ui.openingKind}
        data-testid="opening-window"
      />
      {t('editor.objects.types.window')}
    </label>
  </fieldset>
  {#if ui.openingKind === 'window'}
    <label class="field">
      <span>{t('editor.objects.window_kind')}</span>
      <select class="select" bind:value={ui.windowKind}>
        {#each WINDOW_KINDS as kind (kind)}
          <option value={kind}>{windowKindLabel(kind)}</option>
        {/each}
      </select>
    </label>
  {/if}
  <label class="field">
    <span>{t('editor.options.opening_width', { value: ui.openingWidth })}</span>
    <input type="range" min="0.5" max="6" step="0.5" bind:value={ui.openingWidth} />
  </label>
  <p class="small muted">{t('editor.options.door_hint')}</p>
{:else if ui.tool === 'light'}
  <fieldset>
    <legend>{t('editor.options.light_preset')}</legend>
    {#each LIGHT_PRESET_IDS as preset (preset)}
      <label class="choice">
        <input type="radio" name={`${uid}-preset`} value={preset} bind:group={ui.lightPreset} />
        {lightPresetLabel(preset)}
      </label>
    {/each}
  </fieldset>
  <p class="small muted">{t('editor.options.light_hint')}</p>
{:else if ui.tool === 'token'}
  <p class="small" data-testid="current-token">
    {tokenName === null
      ? t('editor.options.token_none')
      : t('editor.options.token_current', { name: tokenName })}
  </p>
  <p class="small muted">{t('editor.options.token_hint')}</p>
{:else if ui.tool === 'fog'}
  <fieldset>
    <legend>{t('editor.options.fog_shape')}</legend>
    {#each FOG_SHAPES as shape (shape)}
      <label class="choice">
        <input
          type="radio"
          name={`${uid}-fog`}
          value={shape}
          bind:group={ui.fogShape}
          data-testid={`fog-shape-${shape}`}
        />
        {fogShapeLabel(shape)}
      </label>
    {/each}
  </fieldset>
  {#if ui.fogShape === 'brush'}
    <label class="field">
      <span>{t('editor.options.fog_brush', { value: ui.fogBrush })}</span>
      <input
        type="range"
        min={FOG_BRUSH_MIN}
        max={FOG_BRUSH_MAX}
        step="0.5"
        bind:value={ui.fogBrush}
      />
    </label>
  {/if}
  <label class="choice">
    <input type="checkbox" bind:checked={ui.fogHide} data-testid="fog-hide" />
    {t('editor.options.fog_hide')}
  </label>
  <p class="small muted">{t('editor.options.fog_hint')}</p>
{:else if ui.tool === 'select'}
  <p class="small muted">{t('editor.options.select_objects_hint')}</p>
{/if}

<style>
  .field {
    display: grid;
    gap: var(--space-1);
  }
  fieldset {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    margin-bottom: 2px;
  }
  .choice {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  p {
    margin: 0;
  }
  .select {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-sm);
  }
</style>
