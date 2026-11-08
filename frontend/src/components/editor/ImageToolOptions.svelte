<script lang="ts">
  import AssetPicker from '../AssetPicker.svelte';
  import Button from '../Button.svelte';
  import { IMAGE_ASSET_KINDS, type ImagePlacement } from '../../editor/contracts-images';
  import type { ObjectLayerId } from '../../editor/contracts';
  import { imageAssetOf } from '../../editor/images/library';
  import { layerLabel } from '../../editor/ui/labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';
  import type { Asset } from '../../lib/types';

  /** Options of the image tool (P14, J): image to place, placement, layer, map background. */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  const LAYERS: ObjectLayerId[] = ['props', 'labels', 'walls', 'lighting', 'gm'];
  const PLACEMENTS: ImagePlacement[] = ['above', 'background'];

  let pickerOpen = $state(false);
  let current = $state<{ name: string; thumb: string } | null>(null);

  function pick(asset: Asset): void {
    session.doc.setImageAssets([imageAssetOf(asset)]);
    ui.imageAssetId = String(asset.id);
    current = { name: asset.name, thumb: asset.urls.thumb };
  }

  const placementLabel = (p: ImagePlacement): string =>
    p === 'background'
      ? t('editor.images.placement_background')
      : t('editor.images.placement_above');
</script>

<div class="image-options" data-testid="image-tool-options">
  <div class="current">
    {#if current !== null && ui.imageAssetId !== null}
      <img src={current.thumb} alt="" width="40" height="40" />
      <span class="small" data-testid="image-current">{current.name}</span>
    {:else}
      <span class="small muted">{t('editor.images.none')}</span>
    {/if}
  </div>
  <Button size="small" onclick={() => (pickerOpen = true)} data-testid="image-choose">
    {t('editor.images.choose')}
  </Button>
  <label class="field">
    <span>{t('editor.images.placement')}</span>
    <select bind:value={ui.imagePlacement} data-testid="image-placement">
      {#each PLACEMENTS as p (p)}<option value={p}>{placementLabel(p)}</option>{/each}
    </select>
  </label>
  <label class="field">
    <span>{t('editor.properties.layer')}</span>
    <select bind:value={ui.imageLayer} id={`${uid}-layer`}>
      {#each LAYERS as l (l)}<option value={l}>{layerLabel(l)}</option>{/each}
    </select>
  </label>
  <p class="small muted">{t('editor.images.tool_hint')}</p>
  <Button size="small" onclick={() => (ui.backgroundOpen = true)} data-testid="image-background">
    {t('editor.images.background_command')}
  </Button>
  <Button size="small" onclick={() => (ui.resizeOpen = true)} data-testid="map-resize">
    {t('editor.resize.command')}
  </Button>
</div>

<AssetPicker
  bind:open={pickerOpen}
  kinds={['object', ...IMAGE_ASSET_KINDS.filter((k) => k !== 'object')]}
  taxonomy
  title={t('editor.images.choose')}
  onpick={pick}
/>

<style>
  .image-options {
    display: grid;
    gap: var(--space-2);
  }
  .current {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    min-height: 40px;
  }
  .current img {
    object-fit: contain;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2, transparent);
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  p {
    margin: 0;
  }
</style>
