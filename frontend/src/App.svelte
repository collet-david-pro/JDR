<script lang="ts">
  import { t } from './lib/i18n';
  import type { PageComponent } from './lib/page';
  import { RouteView } from './lib/route-view.svelte';
  import { href, services } from './lib/services';
  import NotFound from './pages/NotFound.svelte';
  import { appStatus } from './stores/app.svelte';

  const appName = t('app.name');
  const view = new RouteView<PageComponent>(services().router, (titleKey) => {
    document.title =
      titleKey === null || titleKey === 'app.name' ? appName : `${t(titleKey)} · ${appName}`;
  });

  let main: HTMLElement | undefined = $state();

  $effect(() => view.connect());

  // Move the focus to the new page after an in-app navigation (screen readers, keyboard).
  $effect(() => {
    if (view.navigations > 1) main?.focus({ preventScroll: true });
  });

  function skipToContent(event: MouseEvent): void {
    event.preventDefault();
    main?.focus();
  }
</script>

<a class="skip-link" href="#main" onclick={skipToContent}>{t('app.skip_to_content')}</a>

{#if appStatus.applyUpdate}
  <div class="banner" role="status">
    <span>{t('app.update_available')}</span>
    <button type="button" class="button button-primary" onclick={() => appStatus.applyUpdate?.()}>
      {t('common.reload')}
    </button>
  </div>
{/if}

<header class="topbar">
  <a class="brand" href={href('/')}>{appName}</a>
</header>

<main id="main" tabindex="-1" bind:this={main}>
  {#if appStatus.maintenance}
    <section class="system-page" role="alert">
      <h1>{t('pages.maintenance.title')}</h1>
      <p>{t('errors.maintenance')}</p>
      <button type="button" class="button" onclick={() => window.location.reload()}
        >{t('common.reload')}</button
      >
    </section>
  {:else if view.status === 'not_found'}
    <NotFound />
  {:else if view.status === 'error'}
    <section class="system-page" role="alert">
      <h1>{t('pages.error.title')}</h1>
      <p>{t('pages.error.load_text')}</p>
      <button type="button" class="button" onclick={() => window.location.reload()}
        >{t('common.reload')}</button
      >
    </section>
  {:else if view.component}
    {@const Page = view.component}
    <Page params={view.params} query={view.query} />
  {:else}
    <p class="loading" aria-busy="true">{t('common.loading')}</p>
  {/if}
</main>

<style>
  .skip-link {
    position: absolute;
    left: var(--space-4);
    top: -100px;
    z-index: var(--z-overlay);
    padding: var(--space-2) var(--space-4);
    background: var(--color-surface-raised);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }
  .skip-link:focus {
    top: var(--space-4);
  }
  .banner {
    position: sticky;
    top: 0;
    z-index: var(--z-banner);
    display: flex;
    gap: var(--space-4);
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-4);
    background: var(--color-primary-soft);
    border-bottom: var(--border-width) solid var(--color-border);
  }
  .topbar {
    display: flex;
    align-items: center;
    padding: var(--space-3) var(--space-5);
    background: var(--color-surface);
    border-bottom: var(--border-width) solid var(--color-border);
  }
  .brand {
    font-family: var(--font-heading);
    font-weight: var(--font-weight-bold);
    font-size: var(--font-size-lg);
    letter-spacing: var(--heading-letter-spacing);
    color: var(--color-text);
    text-decoration: none;
  }
  main {
    padding: var(--space-6) var(--space-5);
    outline: none;
  }
  .system-page {
    max-width: 36rem;
  }
  .loading {
    color: var(--color-text-muted);
  }
</style>
