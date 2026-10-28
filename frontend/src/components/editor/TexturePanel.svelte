<script lang="ts">
  import { untrack } from 'svelte';
  import { failureFromError, failureText } from '../../lib/assets/upload-errors';
  import { assetsClient } from '../../lib/assets/service';
  import { t } from '../../lib/i18n';
  import { TexturePanelModel, type TextureSize } from '../../lib/procgen/texture-panel.svelte';
  import { href } from '../../lib/services';
  import type { Material } from '../../procgen/textures';

  /** "Textures" tab: procedural seamless texture, 3x3 preview, save to the library. */
  const uid = $props.id();
  const model = new TexturePanelModel({
    upload: (file, name, fields) => assetsClient().upload(file, name, fields),
    t,
  });
  let canvas: HTMLCanvasElement | undefined = $state();
  let failure = $state<string | null>(null);

  $effect(() => {
    model.key();
    untrack(() => {
      failure = null;
      model.render();
    });
  });

  $effect(() => {
    const host = canvas;
    const pixels = model.pixels;
    if (host === undefined || pixels === null) return;
    const size = model.size;
    const tile = document.createElement('canvas');
    tile.width = size;
    tile.height = size;
    tile
      .getContext('2d')
      ?.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0);
    host.width = size * 3;
    host.height = size * 3;
    const ctx = host.getContext('2d');
    if (ctx === null) return;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) ctx.drawImage(tile, x * size, y * size);
  });

  async function save(): Promise<void> {
    failure = null;
    try {
      await model.save();
    } catch (error) {
      failure = failureText(failureFromError(error, null), t);
    }
  }
</script>

<div class="textures" data-testid="texture-panel">
  <label class="field" for={`${uid}-material`}>
    <span>{t('editor.textures.material')}</span>
    <select
      id={`${uid}-material`}
      class="control"
      value={model.material}
      data-testid="texture-material"
      onchange={(e) => model.setMaterial(e.currentTarget.value as Material)}
    >
      {#each model.materials as id (id)}
        <option value={id}>{t(`procgen.materials.${id}`)}</option>
      {/each}
    </select>
  </label>
  <label class="field" for={`${uid}-palette`}>
    <span>{t('editor.textures.palette')}</span>
    <select
      id={`${uid}-palette`}
      class="control"
      bind:value={model.palette}
      data-testid="texture-palette"
    >
      {#each model.palettes as palette (palette.id)}
        <option value={palette.id}>{palette.name}</option>
      {/each}
    </select>
  </label>
  <label class="field" for={`${uid}-size`}>
    <span>{t('editor.textures.size')}</span>
    <select
      id={`${uid}-size`}
      class="control"
      value={String(model.size)}
      data-testid="texture-size"
      onchange={(e) => (model.size = Number(e.currentTarget.value) as TextureSize)}
    >
      {#each model.sizes as size (size)}
        <option value={String(size)}>{size} px</option>
      {/each}
    </select>
  </label>
  <div class="field">
    <label for={`${uid}-seed`}>{t('editor.generate.seed')}</label>
    <div class="row">
      <input
        id={`${uid}-seed`}
        class="control grow"
        type="text"
        maxlength="64"
        autocomplete="off"
        spellcheck="false"
        bind:value={model.seed}
        data-testid="texture-seed"
      />
      <button
        type="button"
        class="button button-small"
        title={t('editor.generate.seed_roll')}
        aria-label={t('editor.generate.seed_roll')}
        data-testid="texture-seed-roll"
        onclick={() => model.rollSeed()}><span aria-hidden="true">🎲</span></button
      >
    </div>
  </div>

  {#if model.pixels !== null}
    <div role="img" aria-label={t('editor.textures.preview_alt')}>
      <canvas bind:this={canvas} data-testid="texture-canvas"></canvas>
    </div>
    <p class="small muted">{t('editor.textures.preview_hint')}</p>
  {/if}
  {#if model.error !== null}
    <p class="alert alert-error small" role="alert">{model.error}</p>
  {/if}

  <button
    type="button"
    class="button button-primary"
    disabled={model.pixels === null || model.saving}
    data-testid="texture-save"
    onclick={() => void save()}
  >
    {model.saving ? t('editor.textures.saving') : t('editor.textures.save')}
  </button>
  <div aria-live="polite">
    {#if failure !== null}
      <p class="alert alert-error small" role="alert" data-testid="texture-error">{failure}</p>
    {:else if model.saved !== null}
      <p class="small" data-testid="texture-saved" data-asset-id={model.saved.asset.id}>
        {model.saved.duplicate ? t('editor.textures.duplicate') : t('editor.textures.saved')}
        <a href={href('/library')}>{t('editor.textures.library_link')}</a>
      </p>
    {/if}
  </div>
</div>

<style>
  .textures {
    display: grid;
    gap: var(--space-2);
  }
  .field {
    display: grid;
    gap: 2px;
    font-size: var(--font-size-sm);
  }
  .row {
    display: flex;
    gap: var(--space-1);
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .control {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-sm);
    min-width: 0;
  }
  canvas {
    width: 100%;
    aspect-ratio: 1;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
  }
  p {
    margin: 0;
  }
</style>
