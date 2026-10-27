<script lang="ts">
  import { untrack } from 'svelte';
  import DisplayPairing from './DisplayPairing.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import SelectField from '../SelectField.svelte';
  import TextField from '../TextField.svelte';
  import { ApiError } from '../../lib/api';
  import type { DisplayInfo, PairingInfo, ViewLock } from '../../lib/displays/types';
  import { t } from '../../lib/i18n';
  import {
    formFromDisplay,
    patchFromForm,
    seenAgo,
    shortUserAgent,
    type FormErrors,
    type SettingsForm,
  } from '../../lib/sessions/console/displays-logic';
  import type { DisplaysModel } from '../../lib/sessions/console/displays.svelte';
  import { sessionProblem } from '../../lib/sessions/labels';
  import { toasts } from '../../stores/toasts.svelte';

  /** One projection screen: presence, pairing code (pending), settings, view lock, revocation. */
  interface Props {
    display: DisplayInfo;
    pairing: PairingInfo | null;
    model: DisplaysModel;
    currentView: () => ViewLock | null;
  }

  let { display, pairing, model, currentView }: Props = $props();
  const id = $derived(display.id);
  // svelte-ignore state_referenced_locally
  let form = $state<SettingsForm>(formFromDisplay(display));
  let errors = $state<FormErrors>({});
  let serverErrors = $state<Record<string, string>>({});
  let busy = $state(false);
  let revokeOpen = $state(false);
  let now = $state(Date.now());

  // The form follows the screen when it changes elsewhere (event, other save).
  const key = $derived(JSON.stringify([display.name, display.settings]));
  $effect(() => {
    void key;
    untrack(() => {
      form = formFromDisplay(display);
      errors = {};
      serverErrors = {};
    });
  });
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 5000);
    return () => clearInterval(timer);
  });

  const ago = $derived(seenAgo(display.last_seen_at, now));
  const agoLabel = $derived(
    ago.kind === 'never'
      ? t('sessions.displays.seen_never')
      : ago.kind === 'now'
        ? t('sessions.displays.seen_now')
        : ago.kind === 'seconds'
          ? t('sessions.displays.seen_seconds', { n: ago.n })
          : ago.kind === 'minutes'
            ? t('sessions.displays.seen_minutes', { n: ago.n })
            : ago.kind === 'hours'
              ? t('sessions.displays.seen_hours', { n: ago.n })
              : t('sessions.displays.seen_days', { n: ago.n }),
  );
  const fieldError = (
    name: string,
    local: 'name' | 'diagonal_in' | 'mm_per_cell',
  ): string | null =>
    errors[local] !== undefined || serverErrors[name] !== undefined
      ? t('sessions.displays.invalid_field')
      : null;
  const rotations = [0, 90, 180, 270].map((r) => ({ value: String(r), label: `${r}°` }));

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    busy = true;
    serverErrors = {};
    try {
      await action();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        serverErrors = { ...error.fields };
        toasts.show('error', t('sessions.displays.invalid_field'));
      } else {
        toasts.show('error', sessionProblem(error));
      }
      return false;
    } finally {
      busy = false;
    }
  }

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    const result = patchFromForm(form);
    if ('errors' in result) {
      errors = result.errors;
      return;
    }
    errors = {};
    if (await run(() => model.save(id, result.patch))) toasts.success(t('sessions.displays.saved'));
  }

  async function lock(): Promise<void> {
    const view = currentView();
    if (view === null) return;
    await run(() => model.save(id, { settings: { view_lock: view } }));
  }
</script>

<li
  class="item"
  data-testid={`display-item-${id}`}
  data-state={display.state}
  data-online={display.online ? 'true' : 'false'}
