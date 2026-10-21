<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { PageProps } from '../../lib/page';
  import { href } from '../../lib/services';
  import LibraryView from '../../components/library/LibraryView.svelte';
  import NotFound from '../NotFound.svelte';
  import AdminAudit from './AdminAudit.svelte';
  import AdminDiagnostic from './AdminDiagnostic.svelte';
  import AdminInvitations from './AdminInvitations.svelte';
  import AdminMigrations from './AdminMigrations.svelte';
  import AdminSettings from './AdminSettings.svelte';
  import AdminStats from './AdminStats.svelte';
  import AdminUsers from './AdminUsers.svelte';

  let { params }: PageProps = $props();

  const tabs = [
    { slug: '', label: t('admin.tabs.dashboard') },
    { slug: 'users', label: t('admin.tabs.users') },
    { slug: 'invitations', label: t('admin.tabs.invitations') },
    { slug: 'settings', label: t('admin.tabs.settings') },
    { slug: 'library', label: t('admin.tabs.library') },
    { slug: 'diagnostic', label: t('admin.tabs.diagnostic') },
    { slug: 'audit', label: t('admin.tabs.audit') },
    { slug: 'migrations', label: t('admin.tabs.migrations') },
  ];

  const current = $derived((params['rest'] ?? '').replace(/\/+$/, ''));
  const tabHref = (slug: string): string => href(slug === '' ? '/admin' : `/admin/${slug}`);
</script>

<div class="admin">
  <h1>{t('pages.admin.title')}</h1>
  <nav aria-label={t('admin.tabs.label')}>
    <ul class="tabs">
      {#each tabs as tab (tab.slug)}
        <li>
          <a href={tabHref(tab.slug)} aria-current={current === tab.slug ? 'page' : undefined}
            >{tab.label}</a
          >
        </li>
      {/each}
    </ul>
  </nav>

  <div class="panel">
    {#if current === ''}
      <AdminStats />
    {:else if current === 'users'}
      <AdminUsers />
    {:else if current === 'invitations'}
      <AdminInvitations />
    {:else if current === 'settings'}
      <AdminSettings />
    {:else if current === 'library'}
      <LibraryView admin titleLevel={2} />
    {:else if current === 'diagnostic'}
      <AdminDiagnostic />
    {:else if current === 'audit'}
      <AdminAudit />
    {:else if current === 'migrations'}
      <AdminMigrations />
    {:else}
      <NotFound />
    {/if}
  </div>
</div>

<style>
  .admin {
    display: grid;
    gap: var(--space-4);
  }
  h1 {
    margin: 0;
  }
  .tabs {
    display: flex;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-x: auto;
    border-bottom: var(--border-width) solid var(--color-border);
  }
  .tabs a {
    display: block;
    padding: var(--space-2) var(--space-4);
    border-bottom: 2px solid transparent;
    color: var(--color-text-muted);
    text-decoration: none;
    white-space: nowrap;
  }
  .tabs a:hover {
    color: var(--color-text);
  }
  .tabs a[aria-current='page'] {
    border-bottom-color: var(--color-primary);
    color: var(--color-primary);
    font-weight: var(--font-weight-medium);
  }
</style>
