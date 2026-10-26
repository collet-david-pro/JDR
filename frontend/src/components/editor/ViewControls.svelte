<script lang="ts">
  import type { EditorSession } from '../../editor/ui/session';
  import type { ViewState } from '../../editor/state.svelte';
  import { t } from '../../lib/i18n';

  /**
   * View of the map (projet.md 14.2, 18.1 p.5 "vue joueur"): GM view or "see as" a placed token
   * / every PC, render switches, fog exploration, fog reset, performance mode.
   */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const view = $derived(ui.view);
  const tokens = $derived(ui.sceneItems.filter((i) => i.kind === 'token'));
  const choice = $derived(view.mode === 'gm' ? 'gm' : view.viewer);

  function choose(value: string): void {
    if (value === 'gm') session.scene.setView({ mode: 'gm' });
    else session.scene.setView({ mode: 'player', viewer: value });
  }

  type Switch = 'lighting' | 'fog' | 'shadows' | 'explore';
  const switches: Switch[] = ['lighting', 'fog', 'shadows', 'explore'];
  function switchLabel(key: Switch): string {
    switch (key) {
      case 'lighting':
        return t('editor.view.lighting');
      case 'fog':
        return t('editor.view.fog');
      case 'shadows':
        return t('editor.view.shadows');
      case 'explore':
        return t('editor.view.explore');
    }
  }
</script>

<div class="group view" role="group" aria-label={t('editor.view.label')}>
  <label class="inline">
    <span class="visually-hidden">{t('editor.view.label')}</span>
    <select
      class="select"
      value={choice}
      title={t('editor.view.label')}
      data-testid="view-mode"
      onchange={(e) => choose(e.currentTarget.value)}
    >
      <option value="gm">{t('editor.view.gm')}</option>
      <option value="all_pcs">{t('editor.view.all_pcs')}</option>
      {#each tokens as token (token.uid)}
        <option value={token.uid}
          >{t('editor.view.as_token', { name: token.name ?? token.uid })}</option
        >
      {/each}
    </select>
  </label>
  {#each switches as key (key)}
    <label class="inline check" title={key === 'explore' ? t('editor.view.explore_hint') : null}>
      <input
        type="checkbox"
        checked={view[key]}
        data-testid={`view-${key}`}
        onchange={(e) =>
          session.scene.setView({ [key]: e.currentTarget.checked } as Partial<ViewState>)}
      />
      {switchLabel(key)}
    </label>
  {/each}
  <label class="inline">
    <span class="visually-hidden">{t('editor.view.performance')}</span>
    <select
      class="select"
      value={view.performance}
      title={t('editor.view.performance')}
      data-testid="view-performance"
      onchange={(e) =>
        session.scene.setView({ performance: e.currentTarget.value as ViewState['performance'] })}
    >
      <option value="auto">{t('editor.view.performance_auto')}</option>
      <option value="on">{t('editor.view.performance_on')}</option>
      <option value="off">{t('editor.view.performance_off')}</option>
    </select>
  </label>
  <button
    type="button"
    class="button button-small"
    aria-haspopup="dialog"
    disabled={ui.save === null}
    data-testid="fog-reset"
    onclick={() => (ui.resetFogOpen = true)}>{t('editor.view.fog_reset')}</button
  >
</div>

<style>
  .group {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    align-items: center;
  }
  .inline {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
    font-size: var(--font-size-sm);
  }
  .select {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-sm);
  }
</style>
