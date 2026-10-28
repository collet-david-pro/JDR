<script lang="ts">
  import { untrack } from 'svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import GenerateForm from './GenerateForm.svelte';
  import GeneratePreview from './GeneratePreview.svelte';
  import TexturePanel from './TexturePanel.svelte';
  import { zoneFromSelection } from '../../lib/procgen/zone-from-map';
  import { isMapEmpty, applyGeneration } from '../../lib/procgen/apply';
  import { createGenClient } from '../../lib/procgen/gen-client';
  import { GeneratePanelModel } from '../../lib/procgen/generate-panel.svelte';
  import { stashGeneration } from '../../lib/procgen/handoff';
  import { clearPackCache, loadPack } from '../../lib/procgen/pack';
  import { PendingOpsError } from '../../editor/versions/versions.svelte';
  import type { CellRect } from '../../editor/contracts';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';
  import type { MapsClient } from '../../lib/maps/maps-client';
  import { services } from '../../lib/services';
  import type { MapGeneration } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * "Générer" panel (P8e2b, projet.md 18.1 p.5): procedural generation (tab "Générer") and
   * procedural textures (tab "Textures"). The logic is in generate-panel.svelte.ts.
   */
  interface Props {
    session: EditorSession;
    mapId: string;
    gameId: string;
    /** maps.generation of the map: the panel opens pre-filled (regeneration). */
    generation?: MapGeneration | null | undefined;
    client: Pick<MapsClient, 'create' | 'update' | 'createVersion'>;
    /** Sends the pending operations (false when some stay unconfirmed). */
    settle: () => Promise<boolean>;
    /** False until the map is loaded and editable. */
    ready: boolean;
    onclose: () => void;
  }

  let { session, mapId, gameId, generation, client, settle, ready, onclose }: Props = $props();
  const uid = $props.id();
  let tab = $state<'generate' | 'textures'>('generate');
  let confirmOpen = $state(false);
  let announce = $state('');

  // Signed pack URLs expire: ask for a fresh pack each time the panel opens.
  clearPackCache();
  // svelte-ignore state_referenced_locally
  const initial = { session, mapId, gameId, generation, client, settle };

  function rectIsEmpty(rect: CellRect | null): boolean {
    const doc = initial.session.doc;
    if (rect === null) return isMapEmpty(doc, doc.floor);
    for (const layer of ['ground', 'terrain', 'decor'] as const) {
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          if (doc.getCell(layer, x, y).index !== 0) return false;
        }
      }
    }
    const inside = (x: number, y: number): boolean =>
      x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
    return !doc.objects().some((o) => {
      if (o.floor !== doc.floor) return false;
      switch (o.type) {
        case 'wall':
          return o.geometry.points.some((p) => inside(p[0], p[1]));
        case 'door':
        case 'window':
          return (
            inside(o.geometry.a[0], o.geometry.a[1]) || inside(o.geometry.b[0], o.geometry.b[1])
          );
        case 'light':
          return inside(o.geometry.x, o.geometry.y);
      }
    });
  }

  const model = new GeneratePanelModel({
    mapId: initial.mapId,
    gameId: initial.gameId,
    grid: initial.session.doc.grid,
    generation: initial.generation,
    client: createGenClient(),
    maps: initial.client,
    getSelection: () => initial.session.ui.selection,
    zoneOf: (rect) => zoneFromSelection(initial.session.doc, initial.session.doc.floor, rect),
    isEmpty: rectIsEmpty,
    apply: (input) => applyGeneration(initial.session, input),
    loadPack: () => loadPack(services().api),
    settle: initial.settle,
    stash: stashGeneration,
    navigate: (path) => services().router.navigate(path),
    t,
  });

  $effect(() => {
    model.key();
    untrack(() => model.schedule());
  });
  $effect(() => () => model.dispose());

  $effect(() => {
    if (model.running) announce = t('editor.generate.running');
    else if (model.status === 'ready' && !model.waiting) announce = t('editor.generate.ready');
    else if (model.status === 'error')
      announce = t('editor.generate.error_failed', { message: '' });
  });

  function requestApply(): void {
    if (model.needsConfirm()) confirmOpen = true;
    else void doApply();
  }

  async function doApply(): Promise<void> {
    try {
      const result = await model.apply();
      if (result === null || result.kind === 'created') return;
      const missing = result.report.missing;
      toasts.success(
        missing.length === 0
          ? t('editor.generate.done', {
              cells: result.report.cells,
              objects: result.report.objects,
            })
          : t('editor.generate.done_missing', {
              cells: result.report.cells,
              objects: result.report.objects,
              keys: missing.join(', '),
            }),
      );
      announce = t('editor.generate.applied');
    } catch (error) {
      if (error instanceof PendingOpsError) toasts.show('error', t('editor.versions.pending_ops'));
      else toasts.error(error);
    }
  }