>
  <div class="head">
    <span
      class="dot"
      class:on={display.online}
      title={shortUserAgent(display.user_agent)}
      role="img"
      aria-label={display.online ? t('sessions.displays.online') : t('sessions.displays.offline')}
    ></span>
    <strong class="name">{display.name}</strong>
    <span class="badge" data-testid={`display-state-${id}`}
      >{display.state === 'active'
        ? t('sessions.displays.state_active')
        : t('sessions.displays.state_pending')}</span
    >
  </div>
  {#if display.state === 'active'}
    <p class="small muted" title={shortUserAgent(display.user_agent)}>
      {display.online ? t('sessions.displays.online') : t('sessions.displays.offline')} · {agoLabel}
    </p>
  {:else}
    <DisplayPairing {id} {pairing} {busy} onnew={() => void run(() => model.newCode(id))} />
  {/if}

  <form class="settings" onsubmit={save} novalidate>
    <TextField
      label={t('sessions.displays.name')}
      bind:value={form.name}
      maxlength={60}
      error={fieldError('name', 'name')}
      data-testid={`display-name-${id}`}
    />
    <TextField
      label={t('sessions.displays.diagonal')}
      bind:value={form.diagonal}
      inputmode="decimal"
      hint={t('sessions.displays.diagonal_hint')}
      error={fieldError('settings.diagonal_in', 'diagonal_in')}
      data-testid={`display-diagonal-${id}`}
    />
    <TextField
      label={t('sessions.displays.mm_per_cell')}
      bind:value={form.mm}
      inputmode="decimal"
      error={fieldError('settings.mm_per_cell', 'mm_per_cell')}
      data-testid={`display-mm-${id}`}
    />
    <SelectField
      label={t('sessions.displays.rotation')}
      bind:value={form.rotation}
      options={rotations}
      data-testid={`display-rotation-${id}`}
    />
    <label class="check small">
      <input type="checkbox" bind:checked={form.mirror} data-testid={`display-mirror-${id}`} />
      {t('sessions.displays.mirror')}
    </label>
    <label class="check small">
      <input type="checkbox" bind:checked={form.tokens} data-testid={`display-tokens-${id}`} />
      {t('sessions.displays.show_tokens')}
    </label>
    <label class="check small">
      <input type="checkbox" bind:checked={form.follow} data-testid={`display-follow-${id}`} />
      {t('sessions.displays.follow_camera')}
    </label>
    <button
      type="submit"
      class="button button-primary button-small"
      disabled={busy}
      data-testid={`display-save-${id}`}>{t('common.save')}</button
    >
  </form>

  <div class="row small">
    {#if display.settings.px_per_mm !== null}
      <span data-testid={`display-calibration-${id}`}
        >{t('sessions.displays.calibration', {
          value: display.settings.px_per_mm.toFixed(2),
        })}</span
      >
      <button
        type="button"
        class="button button-small"
        disabled={busy}
        data-testid={`display-clear-cal-${id}`}
        onclick={() => void run(() => model.save(id, { settings: { px_per_mm: null } }))}
        >{t('sessions.displays.clear_calibration')}</button
      >
    {:else}
      <span class="muted">{t('sessions.displays.not_calibrated')}</span>
    {/if}
  </div>

  <div class="row small">
    <span class="muted" data-testid={`display-lock-state-${id}`}
      >{display.settings.view_lock === null
        ? t('sessions.displays.view_free')
        : t('sessions.displays.view_locked')}</span
    >
    <button
      type="button"
      class="button button-small"
      disabled={busy}
      data-testid={`display-lock-${id}`}
      onclick={lock}>{t('sessions.displays.lock_here')}</button
    >
    {#if display.settings.view_lock !== null}
      <button
        type="button"
        class="button button-small"
        disabled={busy}
        data-testid={`display-unlock-${id}`}
        onclick={() => void run(() => model.save(id, { settings: { view_lock: null } }))}
        >{t('sessions.displays.unlock')}</button
      >
    {/if}
  </div>

  <button
    type="button"
    class="button button-danger button-small"
    disabled={busy}
    data-testid={`display-revoke-${id}`}
    onclick={() => (revokeOpen = true)}>{t('sessions.displays.revoke')}</button
  >
</li>

<ConfirmDialog
  bind:open={revokeOpen}
  title={t('sessions.displays.revoke_title')}
  message={t('sessions.displays.revoke_text', { name: display.name })}
  confirmLabel={t('sessions.displays.revoke')}
  danger
  {busy}
  confirmTestId={`display-revoke-confirm-${id}`}
  onconfirm={async () => {
    if (await run(() => model.revoke(id))) revokeOpen = false;
  }}
/>

<style>
  .item {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    list-style: none;
  }
  .head {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .dot {
    flex: none;
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    background: var(--color-border-strong);
  }
  .dot.on {
    background: var(--color-success, #2a9d4a);
  }
  .settings {
    display: grid;
    gap: var(--space-2);
  }
  .check {
    display: flex;
    gap: var(--space-1);
    align-items: center;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  p {
    margin: 0;
  }
</style>
