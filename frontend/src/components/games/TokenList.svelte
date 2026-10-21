<script lang="ts">
  import { tokenKindLabel } from '../../lib/games/labels';
  import { formatCellDistance, formatNumber } from '../../lib/games/units';
  import { t } from '../../lib/i18n';
  import type { GameSettings, Token } from '../../lib/types';

  /** Grid of token definitions; actions are shown when the callbacks are given. */
  interface Props {
    tokens: readonly Token[];
    settings: GameSettings;
    ownerNames?: ReadonlyMap<string, string>;
    onedit?: (token: Token) => void;
    ondelete?: (token: Token) => void;
  }

  let { tokens, settings, ownerNames, onedit, ondelete }: Props = $props();

  function size(token: Token): string {
    return t('games.tokens.size_value', {
      w: formatNumber(token.size_w),
      h: formatNumber(token.size_h),
    });
  }

  function vision(token: Token): string {
    if (!token.vision.enabled) return t('games.tokens.vision_off');
    return t('games.tokens.vision_value', {
      range: formatNumber(token.vision.range),
      distance: formatCellDistance(token.vision.range, settings),
    });
  }
</script>

<ul class="tokens">
  {#each tokens as token (token.id)}
    <li class="token">
      <div
        class="thumb"
        style:--ring={token.ring_color ?? 'transparent'}
        class:ring={token.ring_color !== null}
      >
        {#if token.image}
          <img src={token.image.thumb} alt="" loading="lazy" decoding="async" />
        {:else}
          <span aria-hidden="true">{[...token.name][0]?.toUpperCase() ?? '?'}</span>
        {/if}
      </div>
      <div class="info">
        <h3>{token.name}</h3>
        <p class="small"><span class="badge">{tokenKindLabel(token.kind)}</span> {size(token)}</p>
        <p class="small muted">{vision(token)}</p>
        {#if token.vision.enabled && token.vision.dark > 0}
          <p class="small muted">
            {t('games.tokens.dark_value', {
              range: formatNumber(token.vision.dark),
              distance: formatCellDistance(token.vision.dark, settings),
            })}
          </p>
        {/if}
        {#if token.light}
          <p class="small muted">
            {t('games.tokens.light_value', {
              radius: formatNumber(token.light.radius),
              dim: formatNumber(token.light.dim_radius),
            })}
          </p>
        {/if}
        {#if ownerNames && token.default_owner_user_id}
          <p class="small muted">
            {t('games.tokens.owner_value', {
              name: ownerNames.get(token.default_owner_user_id) ?? '?',
            })}
          </p>
        {/if}
        {#if onedit || ondelete}
          <div class="row actions">
            {#if onedit}
              <button
                type="button"
                class="button button-small"
                onclick={() => onedit(token)}
                aria-label={t('games.tokens.edit_named', { name: token.name })}
                >{t('common.edit')}</button
              >
            {/if}
            {#if ondelete}
              <button
                type="button"
                class="button button-small button-ghost"
                onclick={() => ondelete(token)}
                aria-label={t('games.tokens.delete_named', { name: token.name })}
                >{t('common.delete')}</button
              >
            {/if}
          </div>
        {/if}
      </div>
    </li>
  {/each}
</ul>

<style>
  .tokens {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .token {
    display: grid;
    grid-template-columns: 3.5rem 1fr;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
  }
  .thumb {
    width: 3.5rem;
    height: 3.5rem;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: var(--radius-pill);
    background: var(--color-surface-sunken);
    color: var(--color-text-muted);
    font-size: var(--font-size-lg);
  }
  .thumb.ring {
    box-shadow: 0 0 0 3px var(--ring);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .info {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
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
    gap: var(--space-2);
  }
</style>
