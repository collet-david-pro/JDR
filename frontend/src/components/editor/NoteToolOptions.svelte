<script lang="ts">
  import {
    PIN_ICONS,
    REVEAL_EFFECTS,
    SECRET_KIND_LIST,
    pinIconLabel,
    revealEffectLabel,
    secretKindLabel,
  } from '../../editor/ui/note-labels';
  import SnapStepSelect from './SnapStepSelect.svelte';
  import { NotesView } from '../../editor/ui/notes-view.svelte';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';
  import { onDestroy, untrack } from 'svelte';

  /** Options of the pin, zone, trap and secret tools (P9b2a). */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  const view = new NotesView(untrack(() => session.doc.notes));
  onDestroy(() => view.dispose());
</script>

{#snippet noteSelect(current: string | null, set: (v: string | null) => void, testid: string)}
  <label class="field">
    <span>{t('editor.notes.linked_note')}</span>
    <select
      class="select"
      value={current ?? ''}
      data-testid={testid}
      onchange={(e) => set(e.currentTarget.value === '' ? null : e.currentTarget.value)}
    >
      <option value="">{t('editor.notes.no_note')}</option>
      {#each view.list as n (n.uid)}<option value={n.uid}>{n.title}</option>{/each}
    </select>
  </label>
{/snippet}

{#if ui.tool === 'pin'}
  <label class="field">
    <span>{t('editor.notes.pin_icon')}</span>
    <select class="select" bind:value={ui.pinIcon} data-testid="pin-icon">
      {#each PIN_ICONS as icon (icon)}<option value={icon}>{pinIconLabel(icon)}</option>{/each}
    </select>
  </label>
  <label class="field">
    <span>{t('editor.notes.pin_color')}</span>
    <input type="color" bind:value={ui.pinColor} data-testid="pin-color" />
  </label>
  {@render noteSelect(ui.pinNote, (v) => (ui.pinNote = v), 'pin-note')}
  <p class="small muted">{t('editor.notes.pin_hint')}</p>
{:else if ui.tool === 'zone'}
  {@render noteSelect(ui.zoneNote, (v) => (ui.zoneNote = v), 'zone-note')}
  <label class="choice">
    <input type="checkbox" bind:checked={ui.zoneShowOnEnter} data-testid="zone-enter" />
    {t('editor.notes.show_on_enter')}
  </label>
  <p class="small muted">{t('editor.notes.polygon_hint')}</p>
{:else if ui.tool === 'trap'}
  <fieldset>
    <legend>{t('editor.notes.trap_shape')}</legend>
    <label class="choice">
      <input
        type="radio"
        name={`${uid}-shape`}
        value="point"
        bind:group={ui.trapShape}
        data-testid="trap-point"
      />
      {t('editor.notes.trap_point')}
    </label>
    <label class="choice">
      <input
        type="radio"
        name={`${uid}-shape`}
        value="polygon"
        bind:group={ui.trapShape}
        data-testid="trap-polygon"
      />
      {t('editor.notes.trap_polygon')}
    </label>
  </fieldset>
  <label class="field">
    <span>{t('editor.notes.reveal.label')}</span>
    <select class="select" bind:value={ui.trapReveal} data-testid="trap-reveal">
      {#each REVEAL_EFFECTS as r (r)}<option value={r}>{revealEffectLabel(r)}</option>{/each}
    </select>
  </label>
  {@render noteSelect(ui.trapNote, (v) => (ui.trapNote = v), 'trap-note')}
  <p class="small muted">
    {ui.trapShape === 'polygon' ? t('editor.notes.polygon_hint') : t('editor.notes.trap_hint')}
  </p>
{:else if ui.tool === 'secret'}
  <fieldset>
    <legend>{t('editor.notes.secret_kind')}</legend>
    {#each SECRET_KIND_LIST as kind (kind)}
      <label class="choice">
        <input
          type="radio"
          name={`${uid}-kind`}
          value={kind}
          bind:group={ui.secretKind}
          data-testid={`secret-${kind}`}
        />
        {secretKindLabel(kind)}
      </label>
    {/each}
  </fieldset>
  {@render noteSelect(ui.secretNote, (v) => (ui.secretNote = v), 'secret-note')}
  <p class="small muted">
    {ui.secretKind === 'passage' ? t('editor.notes.passage_hint') : t('editor.notes.polygon_hint')}
  </p>
  <SnapStepSelect {session} testid="snap-step-secret" />
  {#if ui.secretKind === 'passage'}
    <p class="small muted" data-testid="passage-opening-hint">
      {t('editor.notes.passage_opening')}
    </p>
  {/if}
{/if}

<style>
  .field {
    display: grid;
    gap: var(--space-1);
  }
  fieldset {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    margin-bottom: 2px;
  }
  .choice {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  p {
    margin: 0;
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
