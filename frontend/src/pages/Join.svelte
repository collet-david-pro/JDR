<script lang="ts">
  import HelpLink from '../components/HelpLink.svelte';
  import PlayerTokenPicker from '../components/player-tokens/PlayerTokenPicker.svelte';
  import { onMount } from 'svelte';
  import { errorMessage } from '../lib/errors';
  import { t } from '../lib/i18n';
  import type { PageProps } from '../lib/page';
  import { services, sessionsClient } from '../lib/services';
  import { formatSessionCode, isValidSessionCode } from '../lib/sessions';

  /** Join a session with its code (/join/:code?): the code of a link is only prefilled. */
  let { params }: PageProps = $props();
  const { router } = services();

  // svelte-ignore state_referenced_locally
  let code = $state(formatSessionCode(params['code'] ?? ''));
  let busy = $state(false);
  let tokenId = $state<string | null>(null);
  let message = $state<string | null>(null);
  let input: HTMLInputElement | undefined = $state();
  const valid = $derived(isValidSessionCode(code));

  onMount(() => input?.focus());

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!valid || busy) return;
    busy = true;
    message = null;
    try {
      const joined = await sessionsClient().join(code, {}, tokenId);
      router.navigate(`/sessions/${encodeURIComponent(joined.session_id)}`);
    } catch (error) {
      message = errorMessage(error, t);
    } finally {
      busy = false;
    }
  }
</script>

<section class="card join" aria-labelledby="join-title">
  <div class="title-row">
    <h1 id="join-title">{t('sessions.join.title')}</h1>
    <HelpLink anchor="joueur-rejoindre-une-seance" />
  </div>
  <form class="stack" novalidate onsubmit={submit}>
    <label class="field">
      <span>{t('dashboard.join.label')}</span>
      <input
        bind:this={input}
        name="code"
        value={code}
        oninput={(e) => (code = formatSessionCode(e.currentTarget.value))}
        placeholder="XXXX-XXXX"
        maxlength="9"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        aria-describedby={message === null ? undefined : 'join-error'}
        data-testid="join-code"
      />
    </label>
    <fieldset class="token-choice">
      <legend>{t('player_tokens.join.legend')}</legend>
      <p class="muted small">{t('player_tokens.join.hint')}</p>
      <PlayerTokenPicker bind:value={tokenId} disabled={busy} />
    </fieldset>
    {#if message !== null}
      <p id="join-error" class="alert alert-error" role="alert" data-testid="join-error">
        {message}
      </p>
    {/if}
    <button
      type="submit"
      class="button button-primary"
      disabled={!valid || busy}
      data-testid="join-submit">{t('dashboard.join.submit')}</button
    >
  </form>
</section>

<style>
  .join {
    display: grid;
    gap: var(--space-3);
    max-width: 28rem;
    margin: var(--space-5) auto;
  }
  h1 {
    margin: 0;
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .token-choice {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: 0;
  }
  .token-choice legend {
    padding: 0;
    font-weight: 600;
  }
  .token-choice p {
    margin: 0;
  }
  input {
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-sunken);
    font-family: var(--font-mono);
    font-size: var(--font-size-lg);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
</style>