</script>

<section class="generate" aria-labelledby={`${uid}-title`} data-testid="generate-panel">
  <div class="head">
    <h2 id={`${uid}-title`}>{t('editor.generate.title')}</h2>
    <button type="button" class="button button-small" data-testid="generate-close" onclick={onclose}
      >{t('editor.generate.close')}</button
    >
  </div>

  <div class="tabs" role="tablist" aria-label={t('editor.generate.tabs')}>
    {#each ['generate', 'textures'] as const as id (id)}
      <button
        type="button"
        role="tab"
        id={`${uid}-tab-${id}`}
        class="tab"
        aria-selected={tab === id}
        aria-controls={`${uid}-pane-${id}`}
        tabindex={tab === id ? 0 : -1}
        data-testid={`generate-tab-${id}`}
        onclick={() => (tab = id)}
        onkeydown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            tab = tab === 'generate' ? 'textures' : 'generate';
            e.preventDefault();
            queueMicrotask(() => document.getElementById(`${uid}-tab-${tab}`)?.focus());
          }
        }}
      >
        {id === 'generate' ? t('editor.generate.tab_generate') : t('editor.generate.tab_textures')}
      </button>
    {/each}
  </div>

  {#if tab === 'generate'}
    <div role="tabpanel" id={`${uid}-pane-generate`} aria-labelledby={`${uid}-tab-generate`}>
      <GenerateForm {model} />
      <div class="gap"></div>
      <GeneratePreview {model} />
      <button
        type="button"
        class="button button-primary apply"
        disabled={!ready || !model.canApply}
        data-testid="gen-apply"
        onclick={requestApply}
      >
        {model.busy === 'apply' ? t('editor.generate.applying') : t('editor.generate.apply')}
      </button>
      {#if !ready}
        <p class="small muted">{t('editor.generate.not_ready')}</p>
      {/if}
    </div>
  {:else}
    <div role="tabpanel" id={`${uid}-pane-textures`} aria-labelledby={`${uid}-tab-textures`}>
      <TexturePanel />
    </div>
  {/if}
  <p class="visually-hidden" aria-live="polite" data-testid="gen-live">{announce}</p>
</section>

<ConfirmDialog
  bind:open={confirmOpen}
  title={t('editor.generate.confirm_title')}
  message={model.effectiveTarget === 'selection'
    ? t('editor.generate.confirm_selection_message')
    : t('editor.generate.confirm_message')}
  confirmLabel={t('editor.generate.confirm_action')}
  danger
  confirmTestId="gen-confirm"
  onconfirm={() => {
    confirmOpen = false;
    void doApply();
  }}
/>

<style>
  .generate {
    padding: var(--space-3);
    border-bottom: var(--border-width) solid var(--color-border);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .tabs {
    display: flex;
    gap: var(--space-1);
    margin-bottom: var(--space-2);
  }
  .tab {
    flex: 1;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: inherit;
    font: inherit;
    font-size: var(--font-size-sm);
    cursor: pointer;
  }
  .tab[aria-selected='true'] {
    border-color: var(--color-accent, currentColor);
    font-weight: 600;
  }
  .gap {
    height: var(--space-2);
  }
  .apply {
    width: 100%;
    margin-top: var(--space-2);
  }
  p {
    margin: var(--space-1) 0 0;
  }
</style>
