<script lang="ts">
  import { t } from '../lib/i18n';
  import { SCHEME_PREFERENCES, UI_STYLES } from '../lib/theme';
  import { prefs } from '../stores/prefs.svelte';
</script>

<div class="theme-controls">
  <fieldset>
    <legend>{t('theme.scheme.label')}</legend>
    <div class="segmented">
      {#each SCHEME_PREFERENCES as scheme (scheme)}
        <label class:selected={prefs.scheme === scheme}>
          <input
            type="radio"
            name="theme-scheme"
            value={scheme}
            checked={prefs.scheme === scheme}
            onchange={() => prefs.setScheme(scheme)}
          />
          {t(`theme.scheme.${scheme}`)}
        </label>
      {/each}
    </div>
  </fieldset>

  <fieldset>
    <legend>{t('theme.style.label')}</legend>
    <div class="segmented">
      {#each UI_STYLES as style (style)}
        <label class:selected={prefs.style === style}>
          <input
            type="radio"
            name="theme-style"
            value={style}
            checked={prefs.style === style}
            onchange={() => prefs.setStyle(style)}
          />
          {t(`theme.style.${style}`)}
        </label>
      {/each}
    </div>
  </fieldset>
</div>

<style>
  .theme-controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: var(--space-2);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    color: var(--color-text-muted);
  }
  .segmented {
    display: inline-flex;
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  label {
    position: relative;
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    background: var(--color-surface-raised);
    transition: background-color var(--duration-fast) var(--easing);
  }
  label + label {
    border-left: var(--border-width) solid var(--color-border-strong);
  }
  label:hover {
    background: var(--color-surface-sunken);
  }
  label.selected {
    background: var(--color-primary);
    color: var(--color-on-primary);
  }
  input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  label:has(input:focus-visible) {
    outline: 2px solid var(--color-focus);
    outline-offset: -4px;
  }
</style>
