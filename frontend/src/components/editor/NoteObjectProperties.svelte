<script lang="ts">
  import type { MapObject } from '../../editor/contracts';
  import type {
    NoteObject,
    PinIcon,
    PinObject,
    TrapObject,
    ZoneObject,
  } from '../../editor/contracts-notes';
  import { common } from '../../editor/ui/properties';
  import {
    PIN_ICONS,
    REVEAL_EFFECTS,
    isNoteFamily,
    pinIconLabel,
    revealEffectLabel,
    secretKindLabel,
  } from '../../editor/ui/note-labels';
  import { NotesView } from '../../editor/ui/notes-view.svelte';
  import { objectTypeLabel } from '../../editor/ui/scene-labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';
  import { onDestroy, untrack } from 'svelte';

  /**
   * Properties of pins, zones, traps and secrets (P9b2a): icon, colour, linked note, effect. Every
   * update keeps all the props (the server replaces them as a whole). From a pin or a zone one can
   * create a note and link it, or open the linked note.
   */
  interface Props {
    session: EditorSession;
    objects: readonly MapObject[];
  }

  let { session, objects }: Props = $props();
  const uid = $props.id();
  const view = new NotesView(untrack(() => session.doc.notes));
  onDestroy(() => view.dispose());

  const family = $derived(objects.filter((o): o is NoteObject => isNoteFamily(o.type)));
  const pins = $derived(family.filter((o): o is PinObject => o.type === 'pin'));
  const zones = $derived(family.filter((o): o is ZoneObject => o.type === 'zone'));
  const traps = $derived(family.filter((o): o is TrapObject => o.type === 'trap'));
  const single = $derived(family.length === 1 ? family[0] : undefined);
  const linked = $derived(view.get(single?.props.note ?? null));

  function patch(uids: readonly string[], change: Record<string, unknown>): void {
    session.scene.patchObjects(uids, (o) =>
      isNoteFamily(o.type) ? { props: { ...o.props, ...change } as MapObject['props'] } : null,
    );
  }

  const value = (e: Event): string =>
    (e.currentTarget as HTMLSelectElement | HTMLInputElement).value;
  const checked = (e: Event): boolean => (e.currentTarget as HTMLInputElement).checked;

  function openDialog(noteUid: string | null, linkObject: string | null): void {
    session.ui.noteDialog = { uid: noteUid, linkObject };
  }
</script>

{#if family.length > 0}
  <fieldset class="grid" data-testid="properties-notes">
    <legend>{objectTypeLabel(family[0]!.type)}</legend>

    {#if pins.length > 0}
      <label>
        <span>{t('editor.notes.pin_icon')}</span>
        <select
          value={common(pins, (o) => o.props.icon) ?? ''}
          onchange={(e) =>
            patch(
              pins.map((o) => o.uid),
              { icon: value(e) as PinIcon },
            )}
        >
          <option value="" disabled>{t('editor.properties.mixed')}</option>
          {#each PIN_ICONS as icon (icon)}<option value={icon}>{pinIconLabel(icon)}</option>{/each}
        </select>
      </label>
      <label>
        <span>{t('editor.notes.pin_color')}</span>
        <input
          type="color"
          value={common(pins, (o) => o.props.color) ?? '#d9534f'}
          onchange={(e) =>
            patch(
              pins.map((o) => o.uid),
              { color: value(e) },
            )}
        />
      </label>
    {/if}

    {#if zones.length > 0}
      <label class="check">
        <input
          type="checkbox"
          checked={common(zones, (o) => o.props.show_on_enter) === true}
          data-testid="zone-show-on-enter"
          onchange={(e) =>
            patch(
              zones.map((o) => o.uid),
              { show_on_enter: checked(e) },
            )}
        />
        {t('editor.notes.show_on_enter')}
      </label>
    {/if}

    {#if traps.length > 0}
      <label>
        <span>{t('editor.notes.reveal.label')}</span>
        <select
          value={common(traps, (o) => o.props.reveal_effect) ?? ''}
          onchange={(e) =>
            patch(
              traps.map((o) => o.uid),
              { reveal_effect: value(e) as 'pulse' | 'none' },
            )}
        >
          <option value="" disabled>{t('editor.properties.mixed')}</option>
          {#each REVEAL_EFFECTS as r (r)}<option value={r}>{revealEffectLabel(r)}</option>{/each}
        </select>
      </label>
    {/if}

    {#if single?.type === 'secret'}
      <p class="small">{secretKindLabel(single.props.kind)}</p>
    {/if}

    <label>
      <span>{t('editor.notes.linked_note')}</span>
      <select
        id={`${uid}-note`}
        value={common(family, (o) => o.props.note) ?? ''}
        data-testid="linked-note"
        onchange={(e) =>
          patch(
            family.map((o) => o.uid),
            { note: value(e) === '' ? null : value(e) },
          )}
      >
        <option value="" disabled>{t('editor.properties.mixed')}</option>
        <option value="">{t('editor.notes.no_note')}</option>
        {#each view.list as n (n.uid)}<option value={n.uid}>{n.title}</option>{/each}
      </select>
    </label>

    {#if single !== undefined}
      <div class="row">
        {#if linked !== undefined}
          <button
            type="button"
            class="button button-small"
            data-testid="open-linked-note"
            onclick={() => openDialog(linked.uid, null)}>{t('editor.notes.open_linked')}</button
          >
        {:else if single.type === 'pin' || single.type === 'zone'}
          <button
            type="button"
            class="button button-small"
            data-testid="create-linked-note"
            onclick={() => openDialog(null, single.uid)}>{t('editor.notes.create_linked')}</button
          >
        {/if}
      </div>
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
    border-radius: var(--radius-md);
  }
  label {
    display: grid;
    gap: 2px;
  }
  .check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .row {
    display: flex;
    gap: var(--space-2);
  }
  p {
    margin: 0;
  }
</style>
