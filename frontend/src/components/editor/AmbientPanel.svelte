<script lang="ts">
  import type { WeatherType } from '../../editor/contracts';
  import { WEATHER_TYPES, weatherLabel } from '../../editor/ui/scene-labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /**
   * Ambient light (projet.md 2.5, 14.2): darkness, tint, time of day (optional: the day / night
   * curve then drives darkness and tint), weather (saved only in P5). Undoable map.meta edits;
   * slider drags merge into one step.
   */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  const a = $derived(ui.ambient);
  const num = (event: Event): number => Number((event.currentTarget as HTMLInputElement).value);
  const hours = (h: number): string =>
    `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
</script>

<section class="panel" aria-labelledby={`${uid}-title`} data-testid="ambient-panel">
  <h2 id={`${uid}-title`}>{t('editor.ambient.title')}</h2>
  <label class="field">
    <span>{t('editor.ambient.darkness', { value: Math.round(a.darkness * 100) })}</span>
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      value={a.darkness}
      disabled={a.time_of_day !== null}
      data-testid="ambient-darkness"
      onchange={(e) => session.scene.setAmbient({ darkness: num(e) }, 'ambient:darkness')}
    />
  </label>
  <label class="row">
    <span>{t('editor.ambient.tint')}</span>
    <input
      type="color"
      value={a.tint}
      disabled={a.time_of_day !== null}
      onchange={(e) => session.scene.setAmbient({ tint: e.currentTarget.value })}
    />
  </label>
  <label class="check">
    <input
      type="checkbox"
      checked={a.time_of_day !== null}
      data-testid="ambient-time-enabled"
      onchange={(e) =>
        session.scene.setAmbient({ time_of_day: e.currentTarget.checked ? 12 : null })}
    />
    {t('editor.ambient.time_enabled')}
  </label>
  {#if a.time_of_day !== null}
    <label class="field">
      <span>{t('editor.ambient.time', { value: hours(a.time_of_day) })}</span>
      <input
        type="range"
        min="0"
        max="24"
        step="0.25"
        value={a.time_of_day}
        onchange={(e) => session.scene.setAmbient({ time_of_day: num(e) }, 'ambient:time')}
      />
    </label>
  {/if}
  <label class="row">
    <span>{t('editor.ambient.weather')}</span>
    <select
      value={a.weather.type}
      onchange={(e) =>
        session.scene.setAmbient({
          weather: { ...a.weather, type: e.currentTarget.value as WeatherType },
        })}
    >
      {#each WEATHER_TYPES as w (w)}<option value={w}>{weatherLabel(w)}</option>{/each}
    </select>
  </label>
  {#if a.weather.type !== 'none'}
    <label class="field">
      <span
        >{t('editor.ambient.weather_intensity', {
          value: Math.round(a.weather.intensity * 100),
        })}</span
      >
      <input
        type="range"
        min="0"
        max="1"
        step="0.1"
        value={a.weather.intensity}
        onchange={(e) =>
          session.scene.setAmbient(
            { weather: { ...a.weather, intensity: num(e) } },
            'ambient:weather',
          )}
      />
    </label>
    <p class="small muted">{t('editor.ambient.weather_hint')}</p>
  {/if}
</section>

<style>
  .panel {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border-bottom: var(--border-width) solid var(--color-border);
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
  p {
    margin: 0;
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
