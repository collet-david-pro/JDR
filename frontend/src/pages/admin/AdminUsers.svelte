<script lang="ts">
  import { onMount } from 'svelte';
  import ConfirmDialog from '../../components/ConfirmDialog.svelte';
  import CursorTable from '../../components/CursorTable.svelte';
  import SelectField from '../../components/SelectField.svelte';
  import TextField from '../../components/TextField.svelte';
  import { CursorList, cursorFetcher } from '../../lib/cursor-list.svelte';
  import { formatBytes, formatDateTime } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import type { ResetLink, User } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';
  import LinkDialog from './LinkDialog.svelte';
  import UserCreateDialog from './UserCreateDialog.svelte';
  import UserEditDialog from './UserEditDialog.svelte';

  const { api, auth } = services();
  let q = $state('');
  let status = $state('');
  const list = new CursorList<User>(
    cursorFetcher<User>(api, '/admin/users', () => ({
      q: q.trim() || null,
      status: status || null,
      limit: 50,
    })),
  );

  let creating = $state(false);
  let editing = $state.raw<User | null>(null);
  let deleting = $state.raw<User | null>(null);
  let deleteOpen = $state(false);
  let deleteBusy = $state(false);
  let link = $state.raw<ResetLink | null>(null);
  let busyId = $state<string | null>(null);

  const statusOptions = [
    { value: '', label: t('admin.users.status_all') },
    { value: 'active', label: t('admin.users.status_active') },
    { value: 'suspended', label: t('admin.users.status_suspended') },
  ];

  let debounce: ReturnType<typeof setTimeout> | undefined;
  function filtersChanged(): void {
    clearTimeout(debounce);
    debounce = setTimeout(() => void list.reload(), 300);
  }

  onMount(() => {
    void list.reload();
    return () => clearTimeout(debounce);
  });

  const isSelf = (user: User): boolean => user.id === auth.user?.id;
  const sameId = (id: string) => (item: User) => item.id === id;

  async function action(user: User, run: () => Promise<void>): Promise<void> {
    busyId = user.id;
    try {
      await run();
    } catch (error) {
      toasts.error(error);
    } finally {
      busyId = null;
    }
  }

  function toggleSuspension(user: User): Promise<void> {
    const verb = user.status === 'suspended' ? 'unsuspend' : 'suspend';
    return action(user, async () => {
      const { data } = await api.post<{ user: User }>(`/admin/users/${user.id}/${verb}`);
      list.replace(sameId(user.id), data.user);
      toasts.success(t(verb === 'suspend' ? 'admin.users.suspended' : 'admin.users.unsuspended'));
    });
  }

  function resetLink(user: User): Promise<void> {
    return action(user, async () => {
      link = (await api.post<ResetLink>(`/admin/users/${user.id}/reset-link`)).data;
    });
  }

  async function confirmDelete(): Promise<void> {
    const user = deleting;
    if (user === null) return;
    deleteBusy = true;
    try {
      await api.delete(`/admin/users/${user.id}`);
      list.remove(sameId(user.id));
      deleteOpen = false;
      toasts.success(t('admin.users.deleted'));
    } catch (error) {
      toasts.error(error);
    } finally {
      deleteBusy = false;
    }
  }

  function askDelete(user: User): void {
    deleting = user;
    deleteOpen = true;
  }

  function created(user: User, reset: ResetLink | null): void {
    list.prepend(user);
    link = reset;
  }
</script>

<section class="stack" aria-labelledby="users-title">
  <div class="row toolbar">
    <h2 id="users-title">{t('admin.tabs.users')}</h2>
    <button type="button" class="button button-primary" onclick={() => (creating = true)}>
      {t('admin.users.create')}
    </button>
  </div>
  <div class="row filters">
    <TextField label={t('common.search')} type="search" bind:value={q} oninput={filtersChanged} />
    <SelectField
      label={t('admin.users.status')}
      bind:value={status}
      options={statusOptions}
      onchange={filtersChanged}
    />
  </div>

  <CursorTable
    {list}
    caption={t('admin.tabs.users')}
    columns={6}
    empty={t('admin.users.empty')}
    key={(u) => u.id}
  >
    {#snippet head()}
      <th scope="col">{t('auth.fields.username')}</th>
      <th scope="col">{t('auth.fields.email')}</th>
      <th scope="col">{t('admin.users.role')}</th>
      <th scope="col">{t('admin.users.storage')}</th>
      <th scope="col">{t('admin.users.last_login')}</th>
      <th scope="col">{t('common.actions')}</th>
    {/snippet}
    {#snippet row(user: User)}
      <td>
        {user.username}
        {#if user.status === 'suspended'}<span class="badge badge-warn"
            >{t('admin.users.status_suspended')}</span
          >{/if}
      </td>
      <td>{user.email}</td>
      <td>{t(user.role === 'admin' ? 'admin.users.role_admin' : 'admin.users.role_user')}</td>
      <td>
        {formatBytes(user.storage_used_bytes)} /
        {user.storage_quota_bytes === null
          ? t('admin.users.quota_default')
          : formatBytes(user.storage_quota_bytes)}
      </td>
      <td>{formatDateTime(user.last_login_at)}</td>
      <td>
        <div class="row actions" aria-busy={busyId === user.id}>
          <button type="button" class="button button-small" onclick={() => (editing = user)}
            >{t('common.edit')}</button
          >
          {#if !isSelf(user)}
            <button
              type="button"
              class="button button-small"
              disabled={busyId === user.id}
              onclick={() => toggleSuspension(user)}
            >
              {user.status === 'suspended' ? t('admin.users.unsuspend') : t('admin.users.suspend')}
            </button>
          {/if}
          <button
            type="button"
            class="button button-small"
            disabled={busyId === user.id}
            onclick={() => resetLink(user)}
          >
            {t('admin.users.reset_link')}
          </button>
          {#if !isSelf(user)}
            <button
              type="button"
              class="button button-small button-danger"
              onclick={() => askDelete(user)}
            >
              {t('common.delete')}
            </button>
          {/if}
        </div>
      </td>
    {/snippet}
  </CursorTable>
</section>

<UserCreateDialog bind:open={creating} oncreated={created} />
{#if editing}
  <UserEditDialog
    user={editing}
    onclose={() => (editing = null)}
    onsaved={(user) => list.replace(sameId(user.id), user)}
  />
{/if}
{#if link}
  <LinkDialog
    title={t('admin.users.reset_link_title')}
    url={link.url}
    expiresAt={link.expires_at}
    onclose={() => (link = null)}
  />
{/if}
<ConfirmDialog
  bind:open={deleteOpen}
  title={t('admin.users.delete_title')}
  message={t('admin.users.delete_confirm', { name: deleting?.username ?? '' })}
  confirmLabel={t('common.delete')}
  danger
  busy={deleteBusy}
  onconfirm={confirmDelete}
/>

<style>
  .toolbar {
    justify-content: space-between;
  }
  h2 {
    margin: 0;
  }
  .filters {
    align-items: flex-end;
  }
  .actions {
    flex-wrap: wrap;
    gap: var(--space-1);
  }
</style>
