<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../../components/Button.svelte';
  import CheckboxField from '../../components/CheckboxField.svelte';
  import ErrorAlert from '../../components/ErrorAlert.svelte';
  import SelectField from '../../components/SelectField.svelte';
  import TextField from '../../components/TextField.svelte';
  import { describeError, type ErrorSummary } from '../../lib/errors';
  import { FormState } from '../../lib/form.svelte';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import {
    INT_KEYS,
    buildSettingsPatch,
    toFormValues,
    validateSettings,
    type SettingsFormValues,
  } from '../../lib/settings-form';
  import type { SiteSettings } from '../../lib/types';
  import { toasts } from '../../stores/toasts.svelte';
  import SmtpSettings from './SmtpSettings.svelte';

  const { api } = services();
  const form = new FormState();
  let formEl: HTMLFormElement | undefined = $state();
  let original = $state.raw<SiteSettings | null>(null);
  let values = $state<SettingsFormValues | null>(null);
  let loadFailure = $state.raw<ErrorSummary | null>(null);

  const modes = [
    { value: 'open', label: t('admin.settings.registration_open') },
    { value: 'invite', label: t('admin.settings.registration_invite') },
    { value: 'closed', label: t('admin.settings.registration_closed') },
  ];
  const locales = [{ value: 'fr', label: t('profile.info.locales.fr') }];

  function loaded(settings: SiteSettings): void {
    original = settings;
    values = toFormValues(settings);
  }

  onMount(() => {
    api
      .get<{ settings: SiteSettings }>('/admin/settings')
      .then(({ data }) => loaded(data.settings))
      .catch((error: unknown) => {
        loadFailure = describeError(error, t);
      });
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const current = values;
    const base = original;
    if (current === null || base === null) return;
    const ok = await form.submit(
      async () => {
        const patch = buildSettingsPatch(base, current);
        if (Object.keys(patch).length === 0) return;
        const { data } = await api.patch<{ settings: SiteSettings }>('/admin/settings', patch);
        loaded(data.settings);
      },
      { validate: () => validateSettings(current), form: formEl },
    );
    if (ok) toasts.success(t('admin.settings.saved'));
  }
</script>

<ErrorAlert failure={loadFailure} />
{#if values === null && loadFailure === null}
  <p class="muted" aria-busy="true">{t('common.loading')}</p>
{:else if values !== null && original !== null}
  <form class="stack" bind:this={formEl} onsubmit={submit} novalidate>
    <ErrorAlert failure={form.failure} />
    <fieldset class="card grid">
      <legend>{t('admin.settings.general')}</legend>
      <TextField
        label={t('admin.settings.site_name')}
        name="site_name"
        bind:value={values.values['site_name']}
        error={form.message('site_name')}
        required
      />
      <TextField
        label={t('admin.settings.base_url')}
        name="base_url"
        type="url"
        bind:value={values.values['base_url']}
        error={form.message('base_url')}
        required
      />
      <SelectField
        label={t('admin.settings.default_locale')}
        name="default_locale"
        bind:value={values.values['default_locale']}
        options={locales}
      />
      <SelectField
        label={t('admin.settings.registration_mode')}
        name="registration_mode"
        bind:value={values.values['registration_mode']}
        options={modes}
        error={form.message('registration_mode')}
      />
      <CheckboxField
        label={t('admin.settings.maintenance')}
        hint={t('admin.settings.maintenance_hint')}
        bind:checked={values.flags.maintenance}
      />
      <CheckboxField
        label={t('admin.settings.use_db_sessions')}
        hint={t('admin.settings.use_db_sessions_hint')}
        bind:checked={values.flags.use_db_sessions}
      />
    </fieldset>

    <fieldset class="card grid">
      <legend>{t('admin.settings.limits')}</legend>
      <TextField
        label={t('admin.settings.default_quota_mb')}
        name="default_quota_bytes"
        inputmode="decimal"
        bind:value={values.values['default_quota_bytes']}
        error={form.message('default_quota_bytes')}
        required
      />
      <TextField
        label={t('admin.settings.max_upload_mb')}
        name="max_upload_bytes"
        inputmode="decimal"
        bind:value={values.values['max_upload_bytes']}
        error={form.message('max_upload_bytes')}
        required
      />
      {#each INT_KEYS as key (key)}
        <TextField
          label={t(`admin.settings.fields.${key}`)}
          name={key}
          inputmode="numeric"
          bind:value={values.values[key]}
          error={form.message(key)}
          required
        />
      {/each}
    </fieldset>

    <SmtpSettings
      bind:values={values.values}
      bind:password={values.smtpPassword}
      passwordSet={original.smtp.password_set}
      {form}
    />

    <div>
      <Button type="submit" variant="primary" loading={form.submitting}>{t('common.save')}</Button>
    </div>
  </form>
{/if}

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
</style>
