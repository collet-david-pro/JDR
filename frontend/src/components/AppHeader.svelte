<script lang="ts">
  import { t } from '../lib/i18n';
  import { href, services } from '../lib/services';
  import { toasts } from '../stores/toasts.svelte';
  import ThemeControls from './ThemeControls.svelte';

  interface Props {
    /** Current SPA path (aria-current on the active link). */
    path: string;
  }

  let { path }: Props = $props();
  const { auth, router } = services();
  let busy = $state(false);

  const links = $derived([
    { to: '/', label: t('nav.dashboard') },
    { to: '/library', label: t('nav.library') },
    { to: '/profile', label: t('nav.profile') },
    ...(auth.isAdmin ? [{ to: '/admin', label: t('nav.admin') }] : []),
  ]);

  function isCurrent(to: string): boolean {
    return to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`);
  }

  async function logout(): Promise<void> {
    busy = true;
    try {
      await auth.logout();
      router.navigate('/login', { replace: true });
    } catch (error) {
      toasts.error(error);
    } finally {
      busy = false;
    }
  }
</script>

<header class="topbar">
  <a class="brand" href={href('/')}>{t('app.name')}</a>

  {#if auth.user}
    <nav aria-label={t('nav.label')}>
      <ul>
        {#each links as link (link.to)}
          <li>
            <a href={href(link.to)} aria-current={isCurrent(link.to) ? 'page' : undefined}
              >{link.label}</a
            >
          </li>
        {/each}
      </ul>
    </nav>
  {/if}

  <div class="tools">
    <details class="theme-menu">
      <summary class="button button-ghost">{t('nav.theme')}</summary>
      <div class="panel"><ThemeControls /></div>
    </details>
    {#if auth.user}
      <span class="user muted small">{auth.user.username}</span>
      <button type="button" class="button" onclick={logout} disabled={busy} aria-busy={busy}>
        {t('nav.logout')}
      </button>
    {/if}
  </div>
</header>

<style>
  .topbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-5);
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
  nav ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  nav a {
    display: block;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    color: var(--color-text);
    text-decoration: none;
  }
  nav a:hover {
    background: var(--color-surface-sunken);
  }
  nav a[aria-current='page'] {
    background: var(--color-primary-soft);
    color: var(--color-primary);
    font-weight: var(--font-weight-medium);
  }
  .tools {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-left: auto;
  }
  .theme-menu {
    position: relative;
  }
  summary {
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .panel {
    position: absolute;
    right: 0;
    top: calc(100% + var(--space-2));
    z-index: var(--z-overlay);
    padding: var(--space-4);
    background: var(--color-surface-raised);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    width: max-content;
    max-width: calc(100vw - 2 * var(--space-4));
  }
  @media (max-width: 40rem) {
    .user {
      display: none;
    }
  }
</style>
