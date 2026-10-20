<script lang="ts">
  import { formatBytes, usageRatio } from '../lib/format';
  import { t } from '../lib/i18n';

  interface Props {
    label: string;
    used: number;
    /** null = unlimited. */
    quota: number | null;
  }

  let { label, used, quota }: Props = $props();

  const ratio = $derived(usageRatio(used, quota));
  const percent = $derived(ratio === null ? 0 : Math.round(ratio * 100));
  const text = $derived(
    quota === null
      ? t('storage.used_unlimited', { used: formatBytes(used) })
      : t('storage.used_of', { used: formatBytes(used), quota: formatBytes(quota), percent }),
  );
  const level = $derived(
    ratio === null ? 'ok' : ratio >= 0.9 ? 'high' : ratio >= 0.75 ? 'mid' : 'ok',
  );
  const uid = $props.id();
</script>

<div class="gauge">
  <div class="label" id={`${uid}-label`}>{label}</div>
  <div
    class="track"
    role="meter"
    aria-labelledby={`${uid}-label`}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={percent}
    aria-valuetext={text}
  >
    <div class="fill fill-{level}" style:width={`${percent}%`}></div>
  </div>
  <p class="text">{text}</p>
</div>

<style>
  .gauge {
    display: grid;
    gap: var(--space-2);
  }
  .label {
    font-weight: var(--font-weight-medium);
  }
  .track {
    height: 0.625rem;
    border-radius: var(--radius-pill);
    background: var(--color-surface-sunken);
    border: var(--border-width) solid var(--color-border);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--color-primary);
    transition: width var(--duration-normal) var(--easing);
  }
  .fill-mid {
    background: var(--color-warning);
  }
  .fill-high {
    background: var(--color-danger);
  }
  .text {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }
</style>
