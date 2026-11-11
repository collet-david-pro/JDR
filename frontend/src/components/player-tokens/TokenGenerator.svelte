<script lang="ts">
  import ColorField from '../ColorField.svelte';
  import ErrorAlert from '../ErrorAlert.svelte';
  import Modal from '../Modal.svelte';
  import TextField from '../TextField.svelte';
  import { describeError, type ErrorSummary } from '../../lib/errors';
  import { t } from '../../lib/i18n';
  import {
    defaultDesign,
    panCrop,
    parseDesign,
    RING_MAX,
    serializeDesign,
    SHAPES,
    sourceSize,
    TOKEN_PX,
    zoomCrop,
    ZOOM_MAX,
    ZOOM_MIN,
    type GeneratedToken,
    type TokenDesign,
  } from '../../lib/player-tokens/design';
  import { EMBLEM_IDS, EMBLEMS, SHAPE_PATHS } from '../../lib/player-tokens/emblems';
  import { drawToken, type PortraitSource } from '../../lib/player-tokens/render';
  import { playerTokensClient, type PlayerToken } from '../../lib/player-tokens/client';

  /**
   * Token generator (loaded on demand): shape, colours, ring, then an emblem or a portrait
   * cropped in the shape. Live preview on a 2D canvas; the final 512 px PNG is sent to the server.
   */
  interface Props {
    open: boolean;
    /** null: new token; else the token being edited again. */
    token?: PlayerToken | null;
    /** Player collection: the saved token. */
    onsaved?: (token: PlayerToken) => void;
    /**
     * Library mode (GM tokens: NPCs, monsters...): receives the image instead of the player
     * collection; the dialog closes once it resolves.
     */
    onsubmit?: (result: GeneratedToken) => Promise<void>;
    /** Name proposed for a new token. */
    initialName?: string;
  }

  let { open = $bindable(), token = null, onsaved, onsubmit, initialName = '' }: Props = $props();

  const PREVIEW = 256;
  const STEP = 3;
  const uid = $props.id();

  let name = $state('');
  let design = $state<TokenDesign>(defaultDesign());
  let portrait = $state.raw<PortraitSource | null>(null);
  /** Portrait file chosen in this session (stored as the editable source). */
  let portraitBlob = $state.raw<Blob | null>(null);
  let canvas: HTMLCanvasElement | undefined = $state();
  let busy = $state(false);
  let failure = $state.raw<ErrorSummary | null>(null);
  let nameError = $state<string | null>(null);
  let pointers: { id: number; x: number; y: number }[] = [];
  let pinchStart: { dist: number; zoom: number } | null = null;

  $effect(() => {
    if (!open) return;
    failure = null;
    nameError = null;
    busy = false;
    portraitBlob = null;
    portrait = null;
    if (token === null) {
      name = initialName;
      design = defaultDesign();
      return;
    }
    name = token.name;
    design = parseDesign(token.design, EMBLEM_IDS);
    if (token.source_image !== null) void loadFromUrl(token.source_image.full);
  });

  // Live preview.
  $effect(() => {
    if (canvas === undefined || !open) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    drawToken(ctx, { ...design, crop: { ...design.crop } }, PREVIEW, portrait);
  });

  async function loadFromUrl(url: string): Promise<void> {
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      portrait = { image, width: image.naturalWidth, height: image.naturalHeight };
    } catch {
      portrait = null;
    }
  }

  async function chooseFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    failure = null;
    try {
      const bitmap = await createImageBitmap(file);
      const size = sourceSize(bitmap.width, bitmap.height);
      const c = document.createElement('canvas');
      c.width = size.w;
      c.height = size.h;
      const cx = c.getContext('2d');
      if (cx === null) throw new Error('canvas');
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, size.w, size.h);
      cx.drawImage(bitmap, 0, 0, size.w, size.h);
      const blob = await toBlob(c, 'image/jpeg', 0.9);
      portraitBlob = blob;
      portrait = { image: c, width: size.w, height: size.h };
      design.mode = 'portrait';
      design.crop = { zoom: 1, ox: 0, oy: 0 };
    } catch {
      failure = { message: t('player_tokens.gen.image_error'), requestId: null };
    }
  }

  function toBlob(source: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      source.toBlob((b) => (b === null ? reject(new Error('toBlob')) : resolve(b)), type, quality);
    });
  }

  /** Pointer move in preview pixels -> crop units (the crop box is 100 wide). */
  function toUnits(px: number): number {
    return (px * 100) / PREVIEW;
  }

  function pan(dx: number, dy: number): void {
    if (portrait === null) return;
    design.crop = panCrop(portrait.width, portrait.height, design.crop, 100, dx, dy);
  }

  function zoomTo(zoom: number): void {
    if (portrait === null) return;
    design.crop = zoomCrop(portrait.width, portrait.height, design.crop, 100, zoom);
  }

  function pointerDown(event: PointerEvent): void {
    if (design.mode !== 'portrait' || portrait === null) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers = [
      ...pointers.filter((p) => p.id !== event.pointerId),
      { id: event.pointerId, x: event.clientX, y: event.clientY },
    ];
    const [a, b] = pointers;
    if (pointers.length === 2 && a !== undefined && b !== undefined) {
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: design.crop.zoom };
    }
  }

  function pointerMove(event: PointerEvent): void {
    const last = pointers.find((p) => p.id === event.pointerId);
    if (last === undefined) return;
    const now = { id: event.pointerId, x: event.clientX, y: event.clientY };
    pointers = pointers.map((p) => (p.id === now.id ? now : p));
    if (pointers.length === 1) {
      const scale = PREVIEW / ((event.currentTarget as HTMLElement).clientWidth || PREVIEW);
      pan(toUnits((now.x - last.x) * scale), toUnits((now.y - last.y) * scale));
    } else if (pointers.length === 2 && pinchStart !== null) {
      const [a, b] = pointers;
      if (a !== undefined && b !== undefined) {
        zoomTo((pinchStart.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinchStart.dist);
      }
    }
  }

  function pointerUp(event: PointerEvent): void {
    pointers = pointers.filter((p) => p.id !== event.pointerId);
    if (pointers.length < 2) pinchStart = null;
  }

  function wheel(event: WheelEvent): void {
    if (design.mode !== 'portrait' || portrait === null) return;
    event.preventDefault();
    zoomTo(design.crop.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  }

  function keydown(event: KeyboardEvent): void {
    if (design.mode !== 'portrait' || portrait === null) return;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-STEP, 0],
      ArrowRight: [STEP, 0],
      ArrowUp: [0, -STEP],
      ArrowDown: [0, STEP],
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      pan(move[0], move[1]);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomTo(design.crop.zoom * 1.1);
    } else if (event.key === '-') {
      event.preventDefault();
      zoomTo(design.crop.zoom / 1.1);
    }
  }

  const canSave = $derived(
    !busy && name.trim() !== '' && (design.mode !== 'portrait' || portrait !== null),
  );

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    nameError = name.trim() === '' ? t('player_tokens.gen.name_required') : null;
    if (nameError !== null || !canSave) return;
    busy = true;
    failure = null;
    try {
      const out = document.createElement('canvas');
      out.width = TOKEN_PX;
      out.height = TOKEN_PX;
      const ctx = out.getContext('2d');
      if (ctx === null) throw new Error('canvas');
      drawToken(ctx, design, TOKEN_PX, portrait);
      const png = await toBlob(out, 'image/png');
      if (onsubmit !== undefined) {
        await onsubmit({ name: name.trim(), png });
        open = false;
        return;
      }
      const usePortrait = design.mode === 'portrait';
      const input = {
        name: name.trim(),
        design: serializeDesign(design),
        png,
        source: usePortrait ? portraitBlob : null,
        keepSource: usePortrait && portraitBlob === null,
      };
      const saved =
        token === null
          ? await playerTokensClient().create(input)
          : await playerTokensClient().redesign(token.id, input);
      open = false;
      onsaved?.(saved);
    } catch (error) {
      failure = describeError(error, t);
    } finally {
      busy = false;
    }
  }

  const shapeLabels: Record<string, string> = {
    disc: t('player_tokens.shape.disc'),
    hex: t('player_tokens.shape.hex'),
    shield: t('player_tokens.shape.shield'),
    square: t('player_tokens.shape.square'),
    diamond: t('player_tokens.shape.diamond'),
  };
  const groups = [
    { id: 'class', label: t('player_tokens.group.class') },
    { id: 'creature', label: t('player_tokens.group.creature') },
    { id: 'symbol', label: t('player_tokens.group.symbol') },
  ] as const;
