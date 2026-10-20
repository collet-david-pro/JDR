<script lang="ts">
  import { untrack } from 'svelte';
  import AppHeader from './components/AppHeader.svelte';
  import Toasts from './components/Toasts.svelte';
  import { describeError } from './lib/errors';
  import { decideAccess } from './lib/guard';
  import { t } from './lib/i18n';
  import type { PageComponent } from './lib/page';
  import { RouteView } from './lib/route-view.svelte';
  import { services } from './lib/services';
  import Forbidden from './pages/Forbidden.svelte';
  import NotFound from './pages/NotFound.svelte';
  import { appStatus } from './stores/app.svelte';

  const { router, auth } = services();
  const appName = t('app.name');
  const view = new RouteView<PageComponent>(
    router,
    (titleKey) => {
      document.title =
        titleKey === null || titleKey === 'app.name' ? appName : `${t(titleKey)} · ${appName}`;
    },
    (state) =>
      decideAccess(
        state.match?.route.access,
        { status: auth.status, user: auth.user },
        state.location,
      ),
  );

  let main: HTMLElement | undefined = $state();
  let path = $state(router.state.location.path);
  const bootError = $derived(auth.status === 'error' ? describeError(auth.error, t) : null);

  $effect(() => untrack(() => view.connect()));
  $effect(() =>
    router.subscribe((state) => {
      path = state.location.path;
    }),
  );

  // Session changes (bootstrap, sign-in, sign-out, 401): apply the route guard again.
  $effect(() => {
    void auth.status;
    void auth.user?.id;
    void auth.user?.role;
    untrack(() => view.refresh());
  });

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

<AppHeader {path} />

<main id="main" tabindex="-1" bind:this={main}>
  {#if appStatus.maintenance}
    <section class="system-page" role="alert">
      <h1>{t('pages.maintenance.title')}</h1>
      <p>{t('errors.maintenance')}</p>
      <button type="button" class="button" onclick={() => window.location.reload()}
        >{t('common.reload')}</button
      >
    </section>
  {:else if bootError}
    <section class="system-page" role="alert">
      <h1>{t('pages.error.title')}</h1>
      <p>{bootError.message}</p>
      {#if bootError.requestId}
        <p class="muted small">{t('pages.error.request_id', { id: bootError.requestId })}</p>
      {/if}
      <button type="button" class="button" onclick={() => auth.bootstrap()}
        >{t('common.retry')}</button
      >
    </section>
  {:else if view.status === 'not_found'}
    <NotFound />
  {:else if view.status === 'forbidden'}
    <Forbidden />
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

<Toasts />

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
  main {
    max-width: 72rem;
    margin: 0 auto;
    padding: var(--space-6) var(--space-5);
    outline: none;
  }
  @media (max-width: 40rem) {
    main {
      padding: var(--space-5) var(--space-4);
    }
  }
  .system-page {
    max-width: 36rem;
  }
  .loading {
    color: var(--color-text-muted);
  }
</style>
