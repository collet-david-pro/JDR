<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../../components/Button.svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import { formatCheckValue } from '../../lib/diagnostic-format';
  import { describeError, type ErrorSummary } from '../../lib/errors';
  import { t, tryT } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import { runSseProbe, type SseProbeResult } from '../../lib/sse-probe';
  import type { DiagnosticCheck } from '../../lib/types';

  const { api } = services();
  let checks = $state.raw<readonly DiagnosticCheck[] | null>(null);
  let failure = $state.raw<ErrorSummary | null>(null);
  let loading = $state(false);
  let probing = $state(false);
  let probe = $state.raw<SseProbeResult | null>(null);

  const badge = { ok: 'badge-ok', warn: 'badge-warn', error: 'badge-error' } as const;

  async function load(): Promise<void> {
    loading = true;
    failure = null;
    try {
      checks = (await api.get<{ checks: DiagnosticCheck[] }>('/admin/diagnostic')).data.checks;
    } catch (error) {
      failure = describeError(error, t);
    } finally {
      loading = false;
    }
  }

  async function testStream(): Promise<void> {
    probing = true;
    probe = null;
    probe = await runSseProbe(api.url('/admin/diagnostic/sse'));
    probing = false;
  }

  const label = (check: DiagnosticCheck): string =>
    tryT(`diagnostic.checks.${check.id}`) ?? check.id;
  const hint = (check: DiagnosticCheck): string | null =>
    check.hint_key ? (tryT(check.hint_key) ?? check.hint_key) : null;
  const value = (check: DiagnosticCheck): string => formatCheckValue(check.value, t);

  onMount(() => {
    void load();
  });
</script>

<div class="stack">
  <section class="card stack" aria-labelledby="diag-title" aria-busy={loading}>
    <div class="row head">
      <h2 id="diag-title">{t('admin.tabs.diagnostic')}</h2>
      <Button size="small" {loading} onclick={load}>{t('admin.diagnostic.rerun')}</Button>
    </div>
    <ErrorAlert {failure} />
    {#if checks !== null}
      <ul class="checks">
        {#each checks as check (check.id)}
          <li>
            <span class={['badge', badge[check.status]]}
              >{t(`admin.diagnostic.status.${check.status}`)}</span
            >
            <div>
              <strong>{label(check)}</strong>
              {#if value(check) !== ''}<span class="muted"> — {value(check)}</span>{/if}
              {#if hint(check)}<p class="small muted">{hint(check)}</p>{/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card stack" aria-labelledby="sse-title">
    <h2 id="sse-title">{t('admin.diagnostic.sse_title')}</h2>
    <p class="muted small">{t('admin.diagnostic.sse_hint')}</p>
    <div>
      <Button loading={probing} onclick={testStream}>{t('admin.diagnostic.sse_run')}</Button>
    </div>
    <div aria-live="polite">
      {#if probe}
        <p
          class={[
            'alert',
            probe.ok ? 'alert-success' : probe.buffered ? 'alert-warning' : 'alert-error',
          ]}
        >
          {#if probe.ok}{t('admin.diagnostic.sse_ok')}
          {:else if probe.buffered}{t('admin.diagnostic.sse_buffered')}
          {:else}{t('admin.diagnostic.sse_failed', { count: probe.received })}{/if}
        </p>
        {#if probe.arrivals.length > 0}
          <p class="small muted">
            {t('admin.diagnostic.sse_times', { times: probe.arrivals.join(' ms, ') + ' ms' })}
          </p>
        {/if}
      {/if}
    </div>
  </section>
</div>

<style>
  h2 {
    margin: 0;
  }
  .head {
    justify-content: space-between;
  }
  .checks {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: 5rem 1fr;
    gap: var(--space-3);
    align-items: start;
    padding: var(--space-2) 0;
    border-bottom: var(--border-width) solid var(--color-border);
  }
  li .badge {
    text-align: center;
  }
  li p {
    margin: var(--space-1) 0 0;
  }
</style>
