<script lang="ts">
  import { formatDateTime } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import { href } from '../../lib/services';
  import type { MapSummary } from '../../lib/types';

  /** Map thumbnail with its actions (Maps tab, projet.md 18.1 p.3). */
  interface Props {
    map: MapSummary;
    trash: boolean;
    busy: boolean;
    onedit: (map: MapSummary) => void;
    onduplicate: (map: MapSummary) => void;
    ontrash: (map: MapSummary) => void;
    onrestore: (map: MapSummary) => void;
  }

  let { map, trash, busy, onedit, onduplicate, ontrash, onrestore }: Props = $props();
  const uid = $props.id();
  const editUrl = $derived(
    href(`/games/${encodeURIComponent(map.game_id)}/maps/${encodeURIComponent(map.id)}/edit`),
  );
</script>

<article
  class="map-card"
  aria-labelledby={`${uid}-name`}
  data-testid="map-card"
  data-map-id={map.id}
>
  <div class="thumb" aria-hidden="true">
    {#if map.thumb_url}
      <img src={map.thumb_url} alt="" loading="lazy" decoding="async" />
    {:else}
      <svg viewBox="0 0 48 32" class="generic">
        <rect x="1" y="1" width="46" height="30" rx="2" />
        <path d="M1 11h46M1 21h46M13 1v30M25 1v30M37 1v30" />
      </svg>
    {/if}
  </div>
  <div class="body">
    <h3 id={`${uid}-name`}>
      {#if trash}
        {map.name}
      {:else}
        <a href={editUrl} data-testid="map-open">{map.name}</a>
      {/if}
    </h3>
    <p class="small muted">
      {t('games.maps.card.size', { width: map.grid.width, height: map.grid.height })}
      · {map.kind === 'world' ? t('games.maps.kinds.world') : t('games.maps.kinds.battle')}
    </p>
    <p class="small muted">
      {trash && map.deleted_at
        ? t('games.maps.card.deleted', { date: formatDateTime(map.deleted_at) })
        : t('games.maps.card.updated', { date: formatDateTime(map.updated_at) })}
    </p>
    <div class="actions">
      {#if trash}
        <button
          type="button"
          class="button button-small"
          disabled={busy}
          data-testid="map-restore"
          onclick={() => onrestore(map)}>{t('games.maps.restore')}</button
        >
      {:else}
        <button
          type="button"
          class="button button-small"
          disabled={busy}
          aria-label={t('games.maps.edit_label', { name: map.name })}
          data-testid="map-edit"
          onclick={() => onedit(map)}>{t('games.maps.edit')}</button
        >
        <button
          type="button"
          class="button button-small"
          disabled={busy}
          aria-label={t('games.maps.duplicate_label', { name: map.name })}
          data-testid="map-duplicate"
          onclick={() => onduplicate(map)}>{t('games.maps.duplicate')}</button
        >
        <button
          type="button"
          class="button button-small button-ghost"
          disabled={busy}
          aria-label={t('games.maps.trash_label', { name: map.name })}
          data-testid="map-trash"
          onclick={() => ontrash(map)}>{t('games.maps.trash')}</button
        >
      {/if}
    </div>
  </div>
</article>

<style>
  .map-card {
    display: grid;
    grid-template-rows: auto 1fr;
    overflow: hidden;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
  }
  .thumb {
    aspect-ratio: 3 / 2;
    display: grid;
    place-items: center;
    background: var(--color-surface-sunken);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .generic {
    width: 45%;
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1;
  }
  .body {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3);
  }
  h3 {
    margin: 0;
    font-size: var(--font-size-md);
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-2);
  }
</style>
