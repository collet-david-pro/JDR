<script lang="ts">
  import { ambientOf } from '../../editor/model/scene-values';
  import { WEATHER_TYPES, weatherLabel } from '../../editor/ui/scene-labels';
  import type { WeatherType } from '../../editor/contracts';
  import { t } from '../../lib/i18n';
  import type { PanelProps } from '../../lib/sessions/console/panel-props';
  import type { SessionAction } from '../../lib/sessions/types';

  /** Console panel "Ambiance": time of day, weather, darkness, tint (`ambient.set`). */
  let { run, send }: PanelProps = $props();
  const uid = $props.id();
  const a = $derived(ambientOf(run.state?.ambient));
  const num = (event: Event): number => Number((event.currentTarget as HTMLInputElement).value);
  const hours = (h: number): string =>
    `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

  function set(patch: Record<string, unknown>): void {
    void send([{ type: 'ambient.set', ambient: patch } as SessionAction]);
  }
</script>

<section class="panel" aria-labelledby={`${uid}-title`} data-testid="ambiance-panel">
  <h2 id={`${uid}-title`}>{t('sessions.ambiance.title')}</h2>
  <label class="check">
    <input
      type="checkbox"
      checked={a.time_of_day !== null}
      onchange={(e) => set({ time_of_day: e.currentTarget.checked ? 12 : null })}
    />
    {t('sessions.ambiance.time_enabled')}
  </label>
  {#if a.time_of_day !== null}
    <label class="field">
      <span>{t('sessions.ambiance.time', { value: hours(a.time_of_day) })}</span>
      <input
        type="range"
        min="0"
        max="24"
        step="0.25"
        value={a.time_of_day}
        onchange={(e) => set({ time_of_day: num(e) })}
      />
    </label>
  {/if}
  <label class="field">
    <span>{t('sessions.ambiance.darkness', { value: Math.round(a.darkness * 100) })}</span>
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      value={a.darkness}
      disabled={a.time_of_day !== null}
      onchange={(e) => set({ darkness: num(e) })}
    />
  </label>
  <label class="row">
    <span>{t('sessions.ambiance.tint')}</span>
    <input
      type="color"
      value={a.tint}
      disabled={a.time_of_day !== null}
      onchange={(e) => set({ tint: e.currentTarget.value })}
    />
  </label>
  <label class="row">
    <span>{t('sessions.ambiance.weather')}</span>
    <select
      value={a.weather.type}
      onchange={(e) =>
        set({ weather: { ...a.weather, type: e.currentTarget.value as WeatherType } })}
    >
      {#each WEATHER_TYPES as w (w)}<option value={w}>{weatherLabel(w)}</option>{/each}
    </select>
  </label>
  {#if a.weather.type !== 'none'}
    <label class="field">
      <span
        >{t('sessions.ambiance.intensity', { value: Math.round(a.weather.intensity * 100) })}</span
      >
      <input
        type="range"
        min="0"
        max="1"
        step="0.1"
        value={a.weather.intensity}
        onchange={(e) => set({ weather: { ...a.weather, intensity: num(e) } })}
      />
    </label>
  {/if}
</section>

<style>
  .panel {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--font-size-sm);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    align-items: center;
  }
  .check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  select {
    padding: 2px var(--space-1);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
  }
</style>
