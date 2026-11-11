<script lang="ts">
  import { untrack } from 'svelte';
  import AssetPicker from '../AssetPicker.svelte';
  import Button from '../Button.svelte';
  import Modal from '../Modal.svelte';
  import type { MapOp } from '../../editor/contracts';
  import type { ImageAssetView, ImageGeometry, ImageObject } from '../../editor/contracts-images';
  import {
    DEFAULT_IMAGE_CELL_PX,
    calibratedGeometry,
    calibrationMap,
    calibrationOf,
    fitToMap,
    mapSizeFor,
    type Calibration,
    type MapAxis,
  } from '../../editor/images/calibration';
  import { backgroundsOf, imageAssetOf } from '../../editor/images/library';
  import {
    tileGeometry,
    tileGroupOf,
    tileObjects,
    tiledOfGroup,
    uploadBackground,
    type TiledImage,
  } from '../../editor/images/tiles';
  import type { EditorSession } from '../../editor/ui/session';
  import { newObjectUid } from '../../editor/util/uid';
  import { assetsClient } from '../../lib/assets/service';
  import { t } from '../../lib/i18n';
  import type { Asset } from '../../lib/types';

  /**
   * "Image de fond…" (P14): choose or send the background of the shown floor, then calibrate it
   * (size of a cell in the image or cells across, offset) with a live preview over the grid; fit
   * it to the map, or resize the map to the image. The background is locked by default.
   * Mode "map size": the width or height of the map in cells, the other side from the image
   * proportions; applying also resizes the map (warning when it shrinks).
   */
  interface Props {
    session: EditorSession;
    /** Resizes the map (saved first, then the editor reloads). */
    /** Resizes the map, then sends `after` in the same batch (checked against the new size). */
    onresize?: (width: number, height: number, after?: readonly MapOp[]) => Promise<void>;
  }

  let { session, onresize }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  const grid = $derived(session.doc.grid);

  let asset = $state<ImageAssetView | null>(null);
  let target = $state<ImageObject | null>(null);
  /** Big picture cut in pieces (null for a one-piece image); `asset` is then the whole picture. */
  let tiled = $state<TiledImage | null>(null);
  let sending = $state<string | null>(null);
  let tileImages = $state<{ img: HTMLImageElement; rect: TiledImage['parts'][number]['rect'] }[]>(
    [],
  );
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
  let canvas: HTMLCanvasElement | null | undefined = $state();
  let image: HTMLImageElement | null = $state(null);

  const geometry = $derived<ImageGeometry | null>(
    asset === null
      ? null
      : calibratedGeometry(cal, { width: asset.width, height: asset.height }, grid),
  );
  /** Mode map_cells: the map the background is made for (preview and resize). */
  const targetMap = $derived(
    asset === null ? null : calibrationMap(cal, { width: asset.width, height: asset.height }),
  );
  const mapSize = $derived(targetMap ?? (geometry === null ? null : mapSizeFor(geometry)));
  /** Map drawn by the preview. */
  const shown = $derived(targetMap ?? grid);
  const sameSize = $derived(
    targetMap !== null && targetMap.width === grid.width && targetMap.height === grid.height,
  );
  const shrinks = $derived(
    targetMap !== null && (targetMap.width < grid.width || targetMap.height < grid.height),
  );
  const mapMode = $derived(cal.mode === 'map_cells');

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
    tiled = null;
    error = null;
    notice = null;
    if (existing !== null && existing.props.tile !== undefined) {
      const group = tiledOfGroup(tileGroupOf(objects, existing));
      const first = group === null ? null : session.doc.imageAsset(group.tiled.parts[0]!.assetId);
      if (group !== null && first !== null) {
        tiled = group.tiled;
        asset = { ...first, width: group.tiled.width, height: group.tiled.height };
        cal = calibrationOf(group.geometry, asset);
      }
      return;
    }
    if (existing !== null) {
      const view = session.doc.imageAsset(existing.props.asset_id);
      asset = view;
      if (view !== null) cal = calibrationOf(existing.geometry, view);
    }
  }

  // Preview pieces of a big picture.
  $effect(() => {
    const parts = tiled?.parts ?? [];
    tileImages = [];
    for (const part of parts) {
      const url = untrack(() => session.doc.imageAsset(part.assetId)?.url ?? null);
      if (url === null) continue;
      const img = new Image();
      img.onload = () => (tileImages = [...tileImages, { img, rect: part.rect }]);
      img.src = url;
    }
  });

  // Preview image.
  $effect(() => {
    const url = tiled === null ? (asset?.url ?? null) : null;
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
    const pieces = tileImages;
    const whole = tiled;
    // null once the dialog is unmounted (bind:this).
    if (c === undefined || c === null) return;
    const ctx = c.getContext('2d');
    if (ctx === null) return;
    const map = shown;
    const scale = Math.min(c.width / map.width, c.height / map.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 0, map.width * scale, map.height * scale);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, map.width * scale, map.height * scale);
    ctx.clip();
    if (g !== null && img !== null) {
      ctx.drawImage(img, g.x * scale, g.y * scale, g.w * scale, g.h * scale);
    }
    if (g !== null && whole !== null) {
      for (const piece of pieces) {
        const p = tileGeometry(g, {
          ...piece.rect,
          tw: whole.width,
          th: whole.height,
        });
        ctx.drawImage(piece.img, p.x * scale, p.y * scale, p.w * scale, p.h * scale);
      }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = scale >= 4 ? 1 : Math.ceil(4 / scale);
    for (let x = 0; x <= map.width; x += step) {
      ctx.moveTo(Math.round(x * scale) + 0.5, 0);
      ctx.lineTo(Math.round(x * scale) + 0.5, map.height * scale);
    }
    for (let y = 0; y <= map.height; y += step) {
      ctx.moveTo(0, Math.round(y * scale) + 0.5);
      ctx.lineTo(map.width * scale, Math.round(y * scale) + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = '#e0b040';
    ctx.strokeRect(0.5, 0.5, map.width * scale - 1, map.height * scale - 1);
  });

  function chosen(a: Asset): void {
    asset = imageAssetOf(a);
    tiled = null;
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
      const result = await uploadBackground(assetsClient(), file, t, {
        onProgress: (done, count) =>
          (sending =
            done < count ? t('editor.images.tiles_sending', { done: done + 1, count }) : null),
      });
      if (result.kind === 'single') {
        chosen(result.asset);
        if (result.reduced) {
          notice = t('editor.images.reduced', {
            width: result.asset.width,
            height: result.asset.height,
          });
        }
      } else {
        session.doc.setImageAssets(result.assets.map(imageAssetOf));
        asset = result.view;
        tiled = result.tiled;
        notice = t('editor.images.tiled', {
          width: result.tiled.width,
          height: result.tiled.height,
          count: result.tiled.parts.length,
        });
      }
    } catch (e) {
      error = e instanceof Error ? e.message : t('errors.unknown');
    } finally {
      busy = false;
      sending = null;
    }
  }

  function fit(): void {
    if (asset === null) return;
    cal = fitToMap({ width: asset.width, height: asset.height }, grid);
  }

  /** The ops that place the background (update of the edited one, or new image objects). */
  function backgroundOps(): MapOp[] {
    const g = geometry;
    const a = asset;
    if (g === null || a === null) return [];
    const objects = session.doc.objects();
    const current = target === null ? undefined : session.doc.object(target.uid);
    const old = current?.type === 'image' ? tileGroupOf(objects, current) : [];
    const group = tiled;
    if (group !== null) {
      const sameGroup = old.length > 0 && old[0]!.props.tile?.group === group.group;
      if (sameGroup) {
        const ops: MapOp[] = [];
        for (const member of old) {
          const live = session.doc.object(member.uid);
          const tile = member.props.tile;
          if (live === undefined || live.type !== 'image' || tile === undefined) continue;
          ops.push({
            type: 'object.update',
            uid: live.uid,
            rev: live.rev,
            patch: { geometry: tileGeometry(g, tile) },
          });
        }
        return ops;
      }
      return [
        ...removalOps(old),
        ...tileObjects(session.doc.floor, g, group).map((object): MapOp => ({
          type: 'object.add',
          object,
        })),
      ];
    }
    const live = target === null ? undefined : session.doc.object(target.uid);
    if (
      live !== undefined &&
      live.type === 'image' &&
      old.length <= 1 &&
      live.props.tile === undefined
    ) {
      return [
        {
          type: 'object.update',
          uid: live.uid,
          rev: live.rev,
          patch: { geometry: g, props: { ...live.props, asset_id: a.assetId } },
        },
      ];
    }
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
    return [...removalOps(old), { type: 'object.add', object }];
  }

  /** Removal of the background (or of all the pieces of a picture) that is replaced. */
  function removalOps(members: readonly ImageObject[]): MapOp[] {
    return members.map((m): MapOp => ({ type: 'object.remove', uid: m.uid }));
  }

  function apply(): void {
    const ops = backgroundOps();
    if (ops.length === 0) return;
    session.history.execute({ label: 'editor.command.background', ops, inverseOps: [] });
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

  /** Mode map_cells with a new size: one batch, the resize first, so the server checks the background against it. */
  async function resizeWithBackground(width: number, height: number): Promise<void> {
    const ops = backgroundOps();
    if (ops.length === 0 || onresize === undefined) return;
    busy = true;
    try {
      await onresize(width, height, ops);
    } catch (e) {
      error = e instanceof Error ? e.message : t('errors.unknown');
    } finally {
      busy = false;
    }
  }

  /** Mode map_cells: the background, then the map at its new size (when it changes). */
  function applyMapSize(): void {
    if (sameSize || onresize === undefined || targetMap === null) apply();
    else void resizeWithBackground(targetMap.width, targetMap.height);
  }

  function useMapCells(): void {
    cal = {
      ...cal,
      mode: 'map_cells',
      mapAxis: cal.mapAxis ?? 'width',
      mapCells: cal.mapCells ?? grid.width,
    };
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
    {#if sending !== null}<p class="small muted" role="status">{sending}</p>{/if}

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
      <label class="check">
        <input
          type="radio"
          name={`${uid}-mode`}
          checked={mapMode}
          onchange={useMapCells}
          data-testid="background-mode-map"
        />
        {t('editor.images.mode_map_cells')}
      </label>
      {#if mapMode}
        <div class="row">
          <label>
            <span>{t('editor.images.map_axis')}</span>
            <select
              value={cal.mapAxis ?? 'width'}
              onchange={(e) =>
                (cal = {
                  ...cal,
                  mapAxis: (e.currentTarget as HTMLSelectElement).value as MapAxis,
                })}
              data-testid="background-map-axis"
            >
              <option value="width">{t('editor.images.map_axis_width')}</option>
              <option value="height">{t('editor.images.map_axis_height')}</option>
            </select>
          </label>
          <label>
            <span>{t('editor.images.map_cells')}</span>
            <input
              type="number"
              min="1"
              max="400"
              step="1"
              value={cal.mapCells ?? grid.width}
              oninput={(e) => (cal = { ...cal, mapCells: numberOf(e) })}
              data-testid="background-map-cells"
            />
          </label>
        </div>
        {#if targetMap !== null}
          <p
            class="small muted"
            data-testid="background-map-result"
            data-width={targetMap.width}
            data-height={targetMap.height}
          >
            {t('editor.images.map_result', { width: targetMap.width, height: targetMap.height })}
          </p>
        {/if}
        {#if shrinks}
          <p class="alert alert-warning small" role="status">{t('editor.images.map_shrinks')}</p>
        {/if}
      {/if}
      {#if !mapMode}
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
      {/if}
    </fieldset>

    <canvas
      bind:this={canvas}
      width="360"
      height="240"
      aria-label={t('editor.images.preview')}
      data-testid="background-preview"
    ></canvas>
    {#if geometry !== null && mapSize !== null && !mapMode}
      <p class="small muted">
        {t('editor.images.covers', {
          width: Math.round(geometry.w * 10) / 10,
          height: Math.round(geometry.h * 10) / 10,
        })}
      </p>
    {/if}

    <div class="row actions">
      {#if !mapMode}
        <Button size="small" onclick={fit} disabled={asset === null}
          >{t('editor.images.fit')}</Button
        >
      {/if}
      {#if onresize !== undefined && !mapMode}
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
      {#if mapMode && targetMap !== null && !sameSize && onresize !== undefined}
        <Button
          variant="primary"
          onclick={applyMapSize}
          disabled={geometry === null || busy}
          data-testid="background-apply"
        >
          {t('editor.images.apply_resize', { width: targetMap.width, height: targetMap.height })}
        </Button>
      {:else}
        <Button
          variant="primary"
          onclick={apply}
          disabled={geometry === null || busy}
          data-testid="background-apply"
        >
          {t('editor.images.apply')}
        </Button>
      {/if}
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
