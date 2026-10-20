<script lang="ts">
  import { t } from '../lib/i18n';
  import { href } from '../lib/services';
</script>

<section class="forbidden">
  <p class="code" aria-hidden="true">403</p>
  <h1>{t('pages.forbidden.title')}</h1>
  <p>{t('pages.forbidden.text')}</p>
  <p><a class="button button-primary" href={href('/')}>{t('common.home')}</a></p>
</section>

<style>
  .forbidden {
    max-width: 32rem;
    margin: var(--space-7) auto;
    text-align: center;
  }
  .code {
    margin: 0;
    font-family: var(--font-heading);
    font-size: 4rem;
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
  }
  .button {
    text-decoration: none;
  }
</style>
