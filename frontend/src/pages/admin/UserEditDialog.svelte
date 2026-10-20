<script lang="ts">
  import { untrack } from 'svelte';
  import Button from '../../components/Button.svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import Modal from '../../components/Modal.svelte';
  import SelectField from '../../components/SelectField.svelte';
  import TextField from '../../components/TextField.svelte';
  import { buildUserPatch } from '../../lib/admin-users';
  import { bytesToMbInput, mbInputToBytes } from '../../lib/format';
  import { FormState } from '../../lib/form.svelte';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import type { User } from '../../lib/types';
  import { checkEmail, checkUsername, collectErrors } from '../../lib/validation';
  import { toasts } from '../../stores/toasts.svelte';

  interface Props {
    user: User;
    onclose: () => void;
    onsaved: (user: User) => void;
  }

  let { user, onclose, onsaved }: Props = $props();

  const { api, auth } = services();
  const form = new FormState();
  let formEl: HTMLFormElement | undefined = $state();
  let open = $state(true);
  // The dialog is created for one user (keyed by the parent): initial values only.
  const initial = untrack(() => user);
  let username = $state(initial.username);
  let email = $state(initial.email);
  let role = $state<string>(initial.role);
  let quotaMb = $state(bytesToMbInput(initial.storage_quota_bytes));

  const roles = [
    { value: 'user', label: t('admin.users.role_user') },
    { value: 'admin', label: t('admin.users.role_admin') },
  ];

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const patch = buildUserPatch(user, { username, email, role, quotaMb });
    if (Object.keys(patch).length === 0) {
      open = false;
      return;
    }
    const ok = await form.submit(
      async () => {
        const { data } = await api.patch<{ user: User }>(`/admin/users/${user.id}`, patch);
        onsaved(data.user);
        if (data.user.id === auth.user?.id) auth.setUser(data.user);
      },
      {
        validate: () =>
          collectErrors({
            username: checkUsername(username),
            email: checkEmail(email),
            storage_quota_bytes: mbInputToBytes(quotaMb) === undefined ? 'invalid' : null,
          }),
        form: formEl,
      },
    );
    if (ok) {
      open = false;
      toasts.success(t('admin.users.saved'));
    }
  }
</script>

<Modal bind:open title={t('admin.users.edit_title', { name: user.username })} {onclose}>
  <form class="stack" bind:this={formEl} onsubmit={submit} novalidate>
    <ErrorAlert failure={form.failure} />
    <TextField
      label={t('auth.fields.username')}
      name="username"
      bind:value={username}
      error={form.message('username')}
      required
    />
    <TextField
      label={t('auth.fields.email')}
      name="email"
      type="email"
      bind:value={email}
      error={form.message('email')}
      required
    />
    <SelectField
      label={t('admin.users.role')}
      name="role"
      bind:value={role}
      options={roles}
      error={form.message('role')}
    />
    <TextField
      label={t('admin.users.quota_mb')}
      name="storage_quota_bytes"
      inputmode="decimal"
      bind:value={quotaMb}
      error={form.message('storage_quota_bytes')}
      hint={t('admin.users.quota_hint')}
    />
    <div class="row end">
      <button type="button" class="button" onclick={() => (open = false)}
        >{t('common.cancel')}</button
      >
      <Button type="submit" variant="primary" loading={form.submitting}>{t('common.save')}</Button>
    </div>
  </form>
</Modal>

<style>
  .end {
    justify-content: flex-end;
  }
</style>
