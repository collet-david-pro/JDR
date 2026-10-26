<script lang="ts">
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /** Token definitions of the game: choosing one arms the token tool (K, projet.md 15.2). */
  interface Props {
    session: EditorSession;
    /** Definitions are loading / failed to load. */
    state?: 'loading' | 'ready' | 'error';
  }

  let { session, state = 'ready' }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();

  function choose(id: string): void {
    ui.tokenId = id;
    session.setTool('token');
  }
</script>

<section class="panel" aria-labelledby={`${uid}-title`} data-testid="tokens-panel">
  <h2 id={`${uid}-title`}>{t('editor.tokens.title')}</h2>
  {#if state === 'loading'}
    <p class="small muted" aria-busy="true">{t('common.loading')}</p>
  {:else if state === 'error'}
    <p class="small" role="alert">{t('editor.tokens.load_error')}</p>
  {:else if ui.tokenDefs.length === 0}
    <p class="small muted">{t('editor.tokens.empty')}</p>
  {:else}
    <ul>
      {#each ui.tokenDefs as def (def.id)}
        <li>
          <button
            type="button"
            aria-pressed={ui.tokenId === def.id}
            title={t('editor.tokens.use', { name: def.name })}
            data-testid={`token-def-${def.id}`}
            onclick={() => choose(def.id)}
          >
            {#if def.imageUrl !== null}
              <img src={def.imageUrl} alt="" width="24" height="24" loading="lazy" />
            {:else}
              <span class="disc" aria-hidden="true">{def.name.slice(0, 1).toUpperCase()}</span>
            {/if}
            <span class="name">{def.name}</span>
            <span class="size muted">{def.sizeW}×{def.sizeH}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .panel {
    padding: var(--space-3);
    border-bottom: var(--border-width) solid var(--color-border);
    font-size: var(--font-size-sm);
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  p {
    margin: 0;
  }
  ul {
    display: grid;
    gap: 2px;
    max-height: 12rem;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  button {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    width: 100%;
    padding: 2px var(--space-1);
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button:hover {
    background: var(--color-surface-sunken);
  }
  button[aria-pressed='true'] {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
  }
  img,
  .disc {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
  }
  .disc {
    display: grid;
    place-items: center;
    background: var(--color-surface-sunken);
    font-weight: var(--font-weight-medium);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
