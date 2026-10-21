<script lang="ts">
  import { t } from '../../lib/i18n';

  /** Incompatibility page (projet.md 22): neither WebGPU nor WebGL 2. */
</script>

<section class="unsupported" role="alert" data-testid="engine-unsupported">
  <h2>{t('engine.unsupported.title')}</h2>
  <p>{t('engine.unsupported.text')}</p>
  <p class="muted">{t('engine.unsupported.hint')}</p>
</section>

<style>
  .unsupported {
    max-width: 36rem;
    margin: 0 auto;
    padding: var(--space-5);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    box-shadow: var(--shadow-md);
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-lg);
  }
  p {
    margin: var(--space-2) 0 0;
  }
</style>
