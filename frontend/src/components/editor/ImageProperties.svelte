<script lang="ts">
  import Button from '../Button.svelte';
  import type { MapObject } from '../../editor/contracts';
  import type { ImagePlacement, ImageProps } from '../../editor/contracts-images';
  import { imagePatch, imagesOf } from '../../editor/images/library';
  import { common } from '../../editor/ui/properties';
  import { objectTypeLabel } from '../../editor/ui/scene-labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /** Properties of the selected image objects (P14): opacity, mirrors, placement, background. */
  interface Props {
    session: EditorSession;
    objects: readonly MapObject[];
  }

  let { session, objects }: Props = $props();
  const images = $derived(imagesOf(objects));
  const prop = <K extends keyof ImageProps>(k: K) => common(images, (o) => o.props[k]);
  const set = (change: Partial<ImageProps>) =>
    session.scene.patchObjects(
      images.map((o) => o.uid),
      (o) => imagePatch(o, change),
    );
  const show = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
  const opacity = $derived(prop('opacity'));
</script>

{#if images.length > 0}
  <fieldset class="grid" data-testid="properties-image">
    <legend>{objectTypeLabel('image')}</legend>
    <label>
      <span
        >{t('editor.images.opacity', {
          value: typeof opacity === 'number' ? Math.round(opacity * 100) : '—',
        })}</span
      >
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={show(opacity)}
        onchange={(e) => set({ opacity: Number((e.currentTarget as HTMLInputElement).value) })}
        data-testid="image-opacity"
      />
    </label>
    <label>
      <span>{t('editor.images.placement')}</span>
      <select
        value={show(prop('placement'))}
        onchange={(e) =>
          set({ placement: (e.currentTarget as HTMLSelectElement).value as ImagePlacement })}
      >
        <option value="" disabled>{t('editor.properties.mixed')}</option>
        <option value="above">{t('editor.images.placement_above')}</option>
        <option value="background">{t('editor.images.placement_background')}</option>
      </select>
    </label>
    <label class="check">
      <input
        type="checkbox"
        checked={prop('flip_h') === true}
        onchange={(e) => set({ flip_h: (e.currentTarget as HTMLInputElement).checked })}
      />
      {t('editor.images.flip_h')}
    </label>
    <label class="check">
      <input
        type="checkbox"
        checked={prop('flip_v') === true}
        onchange={(e) => set({ flip_v: (e.currentTarget as HTMLInputElement).checked })}
      />
      {t('editor.images.flip_v')}
    </label>
    {#if images.length === 1 && images[0]?.props.placement === 'background'}
      <Button
        size="small"
        onclick={() => {
          session.ui.backgroundTarget = images[0]?.uid ?? null;
          session.ui.backgroundOpen = true;
        }}
      >
        {t('editor.images.recalibrate')}
      </Button>
    {/if}
  </fieldset>
{/if}

<style>
  .grid {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
  }
  legend {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
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
</style>