</script>

<Modal
  bind:open
  title={onsubmit !== undefined
    ? t('games.tokens.generate_title')
    : token === null
      ? t('player_tokens.gen.create_title')
      : t('player_tokens.gen.edit_title')}
>
  <form class="gen stack" novalidate onsubmit={save} data-testid="token-generator">
    <div class="stage-row">
      <button
        type="button"
        class="stage"
        class:draggable={design.mode === 'portrait' && portrait !== null}
        aria-label={t('player_tokens.gen.preview')}
        aria-describedby={`${uid}-hint`}
        onpointerdown={pointerDown}
        onpointermove={pointerMove}
        onpointerup={pointerUp}
        onpointercancel={pointerUp}
        onwheel={wheel}
        onkeydown={keydown}
      >
        <canvas bind:this={canvas} width={PREVIEW} height={PREVIEW} data-testid="token-preview"
        ></canvas>
      </button>
      <p id={`${uid}-hint`} class="muted small">
        {design.mode === 'portrait'
          ? t('player_tokens.gen.portrait_hint')
          : t('player_tokens.gen.preview_hint')}
      </p>
    </div>

    <TextField
      label={t('player_tokens.gen.name')}
      name="name"
      bind:value={name}
      required
      maxlength={80}
      autocomplete="off"
      error={nameError}
    />

    <fieldset>
      <legend>{t('player_tokens.gen.shape')}</legend>
      <div class="chips">
        {#each SHAPES as shape (shape)}
          <button
            type="button"
            class="chip"
            aria-pressed={design.shape === shape}
            aria-label={shapeLabels[shape]}
            title={shapeLabels[shape]}
            onclick={() => (design.shape = shape)}
          >
            <svg viewBox="0 0 100 100" aria-hidden="true"
              ><path d={SHAPE_PATHS[shape]} fill="currentColor" /></svg
            >
          </button>
        {/each}
      </div>
    </fieldset>

    <div class="grid2">
      <ColorField label={t('player_tokens.gen.bg')} bind:value={design.bg} />
      <ColorField label={t('player_tokens.gen.ring')} bind:value={design.ring} />
    </div>
    <label class="range">
      <span>{t('player_tokens.gen.ring_width')}</span>
      <input type="range" min="0" max={RING_MAX} step="0.01" bind:value={design.ringWidth} />
    </label>

    <fieldset>
      <legend>{t('player_tokens.gen.mode')}</legend>
      <div class="chips">
        <button
          type="button"
          class="button button-small"
          aria-pressed={design.mode === 'emblem'}
          onclick={() => (design.mode = 'emblem')}>{t('player_tokens.gen.mode_emblem')}</button
        >
        <button
          type="button"
          class="button button-small"
          aria-pressed={design.mode === 'portrait'}
          data-testid="mode-portrait"
          onclick={() => (design.mode = 'portrait')}>{t('player_tokens.gen.mode_portrait')}</button
        >
      </div>
    </fieldset>

    {#if design.mode === 'emblem'}
      <ColorField label={t('player_tokens.gen.emblem_color')} bind:value={design.emblemColor} />
      {#each groups as group (group.id)}
        <fieldset>
          <legend>{group.label}</legend>
          <div class="chips">
            {#each EMBLEMS.filter((e) => e.group === group.id) as emblem (emblem.id)}
              <button
                type="button"
                class="chip"
                aria-pressed={design.emblem === emblem.id}
                aria-label={t(`player_tokens.emblems.${emblem.id}`)}
                title={t(`player_tokens.emblems.${emblem.id}`)}
                onclick={() => (design.emblem = emblem.id)}
              >
                <svg viewBox="0 0 100 100" aria-hidden="true"
                  ><path d={emblem.path} fill="currentColor" fill-rule="evenodd" /></svg
                >
              </button>
            {/each}
          </div>
        </fieldset>
      {/each}
    {:else}
      <div class="stack">
        <label class="file">
          <span>{t('player_tokens.gen.choose_image')}</span>
          <input type="file" accept="image/*" onchange={chooseFile} data-testid="portrait-file" />
        </label>
        {#if portrait !== null}
          <label class="range">
            <span>{t('player_tokens.gen.zoom')}</span>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step="0.05"
              value={design.crop.zoom}
              oninput={(e) => zoomTo(Number(e.currentTarget.value))}
            />
          </label>
        {:else}
          <p class="muted small">{t('player_tokens.gen.no_image')}</p>
        {/if}
      </div>
    {/if}

    <ErrorAlert {failure} />
    <div class="row actions">
      <button type="button" class="button" onclick={() => (open = false)}>
        {t('common.cancel')}
      </button>
      <button
        type="submit"
        class="button button-primary"
        disabled={!canSave}
        aria-busy={busy ? 'true' : undefined}
        data-testid="token-save">{t('player_tokens.gen.save')}</button
      >
    </div>
  </form>
</Modal>

<style>
  .gen {
    display: grid;
    gap: var(--space-3);
  }
  .stage-row {
    display: grid;
    justify-items: center;
    gap: var(--space-2);
  }
  .stage {
    padding: 0;
    border: var(--border-width) dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-sunken);
    touch-action: none;
    line-height: 0;
  }
  .stage.draggable {
    cursor: grab;
  }
  canvas {
    width: min(16rem, 70vw);
    height: auto;
    aspect-ratio: 1;
  }
  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: var(--space-3);
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
  legend {
    font-weight: 600;
    margin-bottom: var(--space-1);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .chip {
    width: 2.75rem;
    height: 2.75rem;
    padding: var(--space-1);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
  }
  .chip[aria-pressed='true'],
  .button[aria-pressed='true'] {
    outline: 2px solid var(--color-accent, currentColor);
    background: var(--color-surface-sunken);
  }
  .chip svg {
    width: 100%;
    height: 100%;
  }
  .range,
  .file {
    display: grid;
    gap: var(--space-1);
  }
  .actions {
    justify-content: flex-end;
  }
  .small {
    font-size: var(--font-size-sm);
    margin: 0;
    text-align: center;
  }
</style>
