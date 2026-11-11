<script lang="ts">
  import type { LinkMapInfo } from '../../editor/ui/link-targets';
  import { pickPoint } from '../../editor/ui/point-pick';
  import { t } from '../../lib/i18n';
  import Modal from '../Modal.svelte';

  /**
   * Picks the arrival point of a link on the preview of the target map. A click returns the point (half
   * cells); Escape or the close button cancels. The preview is the map thumbnail (all floors merged).
   */
  interface Props {
    open: boolean;
    info: LinkMapInfo | null;
    failed?: boolean;
    point: { x: number | null; y: number | null };
    onpick: (x: number, y: number) => void;
  }

  let { open = $bindable(), info, failed = false, point, onpick }: Props = $props();
  let surface: HTMLDivElement | undefined = $state();

  function click(event: MouseEvent): void {
    if (surface === undefined || info === null) return;
    const r = surface.getBoundingClientRect();
    const p = pickPoint(r, event.clientX, event.clientY, info);
    if (p === null) return;
    onpick(p[0], p[1]);
    open = false;
  }
</script>

<Modal bind:open title={t('editor.link.pick_title')}>
  <p class="small muted">{t('editor.link.pick_hint')}</p>
  {#if failed}
    <p role="status">{t('editor.link.load_failed')}</p>
  {:else if info === null}
    <p class="small muted" role="status">{t('common.loading')}</p>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      bind:this={surface}
      class="surface"
      data-testid="link-pick-surface"
      style:aspect-ratio={`${info.width} / ${info.height}`}
      style:--cols={info.width}
      style:--rows={info.height}
      onclick={click}
    >
      {#if info.thumbUrl !== null}
        <img src={info.thumbUrl} alt="" draggable="false" />
      {/if}
      {#if point.x !== null && point.y !== null}
        <span
          class="dot"
          style:left={`${(point.x / info.width) * 100}%`}
          style:top={`${(point.y / info.height) * 100}%`}
        ></span>
      {/if}
    </div>
  {/if}
</Modal>

<style>
  .surface {
    position: relative;
    width: 100%;
    cursor: crosshair;
    border: var(--border-width) solid var(--color-border-strong);
    background-color: var(--color-surface-alt, var(--color-surface));
    background-image:
      linear-gradient(to right, var(--color-border) 1px, transparent 1px),
      linear-gradient(to bottom, var(--color-border) 1px, transparent 1px);
    background-size: calc(100% / var(--cols)) calc(100% / var(--rows));
  }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
    pointer-events: none;
  }
  .dot {
    position: absolute;
    width: 14px;
    height: 14px;
    transform: translate(-50%, -50%);
    border: 2px solid var(--color-surface);
    border-radius: 50%;
    background: var(--color-danger, #b3261e);
    pointer-events: none;
  }
  p {
    margin: 0 0 var(--space-2);
  }
</style>
