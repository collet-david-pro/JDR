<script lang="ts">
  import { FOG_BRUSH_MAX, FOG_BRUSH_MIN } from '../../editor/tools/types';
  import { t } from '../../lib/i18n';
  import type { ConsoleTool } from '../../lib/sessions/console/console-input';
  import type { PanelProps } from '../../lib/sessions/console/panel-props';

  /**
   * Console panel "Révéler": fog tools (brush, rectangle; reveal or hide) and the reveal of
   * the selected secret object / hidden token. A click on a door or a light on the map toggles it.
   */
  interface Props extends PanelProps {
    tool: ConsoleTool;
    ontool: (tool: ConsoleTool) => void;
  }

  let { run, send, selection, tool, ontool }: Props = $props();
  const uid = $props.id();
  let op = $state<'reveal' | 'hide'>('reveal');
  let shape = $state<'brush' | 'rect'>('brush');
  let radius = $state(2);
  const active = $derived(tool.kind === 'fog');
  const object = $derived(
    selection?.kind === 'object' ? run.scene?.doc.object(selection.uid) : undefined,
  );
  const token = $derived(
    selection?.kind === 'token' ? run.scene?.doc.token(selection.uid) : undefined,
  );

  function activate(): void {
    ontool({ kind: 'fog', op, shape, radius });
  }
  function change(): void {
    if (active) activate();
  }
</script>

<section class="panel" aria-labelledby={`${uid}-title`} data-testid="reveal-panel">
  <h2 id={`${uid}-title`}>{t('sessions.reveal.title')}</h2>
  <fieldset>
    <legend>{t('sessions.reveal.action')}</legend>
    <label
      ><input type="radio" bind:group={op} value="reveal" onchange={change} />
      {t('sessions.reveal.reveal')}</label
    >
    <label
      ><input type="radio" bind:group={op} value="hide" onchange={change} />
      {t('sessions.reveal.hide')}</label
    >
  </fieldset>
  <fieldset>
    <legend>{t('sessions.reveal.shape')}</legend>
    <label
      ><input type="radio" bind:group={shape} value="brush" onchange={change} />
      {t('sessions.reveal.brush')}</label
    >
    <label
      ><input type="radio" bind:group={shape} value="rect" onchange={change} />
      {t('sessions.reveal.rect')}</label
    >
  </fieldset>
  {#if shape === 'brush'}
    <label class="field">
      <span>{t('sessions.reveal.radius', { value: radius })}</span>
      <input
        type="range"
        min={FOG_BRUSH_MIN}
        max={FOG_BRUSH_MAX}
        step="0.5"
        bind:value={radius}
        onchange={change}
      />
    </label>
  {/if}
  <div class="row">
    {#if active}
      <button type="button" class="button" onclick={() => ontool({ kind: 'select' })}
        >{t('sessions.reveal.stop')}</button
      >
    {:else}
      <button type="button" class="button button-primary" data-testid="fog-tool" onclick={activate}
        >{t('sessions.reveal.start')}</button
      >
    {/if}
  </div>
  <p class="small muted">{t('sessions.reveal.hint')}</p>

  {#if selection !== null && (object !== undefined || token !== undefined)}
    <h3>{t('sessions.reveal.selected')}</h3>
    <button
      type="button"
      class="button"
      onclick={() => send([{ type: 'reveal', kind: selection.kind, uid: selection.uid }])}
      >{selection.kind === 'object'
        ? t('sessions.reveal.reveal_object')
        : t('sessions.reveal.reveal_token')}</button
    >
  {/if}
</section>

<style>
  .panel {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--font-size-sm);
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  h2,
  h3 {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    margin-bottom: var(--space-1);
    color: var(--color-text-muted);
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .row {
    display: flex;
    gap: var(--space-2);
  }
</style>
