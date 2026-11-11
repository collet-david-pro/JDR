<script lang="ts">
  import HelpLink from '../../components/HelpLink.svelte';
  import { t } from '../../lib/i18n';
  import type { PageProps } from '../../lib/page';
  import { href } from '../../lib/services';
  import LibraryView from '../../components/library/LibraryView.svelte';
  import NotFound from '../NotFound.svelte';
  import AdminAudit from './AdminAudit.svelte';
  import AdminBackup from './AdminBackup.svelte';
  import AdminDiagnostic from './AdminDiagnostic.svelte';
  import AdminIntegrity from './AdminIntegrity.svelte';
  import AdminInvitations from './AdminInvitations.svelte';
  import AdminMigrations from './AdminMigrations.svelte';
  import AdminSettings from './AdminSettings.svelte';
  import AdminStats from './AdminStats.svelte';
  import AdminUpdate from './AdminUpdate.svelte';
  import AdminUsers from './AdminUsers.svelte';
  import { onMount } from 'svelte';
  import { offerTour } from '../../stores/tour.svelte';

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
    { slug: 'update', label: t('admin.tabs.update') },
    { slug: 'backup', label: t('admin.tabs.backup') },
    { slug: 'integrity', label: t('admin.tabs.integrity') },
  ];

  /** Help section of each tab (P13-2). */
  const ADMIN_HELP: Readonly<Record<string, string>> = {
    '': 'admin-tableau-de-bord',
    users: 'admin-comptes',
    invitations: 'admin-invitations',
    settings: 'admin-reglages',
    library: 'admin-bibliotheque-generale',
    diagnostic: 'admin-diagnostic',
    audit: 'admin-journal-d-audit',
    migrations: 'admin-migrations',
    update: 'admin-mise-a-jour',
    backup: 'admin-sauvegarde',
    integrity: 'admin-integrite',
  };

  const current = $derived((params['rest'] ?? '').replace(/\/+$/, ''));
  onMount(() => offerTour('admin'));

  const tabHref = (slug: string): string => href(slug === '' ? '/admin' : `/admin/${slug}`);
</script>

<div class="admin">
  <div class="title-row">
    <h1>{t('pages.admin.title')}</h1>
    <HelpLink anchor={ADMIN_HELP[current] ?? 'admin-tableau-de-bord'} />
  </div>
  <nav aria-label={t('admin.tabs.label')} data-tour="admin-tabs">
    <ul class="tabs">
      {#each tabs as tab (tab.slug)}
        <li>
          <a
            href={tabHref(tab.slug)}
            data-tour={`admin-tab-${tab.slug === '' ? 'dashboard' : tab.slug}`}
            aria-current={current === tab.slug ? 'page' : undefined}>{tab.label}</a
          >
        </li>
      {/each}
    </ul>
  </nav>

  <div class="panel" data-tour="admin-panel">
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
    {:else if current === 'update'}
      <AdminUpdate />
    {:else if current === 'backup'}
      <AdminBackup />
    {:else if current === 'integrity'}
      <AdminIntegrity />
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
