<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../lib/i18n';
  import type { SyncStatus } from '../../lib/realtime/types';
  import { syncClient } from '../../lib/services';

  /** Network indicator of the player view: connected, reconnecting or offline; the transport in the tooltip. */
  let status = $state.raw<SyncStatus>(syncClient().status);

  onMount(() => {
    status = syncClient().status;
    return syncClient().onStatus((next) => (status = { ...next }));
  });

  const kind = $derived(
    status.state === 'online' ? 'online' : status.state === 'offline' ? 'offline' : 'reconnecting',
  );
  const label = $derived(t(`play.network.${kind}`));
  const mode = $derived(t(`play.network.mode_${status.mode}`));
</script>

<span
  class="net"
  data-testid="network-indicator"
  data-state={kind}
  title={t('play.network.mode', { mode })}
  role="status"
>
  <span class="dot" aria-hidden="true"></span>
  <span class="text">{label}</span>
</span>

<style>
  .net {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--color-success, #2e8b57);
  }
  [data-state='reconnecting'] .dot {
    background: var(--color-warning, #d4a017);
  }
  [data-state='offline'] .dot {
    background: var(--color-danger, #c0392b);
  }
  @media (max-width: 30rem) {
    .text {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  }
</style>
