<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { SceneEngine } from '../../engine/load';
  import { minimapLayout, minimapPointToWorld, viewRect } from '../../lib/minimap';
  import { t } from '../../lib/i18n';

  /**
   * Collapsible overview of the whole map with the current view; click or drag to recentre.
   * The reduced map is redrawn at most every few seconds, only when the document changed.
   */
  interface Props {
    engine: SceneEngine;
    grid: { width: number; height: number; cellPx: number };
    viewportSize: () => { width: number; height: number };
    /** Local change counter of the document. */
    revision: () => number;
    draw: (maxPx: number) => Promise<HTMLCanvasElement>;
  }
  let { engine, grid, viewportSize, revision, draw }: Props = $props();

  const KEY = 'jdr.editor.minimap';
  const MAX_W = 200;
  const MAX_H = 150;
  const REFRESH_MS = 3000;

  function readOpen(): boolean {
    try {
      return localStorage.getItem(KEY) !== 'closed';
    } catch {
      return true;
    }
  }
  let open = $state(readOpen());
  function toggle(): void {
    open = !open;
    try {
      localStorage.setItem(KEY, open ? 'open' : 'closed');
    } catch {
      /* storage unavailable */
    }
  }

  const layout = $derived(minimapLayout(grid, MAX_W, MAX_H));
  let canvas = $state<HTMLCanvasElement>();
  // The engine and the size getter are fixed for the component's life.
  let camera = $state(untrack(() => engine.camera.get()));
  let size = $state(untrack(() => viewportSize()));
  const rect = $derived(viewRect(camera, size, grid, layout));

  let lastRevision = -1;
  let drawing = false;

  async function refresh(): Promise<void> {
    const rev = revision();
    if (!open || drawing || rev === lastRevision || canvas === undefined) return;
    drawing = true;
    try {
      const source = await draw(Math.max(layout.width, layout.height) * 2);
      const ctx = canvas?.getContext('2d');
      if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        lastRevision = rev;
      }
    } catch {
      /* the overview is optional */
    } finally {
      drawing = false;
    }
  }

  onMount(() => {
    const off = engine.onCamera((state) => {
      camera = state;
      size = viewportSize();
    });
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    void refresh();
    return () => {
      off();
      clearInterval(timer);
    };
  });

  $effect(() => {
    if (open && canvas !== undefined) {
      lastRevision = -1;
      void refresh();
    }
  });

  function recentre(event: PointerEvent): void {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const p = minimapPointToWorld(event.clientX - box.left, event.clientY - box.top, grid, layout);
    engine.camera.set({ ...engine.camera.get(), x: p.x, y: p.y });
  }
  function down(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    recentre(event);
  }
  function move(event: PointerEvent): void {
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) recentre(event);
  }
</script>

<div class="minimap" data-testid="editor-minimap">
  <button
    type="button"
    class="toggle button button-small"
    aria-expanded={open}
    onclick={toggle}
    data-testid="editor-minimap-toggle"
  >
    {open ? t('editor.minimap.hide') : t('editor.minimap.show')}
  </button>
  {#if open}
    <div
      class="surface"
      style:width="{layout.width}px"
      style:height="{layout.height}px"
      role="presentation"
      title={t('editor.minimap.title')}
      onpointerdown={down}
      onpointermove={move}
    >
      <canvas bind:this={canvas} width={layout.width} height={layout.height}></canvas>
      <div
        class="view"
        style:left="{rect.x}px"
        style:top="{rect.y}px"
        style:width="{rect.width}px"
        style:height="{rect.height}px"
      ></div>
    </div>
  {/if}
</div>

<style>
  .minimap {
    position: absolute;
    left: var(--space-2);
    bottom: var(--space-2);
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }
  .surface {
    position: relative;
    border: 1px solid var(--color-border);
    background: var(--color-surface-sunken);
    cursor: pointer;
    touch-action: none;
    overflow: hidden;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .view {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid var(--color-focus);
    pointer-events: none;
  }
</style>
