<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../../components/Button.svelte';
  import ConfirmDialog from '../../components/ConfirmDialog.svelte';
  import CopyField from '../../components/CopyField.svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import TextField from '../../components/TextField.svelte';
  import { describeError, type ErrorSummary } from '../../lib/errors';
  import { formatDateTime } from '../../lib/format';
  import { FormState } from '../../lib/form.svelte';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import type { CreatedInvitation, Invitation } from '../../lib/types';
  import { checkEmail, collectErrors } from '../../lib/validation';
  import { toasts } from '../../stores/toasts.svelte';

  const { api } = services();
  const form = new FormState();
  let formEl: HTMLFormElement | undefined = $state();
  let email = $state('');
  let maxUses = $state('1');
  let days = $state('7');
  let created = $state.raw<CreatedInvitation | null>(null);
  let items = $state.raw<readonly Invitation[] | null>(null);
  let failure = $state.raw<ErrorSummary | null>(null);
  let deleting = $state.raw<Invitation | null>(null);
  let deleteOpen = $state(false);
  let deleteBusy = $state(false);

  const positive = (value: string, optional: boolean): string | null => {
    if (value.trim() === '') return optional ? null : 'required';
    return /^[1-9]\d*$/.test(value.trim()) ? null : 'invalid';
  };

  async function load(): Promise<void> {
    failure = null;
    try {
      items = (await api.get<Invitation[]>('/admin/invitations')).data;
    } catch (error) {
      failure = describeError(error, t);
    }
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    await form.submit(
      async () => {
        const body = {
          max_uses: Number(maxUses),
          ...(email.trim() !== '' ? { email: email.trim() } : {}),
          ...(days.trim() !== '' ? { expires_in_days: Number(days) } : {}),
        };
        const { data } = await api.post<CreatedInvitation>('/admin/invitations', body);
        created = data;
        items = [data.invitation, ...(items ?? [])];
        email = '';
      },
      {
        validate: () =>
          collectErrors({
            email: email.trim() === '' ? null : checkEmail(email),
            max_uses: positive(maxUses, false),
            expires_in_days: positive(days, true),
          }),
        form: formEl,
      },
    );
  }

  async function confirmDelete(): Promise<void> {
    const invitation = deleting;
    if (invitation === null) return;
    deleteBusy = true;
    try {
      await api.delete(`/admin/invitations/${invitation.id}`);
      items = (items ?? []).filter((item) => item.id !== invitation.id);
      deleteOpen = false;
      toasts.success(t('admin.invitations.deleted'));
    } catch (error) {
      toasts.error(error);
    } finally {
      deleteBusy = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<div class="stack">
  <section class="card stack" aria-labelledby="invite-create">
    <h2 id="invite-create">{t('admin.invitations.create')}</h2>
    <ErrorAlert failure={form.failure} />
    <form class="grid" bind:this={formEl} onsubmit={submit} novalidate>
      <TextField
        label={t('admin.invitations.email')}
        name="email"
        type="email"
        bind:value={email}
        error={form.message('email')}
        hint={t('admin.invitations.email_hint')}
      />
      <TextField
        label={t('admin.invitations.max_uses')}
        name="max_uses"
        inputmode="numeric"
        bind:value={maxUses}
        error={form.message('max_uses')}
        required
      />
      <TextField
        label={t('admin.invitations.expires_in_days')}
        name="expires_in_days"
        inputmode="numeric"
        bind:value={days}
        error={form.message('expires_in_days')}
        hint={t('admin.invitations.expires_hint')}
      />
      <div class="submit">
        <Button type="submit" variant="primary" loading={form.submitting}
          >{t('common.create')}</Button
        >
      </div>
    </form>
    {#if created}
      <div class="stack created" role="status">
        <p class="alert alert-warning">{t('admin.links.once')}</p>
        <CopyField label={t('admin.invitations.code')} value={created.code} />
        <CopyField label={t('admin.links.url')} value={created.url} />
      </div>
    {/if}
  </section>

  <section class="card stack" aria-labelledby="invite-list">
    <h2 id="invite-list">{t('admin.invitations.list')}</h2>
    <ErrorAlert {failure} />
    {#if items === null && failure === null}
      <p class="muted" aria-busy="true">{t('common.loading')}</p>
    {:else if items !== null}
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">{t('admin.invitations.email')}</th>
              <th scope="col">{t('admin.invitations.uses')}</th>
              <th scope="col">{t('admin.invitations.expires_at')}</th>
              <th scope="col">{t('admin.invitations.created_at')}</th>
              <th scope="col">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {#each items as item (item.id)}
              <tr>
                <td>{item.email ?? t('admin.invitations.anyone')}</td>
                <td>{item.uses} / {item.max_uses}</td>
                <td
                  >{item.expires_at
                    ? formatDateTime(item.expires_at)
                    : t('admin.invitations.never')}</td
                >
                <td>{formatDateTime(item.created_at)}</td>
                <td>
                  <button
                    type="button"
                    class="button button-small button-danger"
                    onclick={() => {
                      deleting = item;
                      deleteOpen = true;
                    }}>{t('common.delete')}</button
                  >
                </td>
              </tr>
            {:else}
              <tr><td colspan="5" class="muted">{t('admin.invitations.empty')}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<ConfirmDialog
  bind:open={deleteOpen}
  title={t('admin.invitations.delete_title')}
  message={t('admin.invitations.delete_confirm')}
  confirmLabel={t('common.delete')}
  danger
  busy={deleteBusy}
  onconfirm={confirmDelete}
/>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
    gap: var(--space-4);
    align-items: start;
  }
  .submit {
    align-self: end;
  }
  .created {
    padding-top: var(--space-4);
    border-top: var(--border-width) solid var(--color-border);
  }
  .created p {
    margin: 0;
  }
</style>
