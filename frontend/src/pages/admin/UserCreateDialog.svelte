<script lang="ts">
  import Button from '../../components/Button.svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import Modal from '../../components/Modal.svelte';
  import SelectField from '../../components/SelectField.svelte';
  import TextField from '../../components/TextField.svelte';
  import { FormState } from '../../lib/form.svelte';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import type { ResetLink, User } from '../../lib/types';
  import { checkEmail, checkPassword, checkUsername, collectErrors } from '../../lib/validation';
  import { toasts } from '../../stores/toasts.svelte';

  interface Props {
    open: boolean;
    oncreated: (user: User, resetLink: ResetLink | null) => void;
  }

  let { open = $bindable(), oncreated }: Props = $props();

  const { api } = services();
  const form = new FormState();
  let formEl: HTMLFormElement | undefined = $state();
  let email = $state('');
  let username = $state('');
  let role = $state('user');
  let password = $state('');

  const roles = [
    { value: 'user', label: t('admin.users.role_user') },
    { value: 'admin', label: t('admin.users.role_admin') },
  ];

  function clear(): void {
    email = username = password = '';
    role = 'user';
    form.reset();
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    let result: { user: User; reset_link: ResetLink | null } | null = null;
    const ok = await form.submit(
      async () => {
        const body = {
          email: email.trim(),
          username: username.trim(),
          role,
          ...(password !== '' ? { password } : {}),
        };
        result = (
          await api.post<{ user: User; reset_link: ResetLink | null }>('/admin/users', body)
        ).data;
      },
      {
        validate: () =>
          collectErrors({
            email: checkEmail(email),
            username: checkUsername(username),
            password: password === '' ? null : checkPassword(password),
          }),
        form: formEl,
      },
    );
    if (ok && result !== null) {
      const { user, reset_link } = result;
      open = false;
      clear();
      toasts.success(t('admin.users.created'));
      oncreated(user, reset_link);
    }
  }
</script>

<Modal bind:open title={t('admin.users.create')}>
  <form class="stack" bind:this={formEl} onsubmit={submit} novalidate>
    <ErrorAlert failure={form.failure} />
    <TextField
      label={t('auth.fields.email')}
      name="email"
      type="email"
      bind:value={email}
      error={form.message('email')}
      required
    />
    <TextField
      label={t('auth.fields.username')}
      name="username"
      bind:value={username}
      error={form.message('username')}
      hint={t('auth.hints.username')}
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
      label={t('admin.users.initial_password')}
      name="password"
      type="password"
      autocomplete="new-password"
      bind:value={password}
      error={form.message('password')}
      hint={t('admin.users.initial_password_hint')}
    />
    <div class="row end">
      <button type="button" class="button" onclick={() => (open = false)}
        >{t('common.cancel')}</button
      >
      <Button type="submit" variant="primary" loading={form.submitting}>{t('common.create')}</Button
      >
    </div>
  </form>
</Modal>

<style>
  .end {
    justify-content: flex-end;
  }
</style>
