<script lang="ts">
  import { onMount } from 'svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import { describeError, type ErrorSummary } from '../../lib/errors';
  import { formatDateTime } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import type { Device } from '../../lib/types';
  import { describeUserAgent } from '../../lib/user-agent';
  import { toasts } from '../../stores/toasts.svelte';

  const { api } = services();
  let devices = $state.raw<readonly Device[] | null>(null);
  let failure = $state.raw<ErrorSummary | null>(null);
  let revoking = $state<string | null>(null);

  async function load(): Promise<void> {
    failure = null;
    try {
      devices = (await api.get<Device[]>('/me/devices')).data;
    } catch (error) {
      failure = describeError(error, t);
    }
  }

  async function revoke(device: Device): Promise<void> {
    revoking = device.id;
    try {
      await api.delete(`/me/devices/${encodeURIComponent(device.id)}`);
      devices = (devices ?? []).filter((d) => d.id !== device.id);
      toasts.success(t('profile.devices.revoked'));
    } catch (error) {
      toasts.error(error);
    } finally {
      revoking = null;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="card stack" aria-labelledby="profile-devices">
  <h2 id="profile-devices">{t('profile.devices.title')}</h2>
  <p class="muted small">{t('profile.devices.hint')}</p>
  <ErrorAlert {failure} />
  {#if devices === null && failure === null}
    <p class="muted" aria-busy="true">{t('common.loading')}</p>
  {:else if devices !== null && devices.length === 0}
    <p class="muted">{t('profile.devices.empty')}</p>
  {:else if devices !== null}
    <ul class="devices">
      {#each devices as device (device.id)}
        <li>
          <div>
            <strong>{describeUserAgent(device.user_agent)}</strong>
            {#if device.current}<span class="badge badge-ok">{t('profile.devices.current')}</span
              >{/if}
            <div class="small muted">
              {t('profile.devices.last_used', {
                date: formatDateTime(device.last_used_at ?? device.created_at),
              })}
            </div>
          </div>
          {#if !device.current}
            <button
              type="button"
              class="button button-small"
              disabled={revoking === device.id}
              aria-busy={revoking === device.id}
              onclick={() => revoke(device)}
            >
              {t('profile.devices.revoke')}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .devices {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .badge {
    margin-left: var(--space-2);
  }
</style>
