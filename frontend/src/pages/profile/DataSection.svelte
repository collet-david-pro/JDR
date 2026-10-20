<script lang="ts">
  import ConfirmDialog from '../../components/ConfirmDialog.svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import TextField from '../../components/TextField.svelte';
  import { FormState } from '../../lib/form.svelte';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import { checkRequired, collectErrors } from '../../lib/validation';
  import { toasts } from '../../stores/toasts.svelte';

  const { api, auth, router } = services();
  const form = new FormState();
  let confirmOpen = $state(false);
  let password = $state('');

  // GET request with the session cookie: the browser downloads the JSON attachment.
  const exportUrl = api.url('/me/export');

  function openConfirm(): void {
    password = '';
    form.reset();
    confirmOpen = true;
  }

  async function deleteAccount(): Promise<void> {
    const ok = await form.submit(() => api.delete('/me', { body: { password } }), {
      validate: () => collectErrors({ password: checkRequired(password) }),
    });
    if (!ok) return;
    confirmOpen = false;
    await auth.forget();
    toasts.success(t('profile.data.deleted'));
    router.navigate('/login', { replace: true });
  }
</script>

<section class="card stack" aria-labelledby="profile-data">
  <h2 id="profile-data">{t('profile.data.title')}</h2>
  <div class="stack">
    <p class="muted small">{t('profile.data.export_hint')}</p>
    <p><a class="button" href={exportUrl} download rel="external">{t('profile.data.export')}</a></p>
  </div>
  <div class="stack danger-zone">
    <h3>{t('profile.data.delete_title')}</h3>
    <p class="muted small">{t('profile.data.delete_hint')}</p>
    <p>
      <button type="button" class="button button-danger" onclick={openConfirm}
        >{t('profile.data.delete')}</button
      >
    </p>
  </div>
</section>

<ConfirmDialog
  bind:open={confirmOpen}
  title={t('profile.data.delete_title')}
  message={t('profile.data.delete_confirm')}
  confirmLabel={t('profile.data.delete')}
  danger
  busy={form.submitting}
  confirmDisabled={password === ''}
  onconfirm={deleteAccount}
>
  <ErrorAlert failure={form.failure} />
  <TextField
    label={t('auth.fields.current_password')}
    name="password"
    type="password"
    autocomplete="current-password"
    bind:value={password}
    error={form.message('password')}
    required
  />
</ConfirmDialog>

<style>
  .danger-zone {
    padding-top: var(--space-4);
    border-top: var(--border-width) solid var(--color-border);
  }
  h3,
  p {
    margin: 0;
  }
</style>
