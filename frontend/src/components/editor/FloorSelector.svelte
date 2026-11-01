<script lang="ts">
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import { MAX_FLOORS } from '../../editor/model/MapDocument';
  import { nextFreeLevel } from '../../editor/model/floor-commands';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /**
   * Floors of the map (P9a2): list by level, add (name + level), rename, change the level and delete
   * (with a confirmation: the whole content of the floor goes). Everything is undoable.
   */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const floors = $derived(ui.floors);
  const current = $derived(floors.find((f) => f.uid === ui.currentFloor));
  const full = $derived(floors.length >= MAX_FLOORS);
  const last = $derived(floors.length <= 1);

  let open = $state(false);
  let newName = $state('');
  let newLevel = $state<number | null>(null);
  let renaming = $state<string | null>(null);
  let renameText = $state('');
  let confirmRemove = $state(false);
  let busy = $state(false);

  const suggestedLevel = $derived(nextFreeLevel(floors.map((f) => f.level)));

  function levelText(level: number): string {
    return level > 0 ? `+${level}` : String(level);
  }

  async function add(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const uid = await session.floors.add(
      newName,
      newLevel === null ? (suggestedLevel ?? undefined) : newLevel,
    );
    if (uid !== null) {
      newName = '';
      newLevel = null;
    }
  }

  function startRename(uid: string, name: string): void {
    renaming = uid;
    renameText = name;
  }

  function commitRename(uid: string): void {
    if (renaming !== uid) return;
    renaming = null;
    const floor = floors.find((f) => f.uid === uid);
    if (floor !== undefined && renameText.trim() !== floor.name) {
      session.floors.rename(uid, renameText);
    }
  }

  async function remove(): Promise<void> {
    if (current === undefined) return;
    busy = true;
    try {
      await session.floors.remove(current.uid);
    } finally {
      busy = false;
      confirmRemove = false;
    }
  }
</script>

<div class="floors" data-testid="floor-selector">
  <label class="inline">
    <span class="visually-hidden">{t('editor.floors.label')}</span>
    <select
      class="select"
      value={ui.currentFloor}
      title={t('editor.floors.label')}
      data-testid="floor-select"
      disabled={ui.floorBusy}
      onchange={(e) => void session.floors.select(e.currentTarget.value)}
    >
      {#each floors as floor (floor.uid)}
        <option value={floor.uid}>{levelText(floor.level)} · {floor.name}</option>
      {/each}
    </select>
  </label>
  <button
    type="button"
    class="button button-small"
    aria-expanded={open}
    aria-controls="floor-manager"
    data-testid="floor-manage"
    onclick={() => (open = !open)}>{t('editor.floors.manage')}</button
  >
  {#if open}
    <div id="floor-manager" class="manager" role="group" aria-label={t('editor.floors.manage')}>
      <ul class="list">
        {#each floors as floor (floor.uid)}
          <li class:current={floor.uid === ui.currentFloor}>
            <span class="level">{levelText(floor.level)}</span>
            {#if renaming === floor.uid}
              <input
                class="input"
                type="text"
                maxlength="60"
                bind:value={renameText}
                aria-label={t('editor.floors.rename')}
                data-testid="floor-rename-input"
                onblur={() => commitRename(floor.uid)}
                onkeydown={(e) => {
                  if (e.key === 'Enter') commitRename(floor.uid);
                  else if (e.key === 'Escape') renaming = null;
                }}
              />
            {:else}
              <button
                type="button"
                class="link"
                data-testid="floor-item"
                onclick={() => void session.floors.select(floor.uid)}>{floor.name}</button
              >
              <button
                type="button"
                class="button button-small"
                data-testid="floor-rename"
                onclick={() => startRename(floor.uid, floor.name)}
                >{t('editor.floors.rename')}</button
              >
              <label class="inline">
                <span class="visually-hidden">{t('editor.floors.level')}</span>
                <input
                  class="input narrow"
                  type="number"
                  min="-9"
                  max="9"
                  step="1"
                  value={floor.level}
                  title={t('editor.floors.level')}
                  data-testid="floor-level"
                  onchange={(e) => {
                    const value = Number(e.currentTarget.value);
                    if (!session.floors.setLevel(floor.uid, value)) {
                      e.currentTarget.value = String(floor.level);
                    }
                  }}
                />
              </label>
            {/if}
          </li>
        {/each}
      </ul>
      <form class="add" onsubmit={(e) => void add(e)}>
        <input
          class="input"
          type="text"
          maxlength="60"
          placeholder={t('editor.floors.name_placeholder')}
          aria-label={t('editor.floors.name')}
          bind:value={newName}
          disabled={full}
          data-testid="floor-new-name"
        />
        <input
          class="input narrow"
          type="number"
          min="-9"
          max="9"
          step="1"
          aria-label={t('editor.floors.level')}
          title={t('editor.floors.level')}
          value={newLevel ?? suggestedLevel ?? 0}
          disabled={full}
          data-testid="floor-new-level"
          oninput={(e) => (newLevel = Number(e.currentTarget.value))}
        />
        <button
          type="submit"
          class="button button-small"
          disabled={full || newName.trim() === ''}
          data-testid="floor-add">{t('editor.floors.add')}</button
        >
      </form>
      {#if full}
        <p class="hint" role="status">{t('editor.floors.limit', { max: MAX_FLOORS })}</p>
      {/if}
      <button
        type="button"
        class="button button-small danger"
        disabled={last || current === undefined}
        title={last ? t('editor.floors.last') : null}
        data-testid="floor-remove"
        onclick={() => (confirmRemove = true)}>{t('editor.floors.remove')}</button
      >
    </div>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmRemove}
  title={t('editor.floors.remove_title')}
  message={t('editor.floors.remove_message', { name: current?.name ?? '' })}
  confirmLabel={t('editor.floors.remove_confirm')}
  confirmTestId="floor-remove-confirm"
  danger
  {busy}
  onconfirm={() => void remove()}
/>

<style>
  .floors {
    position: relative;
    display: flex;
    gap: var(--space-1);
    align-items: center;
  }
  .inline {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
    font-size: var(--font-size-sm);
  }
  .select,
  .input {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-sm);
  }
  .narrow {
    width: 4.5rem;
  }
  .manager {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 22rem;
    margin-top: var(--space-1);
    padding: var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    box-shadow: var(--shadow-md, 0 4px 16px rgb(0 0 0 / 0.2));
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list li {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .list li.current .link {
    font-weight: 700;
  }
  .level {
    min-width: 2rem;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-muted);
  }
  .link {
    flex: 1;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .add {
    display: flex;
    gap: var(--space-1);
  }
  .hint {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }
</style>
