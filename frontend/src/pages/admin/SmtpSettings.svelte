<script lang="ts">
  import Button from '../../components/Button.svelte';
  import SelectField from '../../components/SelectField.svelte';
  import TextField from '../../components/TextField.svelte';
  import type { FormState } from '../../lib/form.svelte';
  import type { SettingsValueKey } from '../../lib/settings-form';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import { toasts } from '../../stores/toasts.svelte';

  interface Props {
    values: Record<SettingsValueKey, string>;
    password: string;
    passwordSet: boolean;
    form: FormState;
  }

  let { values = $bindable(), password = $bindable(), passwordSet, form }: Props = $props();

  const { api, auth } = services();
  let to = $state(auth.user?.email ?? '');
  let testing = $state(false);
  let result = $state.raw<{ sent: boolean; log: readonly string[] } | null>(null);

  const encryptions = [
    { value: 'none', label: t('admin.smtp.encryption_none') },
    { value: 'starttls', label: 'STARTTLS' },
    { value: 'tls', label: 'TLS' },
  ];

  /** POST /admin/settings/smtp-test: uses the saved settings (save first). */
  async function sendTest(): Promise<void> {
    testing = true;
    result = null;
    try {
      result = (
        await api.post<{ sent: boolean; log: string[] }>('/admin/settings/smtp-test', {
          to: to.trim(),
        })
      ).data;
    } catch (error) {
      toasts.error(error);
    } finally {
      testing = false;
    }
  }
</script>

<fieldset class="card grid">
  <legend>{t('admin.smtp.title')}</legend>
  <p class="muted small full">{t('admin.smtp.hint')}</p>
  <TextField
    label={t('admin.smtp.host')}
    name="smtp.host"
    bind:value={values['smtp.host']}
    error={form.message('smtp.host')}
  />
  <TextField
    label={t('admin.smtp.port')}
    name="smtp.port"
    inputmode="numeric"
    bind:value={values['smtp.port']}
    error={form.message('smtp.port')}
  />
  <SelectField
    label={t('admin.smtp.encryption')}
    name="smtp.encryption"
    bind:value={values['smtp.encryption']}
    options={encryptions}
    error={form.message('smtp.encryption')}
  />
  <TextField
    label={t('admin.smtp.username')}
    name="smtp.username"
    autocomplete="off"
    bind:value={values['smtp.username']}
    error={form.message('smtp.username')}
  />
  <TextField
    label={t('admin.smtp.password')}
    name="smtp.password"
    type="password"
    autocomplete="new-password"
    bind:value={password}
    error={form.message('smtp.password')}
    hint={passwordSet ? t('admin.smtp.password_set') : t('admin.smtp.password_unset')}
  />
  <TextField
    label={t('admin.smtp.from_email')}
    name="smtp.from_email"
    type="email"
    bind:value={values['smtp.from_email']}
    error={form.message('smtp.from_email')}
  />
  <TextField
    label={t('admin.smtp.from_name')}
    name="smtp.from_name"
    bind:value={values['smtp.from_name']}
    error={form.message('smtp.from_name')}
  />

  <div class="full stack test">
    <div class="row end">
      <TextField
        label={t('admin.smtp.test_to')}
        type="email"
        bind:value={to}
        hint={t('admin.smtp.test_hint')}
      />
      <Button loading={testing} disabled={to.trim() === ''} onclick={sendTest}
        >{t('admin.smtp.test')}</Button
      >
    </div>
    {#if result}
      <div role="status" class={['alert', result.sent ? 'alert-success' : 'alert-error']}>
        <p>{result.sent ? t('admin.smtp.test_sent') : t('admin.smtp.test_failed')}</p>
        {#if result.log.length > 0}<pre>{result.log.join('\n')}</pre>{/if}
      </div>
    {/if}
  </div>
</fieldset>

<style>
  fieldset {
    margin: 0;
  }
  legend {
    padding: 0 var(--space-2);
    font-weight: var(--font-weight-bold);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
    gap: var(--space-4);
    align-items: start;
  }
  .full {
    grid-column: 1 / -1;
    margin: 0;
  }
  .end {
    align-items: flex-end;
  }
  .test {
    padding-top: var(--space-4);
    border-top: var(--border-width) solid var(--color-border);
  }
  pre {
    margin: var(--space-2) 0 0;
    max-height: 16rem;
    overflow: auto;
    font-size: var(--font-size-xs);
    white-space: pre-wrap;
  }
  p {
    margin: 0;
  }
</style>
