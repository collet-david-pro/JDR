<script lang="ts">
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import EncountersSection from './EncountersSection.svelte';
  import TokenDialog from './TokenDialog.svelte';
  import TokenList from './TokenList.svelte';
  import { DEFAULT_SETTINGS } from '../../lib/games/game-form';
  import type { GamePageModel } from '../../lib/games/game-page.svelte';
  import { tokenOwners } from '../../lib/games/roles';
  import { t } from '../../lib/i18n';
  import type { Token, TokenInput } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';

  /** Token definitions and prepared encounters (GM / co-GM). */
  interface Props {
    model: GamePageModel;
  }

  let { model }: Props = $props();

  const settings = $derived({ ...DEFAULT_SETTINGS, ...model.game?.settings });
  const owners = $derived(tokenOwners(model.members));
  const ownerNames = $derived(new Map(model.members.map((m) => [m.user.id, m.user.username])));

  let editing = $state.raw<Token | null>(null);
  let dialogOpen = $state(false);
  let deleting = $state.raw<Token | null>(null);
  let confirmOpen = $state(false);
  let busy = $state(false);

  function create(): void {
    editing = null;
    dialogOpen = true;
  }

  function edit(token: Token): void {
    editing = token;
    dialogOpen = true;
  }

  async function save(input: TokenInput): Promise<Token> {
    const token =
      editing === null
        ? await model.createToken(input)
        : await model.updateToken(editing.id, input);
    toasts.success(t('games.tokens.saved', { name: token.name }));
    return token;
  }

  function askDelete(token: Token): void {
    deleting = token;
    confirmOpen = true;
  }

  async function remove(): Promise<void> {
    const token = deleting;
    if (token === null) return;
    busy = true;
    try {
      await model.deleteToken(token.id);
      confirmOpen = false;
      toasts.success(t('games.tokens.deleted', { name: token.name }));
    } catch (error) {
      toasts.error(error);
    } finally {
      busy = false;
    }
  }
</script>

<div class="stack">
  <section class="stack" aria-labelledby="tokens-title">
    <div class="section-head">
      <h2 id="tokens-title">{t('games.tokens.title')}</h2>
      <button type="button" class="button button-primary" onclick={create}>
        {t('games.tokens.create')}
      </button>
    </div>
    <p class="small muted">{t('games.tokens.intro')}</p>
    {#if !model.listsLoaded}
      <p class="muted" aria-busy="true">{t('common.loading')}</p>
    {:else if model.tokens.length === 0}
      <p class="muted">{t('games.tokens.empty')}</p>
    {:else}
      <TokenList tokens={model.tokens} {settings} {ownerNames} onedit={edit} ondelete={askDelete} />
    {/if}
  </section>

  <EncountersSection {model} />
</div>

<TokenDialog bind:open={dialogOpen} token={editing} {settings} {owners} onsave={save} />

<ConfirmDialog
  bind:open={confirmOpen}
  title={t('games.tokens.delete_title')}
  message={t('games.tokens.delete_text', { name: deleting?.name ?? '' })}
  confirmLabel={t('common.delete')}
  danger
  {busy}
  onconfirm={remove}
/>

<style>
  .section-head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-lg);
  }
  p {
    margin: 0;
  }
</style>
