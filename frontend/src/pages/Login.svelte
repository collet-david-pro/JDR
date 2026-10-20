<script lang="ts">
  import Button from '../components/Button.svelte';
  import CheckboxField from '../components/CheckboxField.svelte';
  import ErrorAlert from '../components/ErrorAlert.svelte';
  import TextField from '../components/TextField.svelte';
  import { FormState } from '../lib/form.svelte';
  import { t } from '../lib/i18n';
  import type { PageProps } from '../lib/page';
  import { href, services } from '../lib/services';
  import { checkRequired, collectErrors } from '../lib/validation';

  let { query }: PageProps = $props();

  const { auth } = services();
  const form = new FormState();
  let formEl: HTMLFormElement | undefined = $state();
  let identifier = $state('');
  let password = $state('');
  let remember = $state(false);

  const nextQuery = $derived(query.get('next'));

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    // On success the route guard sends the user to ?next (App.svelte).
    await form.submit(() => auth.login({ identifier: identifier.trim(), password, remember }), {
      validate: () =>
        collectErrors({ identifier: checkRequired(identifier), password: checkRequired(password) }),
      form: formEl,
    });
  }
</script>

<section class="auth-page card stack">
  <h1>{t('pages.login.title')}</h1>
  {#if nextQuery}<p class="muted">{t('auth.login.required')}</p>{/if}

  <ErrorAlert failure={form.failure} />

  <form class="stack" bind:this={formEl} onsubmit={submit} novalidate>
    <TextField
      label={t('auth.fields.identifier')}
      name="identifier"
      autocomplete="username"
      bind:value={identifier}
      error={form.message('identifier')}
      required
    />
    <TextField
      label={t('auth.fields.password')}
      name="password"
      type="password"
      autocomplete="current-password"
      bind:value={password}
      error={form.message('password')}
      required
    />
    <CheckboxField
      label={t('auth.login.remember')}
      hint={t('auth.login.remember_hint')}
      bind:checked={remember}
    />
    <Button type="submit" variant="primary" loading={form.submitting}
      >{t('auth.login.submit')}</Button
    >
  </form>

  <p class="links">
    <a href={href('/forgot')}>{t('auth.login.forgot')}</a>
    {#if auth.registrationMode === 'open'}
      <a href={href('/register')}>{t('auth.login.register')}</a>
    {/if}
  </p>
</section>

<style>
  .links {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-3);
    margin: 0;
  }
</style>
