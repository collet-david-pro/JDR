<script lang="ts">
  import Button from '../components/Button.svelte';
  import ErrorAlert from '../components/ErrorAlert.svelte';
  import TextField from '../components/TextField.svelte';
  import { ApiError } from '../lib/api';
  import { validateNewPassword } from '../lib/auth-forms';
  import { FormState } from '../lib/form.svelte';
  import { t } from '../lib/i18n';
  import type { PageProps } from '../lib/page';
  import { href, services } from '../lib/services';

  let { params }: PageProps = $props();

  const { api } = services();
  const form = new FormState();
  let formEl: HTMLFormElement | undefined = $state();
  let password = $state('');
  let confirmation = $state('');
  let done = $state(false);
  let expired = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    await form.submit(
      async () => {
        try {
          await api.post('/auth/password/reset', { token: params['token'] ?? '', password });
          done = true;
        } catch (error) {
          if (error instanceof ApiError && error.code === 'reset_link_invalid') expired = true;
          throw error;
        }
      },
      {
        validate: () => validateNewPassword(password, confirmation),
        rename: { new_password: 'password' },
        form: formEl,
      },
    );
  }
</script>

<section class="auth-page card stack">
  <h1>{t('pages.reset.title')}</h1>

  {#if done}
    <p class="alert alert-success" role="status">{t('auth.reset.done')}</p>
    <p><a class="button button-primary" href={href('/login')}>{t('auth.login.submit')}</a></p>
  {:else}
    <ErrorAlert failure={form.failure}>
      {#if expired}<p><a href={href('/forgot')}>{t('auth.reset.request_new')}</a></p>{/if}
    </ErrorAlert>
    <form class="stack" bind:this={formEl} onsubmit={submit} novalidate>
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
      <Button type="submit" variant="primary" loading={form.submitting}>
        {t('auth.reset.submit')}
      </Button>
    </form>
    <p><a href={href('/login')}>{t('auth.back_to_login')}</a></p>
  {/if}
</section>
