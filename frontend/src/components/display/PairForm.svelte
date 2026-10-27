<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { ApiError } from '../../lib/api';
  import { isCodeComplete, normalizeCode, pairErrorKey } from '../../lib/displays/ui-logic';

  /** Pairing screen of a projection screen: code typed in the GM's console (panel Screens). */
  interface Props {
    busy: boolean;
    error: ApiError | null;
    fullscreen: boolean;
    onsubmit: (code: string) => void;
    onfullscreen: () => void;
  }
  let { busy, error, fullscreen, onsubmit, onfullscreen }: Props = $props();

  let raw = $state('');
  const code = $derived(normalizeCode(raw));

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (isCodeComplete(code) && !busy) onsubmit(code);
  }
</script>

<main class="pair">
  <h1>{t('display.pair.title')}</h1>
  <form onsubmit={submit} data-testid="display-pair-form">
    <label for="display-code">{t('display.pair.label')}</label>
    <input
      id="display-code"
      data-testid="display-code"
      type="text"
      inputmode="numeric"
      autocomplete="one-time-code"
      maxlength="14"
      placeholder="123 456"
      value={raw}
      oninput={(e) => (raw = normalizeCode(e.currentTarget.value))}
    />
    <button type="submit" disabled={busy || !isCodeComplete(code)} data-testid="display-pair">
      {t('display.pair.submit')}
    </button>
    {#if error !== null}
      <p class="error" role="alert" data-testid="display-pair-error">{t(pairErrorKey(error))}</p>
    {/if}
  </form>
  <p class="help">{t('display.pair.help')}</p>
  {#if !fullscreen}
    <button type="button" class="ghost" onclick={onfullscreen} data-testid="display-fullscreen">
      {t('display.fullscreen')}
    </button>
  {/if}
</main>

<style>
  .pair {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.25rem;
    padding: 1.5rem;
    text-align: center;
  }
  h1 {
    margin: 0;
    font-size: 2rem;
  }
  form {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    justify-content: center;
    align-items: center;
  }
  label {
    flex-basis: 100%;
  }
  input {
    font-size: 2rem;
    letter-spacing: 0.3em;
    width: 11ch;
    text-align: center;
    padding: 0.5rem;
    border-radius: 0.5rem;
    border: 2px solid #667;
    background: #111;
    color: #fff;
  }
  button {
    font-size: 1.25rem;
    min-height: 3rem;
    padding: 0 1.5rem;
    border-radius: 0.5rem;
    border: 0;
    background: #3b82f6;
    color: #fff;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button.ghost {
    background: transparent;
    border: 1px solid #667;
  }
  .error {
    flex-basis: 100%;
    margin: 0;
    color: #ff8a80;
  }
  .help {
    margin: 0;
    max-width: 32rem;
    color: #aab;
  }
</style>
