<script lang="ts">
  import Button from '../../components/Button.svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import SelectField from '../../components/SelectField.svelte';
  import TextField from '../../components/TextField.svelte';
  import { FormState } from '../../lib/form.svelte';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import type { User } from '../../lib/types';
  import { checkEmail, checkRequired, checkUsername, collectErrors } from '../../lib/validation';
  import { toasts } from '../../stores/toasts.svelte';

  const { api, auth } = services();
  const form = new FormState();
  let formEl: HTMLFormElement | undefined = $state();

  const initial = auth.user;
  let username = $state(initial?.username ?? '');
  let email = $state(initial?.email ?? '');
  let locale = $state(initial?.locale ?? 'fr');
  let currentPassword = $state('');

  const emailChanged = $derived(email.trim() !== (auth.user?.email ?? ''));
  const locales = [{ value: 'fr', label: t('profile.info.locales.fr') }];

  /** PATCH /me with the changed fields only (current password required for the e-mail). */
  function changes(): Record<string, string> {
    const user = auth.user;
    const body: Record<string, string> = {};
    if (user === null) return body;
    if (username.trim() !== user.username) body['username'] = username.trim();
    if (emailChanged) {
      body['email'] = email.trim();
      body['current_password'] = currentPassword;
    }
    if (locale !== user.locale) body['locale'] = locale;
    return body;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const body = changes();
    if (Object.keys(body).length === 0) {
      toasts.info(t('profile.info.unchanged'));
      return;
    }
    const ok = await form.submit(
      async () => {
        const { data } = await api.patch<{ user: User }>('/me', body);
        auth.setUser(data.user);
      },
      {
        validate: () =>
          collectErrors({
            username: checkUsername(username),
            email: checkEmail(email),
            current_password: emailChanged ? checkRequired(currentPassword) : null,
          }),
        form: formEl,
      },
    );
    if (ok) {
      currentPassword = '';
      toasts.success(t('profile.info.saved'));
    }
  }
</script>

<section class="card stack" aria-labelledby="profile-info">
  <h2 id="profile-info">{t('profile.info.title')}</h2>
  <ErrorAlert failure={form.failure} />
  <form class="stack" bind:this={formEl} onsubmit={submit} novalidate>
    <TextField
      label={t('auth.fields.username')}
      name="username"
      autocomplete="nickname"
      bind:value={username}
      error={form.message('username')}
      hint={t('auth.hints.username')}
      required
    />
    <TextField
      label={t('auth.fields.email')}
      name="email"
      type="email"
      autocomplete="email"
      bind:value={email}
      error={form.message('email')}
      required
    />
    {#if emailChanged}
      <TextField
        label={t('auth.fields.current_password')}
        name="current_password"
        type="password"
        autocomplete="current-password"
        bind:value={currentPassword}
        error={form.message('current_password')}
        hint={t('profile.info.password_needed')}
        required
      />
    {/if}
    <SelectField
      label={t('profile.info.locale')}
      name="locale"
      bind:value={locale}
      options={locales}
      error={form.message('locale')}
    />
    <div>
      <Button type="submit" variant="primary" loading={form.submitting}>{t('common.save')}</Button>
    </div>
  </form>
</section>
