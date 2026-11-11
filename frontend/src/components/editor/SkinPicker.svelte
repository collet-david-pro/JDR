<script lang="ts">
  import AssetPicker from '../AssetPicker.svelte';
  import Button from '../Button.svelte';
  import { IMAGE_ASSET_KINDS } from '../../editor/contracts-images';
  import { imageAssetOf } from '../../editor/images/library';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';
  import type { Asset, AssetKind } from '../../lib/types';

  /**
   * Choice of the library image of a wall texture or a door image: thumbnail, "Choose" and
   * "Remove" buttons. `value` undefined = the selection differs (mixed); null = none.
   */
  interface Props {
    session: EditorSession;
    label: string;
    value: string | null | undefined;
    /** Kind offered first in the picker. */
    kinds?: readonly AssetKind[];
    testid: string;
    onchange: (assetId: string | null) => void;
  }

  let { session, label, value, kinds = IMAGE_ASSET_KINDS, testid, onchange }: Props = $props();
  let open = $state(false);

  let tick = $state(0);
  $effect(() =>
    session.doc.onSceneChanged((event) => {
      if (event.images === true) tick++;
    }),
  );

  const view = $derived.by(() => {
    void tick;
    return typeof value === 'string' ? session.doc.imageAsset(value) : null;
  });

  function pick(asset: Asset): void {
    session.doc.setImageAssets([imageAssetOf(asset)]);
    onchange(String(asset.id));
  }
</script>

<div class="skin" data-testid={testid}>
  <span class="label">{label}</span>
  <div class="row">
    {#if value === undefined}
      <span class="small muted">{t('editor.properties.mixed')}</span>
    {:else if value === null}
      <span class="small muted">{t('editor.skin.none')}</span>
    {:else if view !== null && view.url !== null}
      <img src={view.url} alt="" width="32" height="32" />
      <span class="small name">{view.name}</span>
    {:else}
      <span class="small muted">{t('editor.skin.loading')}</span>
    {/if}
  </div>
  <div class="row">
    <Button size="small" onclick={() => (open = true)} data-testid={`${testid}-choose`}>
      {t('editor.skin.choose')}
    </Button>
    {#if value !== null}
      <Button size="small" onclick={() => onchange(null)} data-testid={`${testid}-clear`}>
        {t('editor.skin.clear')}
      </Button>
    {/if}
  </div>
</div>

<AssetPicker
  bind:open
  kinds={['texture', ...kinds.filter((k) => k !== 'texture')]}
  taxonomy
  title={label}
  onpick={pick}
/>

<style>
  .skin {
    display: grid;
    gap: var(--space-1);
  }
  .row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  img {
    object-fit: cover;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
