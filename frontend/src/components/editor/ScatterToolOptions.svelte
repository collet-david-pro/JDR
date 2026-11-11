<script lang="ts">
  import AssetPicker from '../AssetPicker.svelte';
  import Button from '../Button.svelte';
  import { IMAGE_ASSET_KINDS } from '../../editor/contracts-images';
  import { imageAssetOf } from '../../editor/images/library';
  import {
    SCATTER_DENSITY_MAX,
    SCATTER_DENSITY_MIN,
    SCATTER_RADIUS_MAX,
    SCATTER_RADIUS_MIN,
    SCATTER_SCALE_VAR_MAX,
    SCATTER_SPACING_MAX,
  } from '../../editor/tools/scatter-math';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';
  import type { Asset } from '../../lib/types';

  /** Options of the object brush: images to scatter, density, spacing, radius, randomness. */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  let pickerOpen = $state(false);
  let names = $state<Record<string, { name: string; thumb: string }>>({});

  function pick(asset: Asset): void {
    const id = String(asset.id);
    session.doc.setImageAssets([imageAssetOf(asset)]);
    names = { ...names, [id]: { name: asset.name, thumb: asset.urls.thumb } };
    if (!ui.scatterAssetIds.includes(id)) ui.scatterAssetIds = [...ui.scatterAssetIds, id];
  }
  function drop(id: string): void {
    ui.scatterAssetIds = ui.scatterAssetIds.filter((x) => x !== id);
  }
</script>

<div class="scatter-options" data-testid="scatter-tool-options">
  {#if ui.scatterAssetIds.length === 0}
    <p class="small muted">{t('editor.scatter.none')}</p>
  {:else}
    <ul class="assets">
      {#each ui.scatterAssetIds as id (id)}
        <li>
          {#if names[id] !== undefined}
            <img src={names[id].thumb} alt="" width="32" height="32" />
            <span class="small">{names[id].name}</span>
          {:else}
            <span class="small">{id}</span>
          {/if}
          <Button size="small" onclick={() => drop(id)}>{t('editor.scatter.remove')}</Button>
        </li>
      {/each}
    </ul>
  {/if}
  <Button size="small" onclick={() => (pickerOpen = true)} data-testid="scatter-choose">
    {t('editor.scatter.add')}
  </Button>
  <label class="field">
    <span>{t('editor.scatter.density')} : <strong>{ui.scatterDensity}</strong></span>
    <input
      type="range"
      min={SCATTER_DENSITY_MIN}
      max={SCATTER_DENSITY_MAX}
      step="0.05"
      bind:value={ui.scatterDensity}
    />
  </label>
  <label class="field">
    <span>{t('editor.scatter.spacing')} : <strong>{ui.scatterSpacing}</strong></span>
    <input
      type="range"
      min="0"
      max={SCATTER_SPACING_MAX}
      step="0.25"
      bind:value={ui.scatterSpacing}
    />
  </label>
  <label class="field">
    <span>{t('editor.scatter.radius')} : <strong>{ui.scatterRadius}</strong></span>
    <input
      type="range"
      min={SCATTER_RADIUS_MIN}
      max={SCATTER_RADIUS_MAX}
      step="0.5"
      bind:value={ui.scatterRadius}
    />
  </label>
  <label class="choice">
    <input type="checkbox" bind:checked={ui.scatterRotation} />
    {t('editor.scatter.random_rotation')}
  </label>
  <label class="field">
    <span>{t('editor.scatter.scale_variation')} : <strong>{ui.scatterScaleVariation}</strong></span>
    <input
      type="range"
      min="0"
      max={SCATTER_SCALE_VAR_MAX}
      step="0.05"
      bind:value={ui.scatterScaleVariation}
    />
  </label>
  <p class="small muted">{t('editor.scatter.hint')}</p>
</div>

<AssetPicker
  bind:open={pickerOpen}
  kinds={['object', ...IMAGE_ASSET_KINDS.filter((k) => k !== 'object')]}
  taxonomy
  title={t('editor.scatter.add')}
  onpick={pick}
/>

<style>
  .choice {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .scatter-options {
    display: grid;
    gap: var(--space-2);
  }
  .assets {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .assets li {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .assets img {
    object-fit: contain;
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  p {
    margin: 0;
  }
</style>
