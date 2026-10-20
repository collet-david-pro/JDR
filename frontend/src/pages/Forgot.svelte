<script lang="ts">
  import Button from '../components/Button.svelte';
  import ErrorAlert from '../components/ErrorAlert.svelte';
  import TextField from '../components/TextField.svelte';
  import { FormState } from '../lib/form.svelte';
  import { t } from '../lib/i18n';
  import type { PageProps } from '../lib/page';
  import { href, services } from '../lib/services';
  import type { ForgotResult } from '../lib/types';
  import { checkEmail, collectErrors } from '../lib/validation';

  let _props: PageProps = $props();

  const { api } = services();
  const form = new FormState();
  let formEl: HTMLFormElement | undefined = $state();
  let email = $state('');
  let result = $state<ForgotResult['mode'] | null>(null);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    await form.submit(
      async () => {
        const { data } = await api.post<ForgotResult>('/auth/password/forgot', {
          email: email.trim(),
        });
        result = data.mode;
      },
      { validate: () => collectErrors({ email: checkEmail(email) }), form: formEl },
    );
  }
</script>

<section class="auth-page card stack">
  <h1>{t('pages.forgot.title')}</h1>

  {#if result === 'email'}
    <p class="alert alert-success" role="status">{t('auth.forgot.sent')}</p>
  {:else if result === 'contact_admin'}
    <p class="alert alert-warning" role="status">{t('auth.forgot.contact_admin')}</p>
  {:else}
    <p class="muted">{t('auth.forgot.intro')}</p>
    <ErrorAlert failure={form.failure} />
    <form class="stack" bind:this={formEl} onsubmit={submit} novalidate>
      <TextField
        label={t('auth.fields.email')}
        name="email"
        type="email"
        autocomplete="email"
        bind:value={email}
        error={form.message('email')}
        required
      />
      <Button type="submit" variant="primary" loading={form.submitting}>
        {t('auth.forgot.submit')}
      </Button>
    </form>
  {/if}

  <p><a href={href('/login')}>{t('auth.back_to_login')}</a></p>
</section>
