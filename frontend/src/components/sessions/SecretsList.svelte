<script lang="ts">
  import type { SecretObject, TrapObject } from '../../editor/contracts-notes';
  import { secretKindLabel } from '../../editor/ui/note-labels';
  import { t } from '../../lib/i18n';
  import type { PanelProps } from '../../lib/sessions/console/panel-props';
  import { objectsOfFloor } from '../../lib/sessions/state';

  /** Traps and secrets of the current floor, with their state and a "Reveal" button. */
  let { run, send }: Pick<PanelProps, 'run' | 'send'> = $props();

  const rows = $derived.by(() => {
    const s = run.state;
    const floor = run.scene?.floor;
    if (s === null || floor === undefined) return [];
    return objectsOfFloor(s, floor)
      .filter((o): o is TrapObject | SecretObject => o.type === 'trap' || o.type === 'secret')
      .map((o) => {
        const note = o.props.note === null ? undefined : s.notes[o.props.note];
        return {
          uid: o.uid,
          type: o.type,
          kind: o.type === 'secret' ? secretKindLabel(o.props.kind) : t('sessions.secrets.trap'),
          note: note?.title ?? null,
          revealed: s.revealed.includes(o.uid),
        };
      });
  });
</script>

<section class="secrets" aria-label={t('sessions.secrets.title')} data-testid="secrets-list">
  <h3>{t('sessions.secrets.title')}</h3>
  {#if rows.length === 0}
    <p class="muted small">{t('sessions.secrets.empty')}</p>
  {/if}
  <ul>
    {#each rows as row (row.uid)}
      <li data-testid="secret-row" data-uid={row.uid} data-revealed={row.revealed}>
        <span class="what">{row.kind}{row.note === null ? '' : ` — ${row.note}`}</span>
        {#if row.revealed}
          <span class="badge">{t('sessions.secrets.revealed')}</span>
        {:else}
          <button
            type="button"
            class="button button-small"
            data-testid="secret-reveal"
            onclick={() =>
              send([
                row.type === 'trap'
                  ? { type: 'trap.reveal', uid: row.uid }
                  : { type: 'secret.reveal', uid: row.uid },
              ])}>{t('sessions.secrets.reveal')}</button
          >
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .secrets {
    display: grid;
    gap: var(--space-2);
  }
  h3,
  p {
    margin: 0;
  }
  h3 {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .badge {
    color: var(--color-text-muted);
  }
</style>
