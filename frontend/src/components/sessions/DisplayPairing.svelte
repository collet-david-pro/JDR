<script lang="ts">
  import { onMount } from 'svelte';
  import { copyText } from '../../lib/clipboard';
  import { qrSvg } from '../../lib/displays/qr';
  import type { PairingInfo } from '../../lib/displays/types';
  import { t } from '../../lib/i18n';
  import {
    formatCountdown,
    formatPairingCode,
    remainingMs,
  } from '../../lib/sessions/console/displays-logic';
  import { toasts } from '../../stores/toasts.svelte';

  /**
   * Pairing code of a screen: big code, QR, copyable link and a countdown until it expires.
   * The code only exists in the answer of the creation / regeneration: it is never read again.
   */
  interface Props {
    id: string;
    pairing: PairingInfo | null;
    busy: boolean;
    onnew: () => void;
  }

  let { id, pairing, busy, onnew }: Props = $props();
  let now = $state(Date.now());
  const left = $derived(pairing === null ? 0 : remainingMs(pairing.expires_at, now));
  const expired = $derived(pairing === null || left <= 0);
  // The SVG holds only numbers (the URL itself never appears in it) and the URL comes from the
  // server: injecting it with {@html} is safe.
  const qr = $derived(pairing === null ? '' : qrSvg(pairing.url));

  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  async function copy(): Promise<void> {
    if (pairing === null) return;
    if (await copyText(pairing.url)) toasts.success(t('common.copied'));
    else toasts.info(t('common.copy_failed'));
  }
</script>

<div class="pairing">
  {#if pairing !== null && !expired}
    <strong class="code mono" data-testid={`display-code-${id}`}
      >{formatPairingCode(pairing.code)}</strong
    >
    <div class="qr" data-testid={`display-qr-${id}`} aria-label={t('sessions.displays.qr_label')}>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- SVG of numbers built from a server URL -->
      {@html qr}
    </div>
    <div class="link">
      <code class="small" data-testid={`display-link-${id}`}>{pairing.url}</code>
      <button type="button" class="button button-small" onclick={copy}>{t('common.copy')}</button>
    </div>
    <p class="small muted" data-testid={`display-countdown-${id}`}>
      {t('sessions.displays.expires_in', { time: formatCountdown(left) })}
    </p>
  {:else}
    <p class="small alert alert-warning" data-testid={`display-expired-${id}`}>
      {pairing === null ? t('sessions.displays.no_code') : t('sessions.displays.expired')}
    </p>
    <button
      type="button"
      class="button button-small"
      data-testid={`display-new-code-${id}`}
      disabled={busy}
      onclick={onnew}>{t('sessions.displays.new_code')}</button
    >
  {/if}
</div>

<style>
  .pairing {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
  }
  .code {
    font-size: var(--font-size-xl, 1.75rem);
    letter-spacing: 0.15em;
  }
  .qr {
    width: 9rem;
    padding: var(--space-1);
    border-radius: var(--radius-md);
    background: #fff;
    color: #000;
  }
  .qr :global(svg) {
    display: block;
    width: 100%;
    height: auto;
  }
  .link {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    max-width: 100%;
  }
  .link code {
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
  }
</style>
