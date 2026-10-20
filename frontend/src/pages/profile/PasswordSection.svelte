<script lang="ts">
  import Button from '../../components/Button.svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import TextField from '../../components/TextField.svelte';
  import { validateNewPassword } from '../../lib/auth-forms';
  import { FormState } from '../../lib/form.svelte';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import { checkRequired } from '../../lib/validation';
  import { toasts } from '../../stores/toasts.svelte';

  const { api } = services();
  const form = new FormState();
  let formEl: HTMLFormElement | undefined = $state();
  let current = $state('');
  let password = $state('');
  let confirmation = $state('');

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const ok = await form.submit(
      () => api.post('/me/password', { current_password: current, new_password: password }),
      {
        validate: () => {
          const errors = { ...validateNewPassword(password, confirmation) };
          const missing = checkRequired(current);
          return missing === null ? errors : { ...errors, current_password: missing };
        },
        rename: { new_password: 'password' },
        form: formEl,
      },
    );
    if (ok) {
      current = password = confirmation = '';
      toasts.success(t('profile.password.changed'));
    }
  }
</script>

<section class="card stack" aria-labelledby="profile-password">
  <h2 id="profile-password">{t('profile.password.title')}</h2>
  <ErrorAlert failure={form.failure} />
  <form class="stack" bind:this={formEl} onsubmit={submit} novalidate>
    <TextField
      label={t('auth.fields.current_password')}
      name="current_password"
      type="password"
      autocomplete="current-password"
      bind:value={current}
      error={form.message('current_password')}
      required
    />
    <TextField
      label={t('auth.fields.new_password')}
      name="password"
      type="password"
      autocomplete="new-password"
      bind:value={password}
      error={form.message('password')}
      hint={t('auth.hints.password')}
      required
    />
    <TextField
      label={t('auth.fields.password_confirmation')}
      name="password_confirmation"
      type="password"
      autocomplete="new-password"
      bind:value={confirmation}
      error={form.message('password_confirmation')}
      required
    />
    <p class="small muted">{t('profile.password.other_devices')}</p>
    <div>
      <Button type="submit" variant="primary" loading={form.submitting}>
        {t('profile.password.submit')}
      </Button>
    </div>
  </form>
</section>
