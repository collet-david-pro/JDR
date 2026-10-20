<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../components/Button.svelte';
  import ErrorAlert from '../components/ErrorAlert.svelte';
  import TextField from '../components/TextField.svelte';
  import { normalizeInvitationCode, validateRegister } from '../lib/auth-forms';
  import { FormState } from '../lib/form.svelte';
  import { t } from '../lib/i18n';
  import type { PageProps } from '../lib/page';
  import { href, services } from '../lib/services';
  import type { InvitationCheck } from '../lib/types';
  import { toasts } from '../stores/toasts.svelte';

  let { params, query }: PageProps = $props();

  const { api, auth } = services();
  const form = new FormState();
  let formEl: HTMLFormElement | undefined = $state();
  let email = $state('');
  let username = $state('');
  let password = $state('');
  let confirmation = $state('');
  let code = $state('');
  let checking = $state(false);

  const inviteMode = $derived(auth.registrationMode === 'invite');
  const closed = $derived(auth.registrationMode === 'closed');

  onMount(() => {
    const initial = params['code'] ?? query.get('code') ?? '';
    if (initial !== '') {
      code = normalizeInvitationCode(initial);
      void checkInvitation();
    }
  });

  /** GET /invitations/{code}: validity, and the e-mail the invitation is bound to. */
  async function checkInvitation(): Promise<void> {
    const value = normalizeInvitationCode(code);
    if (value === '') return;
    checking = true;
    try {
      const { data } = await api.get<InvitationCheck>(`/invitations/${encodeURIComponent(value)}`);
      if (!data.valid) form.errors = { ...form.errors, invitation_code: 'invalid' };
      else {
        const { invitation_code: _ignored, ...others } = form.errors;
        form.errors = others;
        if (data.email !== null && email === '') email = data.email;
      }
    } catch {
      // Checked again by the server on submit.
    } finally {
      checking = false;
    }
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const invitationCode = normalizeInvitationCode(code);
    const ok = await form.submit(
      () =>
        auth.register({
          email: email.trim(),
          username: username.trim(),
          password,
          ...(invitationCode !== '' ? { invitation_code: invitationCode } : {}),
        }),
      {
        validate: () =>
          validateRegister({
            email,
            username,
            password,
            confirmation,
            invitationCode: inviteMode ? invitationCode : null,
          }),
        form: formEl,
      },
    );
    if (ok) toasts.success(t('auth.register.welcome', { name: username.trim() }));
  }
</script>

<section class="auth-page card stack">
  <h1>{t('pages.register.title')}</h1>

  {#if closed}
    <p class="alert">{t('auth.register.closed')}</p>
  {:else}
    {#if inviteMode}<p class="muted">{t('auth.register.invite_only')}</p>{/if}
    <ErrorAlert failure={form.failure} />

    <form class="stack" bind:this={formEl} onsubmit={submit} novalidate>
      {#if inviteMode}
        <TextField
          label={t('auth.fields.invitation_code')}
          name="invitation_code"
          autocomplete="off"
          bind:value={code}
          onblur={checkInvitation}
          error={form.message('invitation_code')}
          hint={checking ? t('auth.register.checking') : null}
          required
        />
      {/if}
      <TextField
        label={t('auth.fields.email')}
        name="email"
        type="email"
        autocomplete="email"
        bind:value={email}
        error={form.message('email')}
        required
      />
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
        label={t('auth.fields.password')}
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
        {t('auth.register.submit')}
      </Button>
    </form>
  {/if}

  <p><a href={href('/login')}>{t('auth.register.have_account')}</a></p>
</section>
