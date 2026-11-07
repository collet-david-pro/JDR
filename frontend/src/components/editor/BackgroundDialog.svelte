<script lang="ts">
  import { untrack } from 'svelte';
  import AssetPicker from '../AssetPicker.svelte';
  import Button from '../Button.svelte';
  import Modal from '../Modal.svelte';
  import type { ImageAssetView, ImageGeometry, ImageObject } from '../../editor/contracts-images';
  import {
    DEFAULT_IMAGE_CELL_PX,
    calibratedGeometry,
    calibrationOf,
    fitToMap,
    mapSizeFor,
    type Calibration,
  } from '../../editor/images/calibration';
  import { backgroundsOf, imageAssetOf, uploadImage } from '../../editor/images/library';
  import type { EditorSession } from '../../editor/ui/session';
  import { newObjectUid } from '../../editor/util/uid';
  import { assetsClient } from '../../lib/assets/service';
  import { t } from '../../lib/i18n';
  import type { Asset } from '../../lib/types';

  /**
   * "Image de fond…" (P14): choose or send the background of the shown floor, then calibrate it
   * (size of a cell in the image or cells across, offset) with a live preview over the grid; fit
   * it to the map, or resize the map to the image. The background is locked by default.
   */
  interface Props {
    session: EditorSession;
    /** Resizes the map (saved first, then the editor reloads). */
    onresize?: (width: number, height: number) => Promise<void>;
  }

  let { session, onresize }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  const grid = $derived(session.doc.grid);

  let asset = $state<ImageAssetView | null>(null);
  let target = $state<ImageObject | null>(null);
  let cal = $state<Calibration>({
    mode: 'cell_px',
    cellPx: DEFAULT_IMAGE_CELL_PX,
    cellsWide: 10,
    offsetX: 0,
    offsetY: 0,
  });
  let pickerOpen = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let canvas: HTMLCanvasElement | undefined = $state();
  let image: HTMLImageElement | null = $state(null);

  const geometry = $derived<ImageGeometry | null>(
    asset === null
      ? null
      : calibratedGeometry(cal, { width: asset.width, height: asset.height }, grid),
  );
  const mapSize = $derived(geometry === null ? null : mapSizeFor(geometry));

  // Opening: the background being recalibrated (or the first one of the floor), else a new one.
  $effect(() => {
    if (!ui.backgroundOpen) return;
    untrack(() => opened());
  });

  function opened(): void {
    const objects = session.doc.objects();
    const wanted = ui.backgroundTarget;
    const found =
      (wanted === null ? undefined : objects.find((o) => o.uid === wanted)) ??
      backgroundsOf(objects)[0];
    const existing = found !== undefined && found.type === 'image' ? found : null;
    target = existing;
    error = null;
    notice = null;
    if (existing !== null) {
      const view = session.doc.imageAsset(existing.props.asset_id);
      asset = view;
      if (view !== null) cal = calibrationOf(existing.geometry, view);
    }
  }

  // Preview image.
  $effect(() => {
    const url = asset?.url ?? null;
    if (url === null) {
      image = null;
      return;
    }
    const img = new Image();
    img.onload = () => (image = img);
    img.src = url;
  });

  // Live preview: the map, the image where it would be, the grid over it.
  $effect(() => {
    const c = canvas;
    const g = geometry;
    const img = image;
    if (c === undefined) return;
    const ctx = c.getContext('2d');
    if (ctx === null) return;
    const scale = Math.min(c.width / grid.width, c.height / grid.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 0, grid.width * scale, grid.height * scale);
    if (g !== null && img !== null) {
      ctx.drawImage(img, g.x * scale, g.y * scale, g.w * scale, g.h * scale);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = scale >= 4 ? 1 : Math.ceil(4 / scale);
    for (let x = 0; x <= grid.width; x += step) {
      ctx.moveTo(Math.round(x * scale) + 0.5, 0);
      ctx.lineTo(Math.round(x * scale) + 0.5, grid.height * scale);
    }
    for (let y = 0; y <= grid.height; y += step) {
      ctx.moveTo(0, Math.round(y * scale) + 0.5);
      ctx.lineTo(grid.width * scale, Math.round(y * scale) + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = '#e0b040';
    ctx.strokeRect(0.5, 0.5, grid.width * scale - 1, grid.height * scale - 1);
  });

  function chosen(a: Asset): void {
    asset = imageAssetOf(a);
    session.doc.setImageAssets([asset]);
    error = null;
  }

  async function send(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    busy = true;
    error = null;
    notice = null;
    try {
      const result = await uploadImage(assetsClient(), file, 'background', t);
      chosen(result.asset);
      if (result.reduced) {
        notice = t('editor.images.reduced', {
          width: result.asset.width,
          height: result.asset.height,
        });
      }
    } catch (e) {
      error = e instanceof Error ? e.message : t('errors.unknown');
    } finally {
      busy = false;
    }
  }

  function fit(): void {
    if (asset === null) return;
    cal = fitToMap({ width: asset.width, height: asset.height }, grid);
  }

  function apply(): void {
    const g = geometry;
    const a = asset;
    if (g === null || a === null) return;
    const live = target === null ? undefined : session.doc.object(target.uid);
    if (live !== undefined && live.type === 'image') {
      session.history.execute({
        label: 'editor.command.background',
        ops: [
          {
            type: 'object.update',
            uid: live.uid,
            rev: live.rev,
            patch: { geometry: g, props: { ...live.props, asset_id: a.assetId } },
          },
        ],
        inverseOps: [],
      });
    } else {
      const object: ImageObject = {
        uid: newObjectUid(),
        floor: session.doc.floor,
        type: 'image',
        layer: 'props',
        geometry: g,
        props: {
          asset_id: a.assetId,
          opacity: 1,
          flip_h: false,
          flip_v: false,
          placement: 'background',
        },
        visibility: 'all',
        locked: true,
        sort_order: -1000,
        rev: 1,
      };
      session.history.execute({
        label: 'editor.command.background',
        ops: [{ type: 'object.add', object }],
        inverseOps: [],
      });
    }
    close();
  }

  async function resize(): Promise<void> {
    if (mapSize === null || onresize === undefined) return;
    apply();
    busy = true;
    try {
      await onresize(mapSize.width, mapSize.height);
    } catch (e) {
      error = e instanceof Error ? e.message : t('errors.unknown');
    } finally {
      busy = false;
    }
  }

  function close(): void {
    ui.backgroundOpen = false;
    ui.backgroundTarget = null;
  }

  const numberOf = (e: Event): number => Number((e.currentTarget as HTMLInputElement).value);
</script>

<Modal bind:open={ui.backgroundOpen} title={t('editor.images.background_title')} onclose={close}>
  <div class="background" data-testid="background-dialog">
    <div class="row">
      <Button size="small" onclick={() => (pickerOpen = true)} data-testid="background-choose">
        {t('editor.images.choose')}
      </Button>
      <label class="button button-small upload">
        {t('editor.images.upload')}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onchange={send}
          disabled={busy}
          data-testid="background-upload"
        />
      </label>
      {#if asset !== null}
        <span class="small" data-testid="background-asset"
          >{t('editor.images.native', { width: asset.width, height: asset.height })}</span
        >
      {/if}
    </div>
    {#if error !== null}<p class="alert alert-error" role="alert">{error}</p>{/if}
    {#if notice !== null}<p class="small muted">{notice}</p>{/if}

    <fieldset class="grid">
      <legend>{t('editor.images.calibration')}</legend>
      <label class="check">
        <input
          type="radio"
          name={`${uid}-mode`}
          checked={cal.mode === 'cell_px'}
          onchange={() => (cal = { ...cal, mode: 'cell_px' })}
        />
        {t('editor.images.mode_cell_px')}
      </label>
      {#if cal.mode === 'cell_px'}
        <input
          type="number"
          min="1"
          step="0.1"
          value={cal.cellPx}
          oninput={(e) => (cal = { ...cal, cellPx: numberOf(e) })}
          aria-label={t('editor.images.mode_cell_px')}
          data-testid="background-cell-px"
        />
      {/if}
      <label class="check">
        <input
          type="radio"
          name={`${uid}-mode`}
          checked={cal.mode === 'cells_wide'}
          onchange={() => (cal = { ...cal, mode: 'cells_wide' })}
        />
        {t('editor.images.mode_cells_wide')}
      </label>
      {#if cal.mode === 'cells_wide'}
        <input
          type="number"
          min="0.1"
          step="0.5"
          value={cal.cellsWide}
          oninput={(e) => (cal = { ...cal, cellsWide: numberOf(e) })}
          aria-label={t('editor.images.mode_cells_wide')}
        />
      {/if}
      <div class="row">
        <label>
          <span>{t('editor.images.offset_x')}</span>
          <input
            type="number"
            step="0.1"
            value={cal.offsetX}
            oninput={(e) => (cal = { ...cal, offsetX: numberOf(e) })}
          />
        </label>
        <label>
          <span>{t('editor.images.offset_y')}</span>
          <input
            type="number"
            step="0.1"
            value={cal.offsetY}
            oninput={(e) => (cal = { ...cal, offsetY: numberOf(e) })}
          />
        </label>
      </div>
    </fieldset>

    <canvas
      bind:this={canvas}
      width="360"
      height="240"
      aria-label={t('editor.images.preview')}
      data-testid="background-preview"
    ></canvas>
    {#if geometry !== null && mapSize !== null}
      <p class="small muted">
        {t('editor.images.covers', {
          width: Math.round(geometry.w * 10) / 10,
          height: Math.round(geometry.h * 10) / 10,
        })}
      </p>
    {/if}

    <div class="row actions">
      <Button size="small" onclick={fit} disabled={asset === null}>{t('editor.images.fit')}</Button>
      {#if onresize !== undefined}
        <Button
          size="small"
          onclick={() => void resize()}
          disabled={mapSize === null || busy}
          data-testid="background-resize-map"
        >
          {mapSize === null
            ? t('editor.images.resize_map')
            : t('editor.images.resize_map_to', { width: mapSize.width, height: mapSize.height })}
        </Button>
      {/if}
      <span class="spacer"></span>
      <Button onclick={close}>{t('common.cancel')}</Button>
      <Button
        variant="primary"
        onclick={apply}
        disabled={geometry === null || busy}
        data-testid="background-apply"
      >
        {t('editor.images.apply')}
      </Button>
    </div>
  </div>
</Modal>

<AssetPicker
  bind:open={pickerOpen}
  kinds={['background', 'object', 'texture', 'token']}
  taxonomy
  title={t('editor.images.background_title')}
  onpick={chosen}
/>

<style>
  .background {
    display: grid;
    gap: var(--space-3);
    min-width: min(26rem, 90vw);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .grid {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
  }
  label {
    display: grid;
    gap: var(--space-1);
  }
  .check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
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
  canvas {
    width: 100%;
    max-width: 360px;
    border: var(--border-width) solid var(--color-border);
    background: var(--color-surface-2, transparent);
  }
  .spacer {
    flex: 1;
  }
  p {
    margin: 0;
  }
</style>
