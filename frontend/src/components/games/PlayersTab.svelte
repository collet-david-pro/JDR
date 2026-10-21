<script lang="ts">
  import Button from '../Button.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import ErrorAlert from '../ErrorAlert.svelte';
  import SelectField from '../SelectField.svelte';
  import TextField from '../TextField.svelte';
  import { FormState } from '../../lib/form.svelte';
  import type { GamePageModel } from '../../lib/games/game-page.svelte';
  import { roleLabel } from '../../lib/games/labels';
  import { canManageGame, membersWithGm } from '../../lib/games/roles';
  import { formatDateTime } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import type { Member, MemberRole } from '../../lib/types';
  import { checkRequired, collectErrors } from '../../lib/validation';
  import { toasts } from '../../stores/toasts.svelte';

  /** Members of the game (projet.md 2.2): GM-only management, read-only for the co-GM. */
  interface Props {
    model: GamePageModel;
  }

  let { model }: Props = $props();

  const manage = $derived(canManageGame(model.role));
  const members = $derived(model.game ? membersWithGm(model.members, model.game.gm) : []);
  const roleOptions = [
    { value: 'player', label: roleLabel('player') },
    { value: 'co_gm', label: roleLabel('co_gm') },
  ];

  let identifier = $state('');
  let newRole = $state<string>('player');
  let formEl: HTMLFormElement | undefined = $state();
  const form = new FormState();

  let removing = $state.raw<Member | null>(null);
  let confirmOpen = $state(false);
  let busy = $state(false);

  const asRole = (value: string): MemberRole => (value === 'co_gm' ? 'co_gm' : 'player');

  async function add(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const ok = await form.submit(
      async () => {
        const member = await model.addMember(identifier.trim(), asRole(newRole));
        toasts.success(t('games.players.added', { name: member.user.username }));
      },
      { form: formEl, validate: () => collectErrors({ identifier: checkRequired(identifier) }) },
    );
    if (ok) identifier = '';
  }

  async function changeRole(member: Member, value: string): Promise<void> {
    try {
      await model.setRole(member.user.id, asRole(value));
    } catch (error) {
      // The select went back to the previous role (optimistic rollback).
      toasts.error(error);
    }
  }

  function askRemove(member: Member): void {
    removing = member;
    confirmOpen = true;
  }

  async function remove(): Promise<void> {
    const member = removing;
    if (member === null) return;
    busy = true;
    try {
      await model.removeMember(member.user.id);
      confirmOpen = false;
      toasts.success(t('games.players.removed', { name: member.user.username }));
    } catch (error) {
      toasts.error(error);
    } finally {
      busy = false;
    }
  }
</script>

<section class="stack">
  <h2 class="visually-hidden">{t('games.tabs.players')}</h2>

  {#if manage}
    <form class="card add" novalidate bind:this={formEl} onsubmit={add}>
      <h3>{t('games.players.add_title')}</h3>
      <div class="row fields">
        <TextField
          label={t('games.players.identifier')}
          name="identifier"
          bind:value={identifier}
          autocomplete="off"
          hint={t('games.players.identifier_hint')}
          error={form.message('identifier')}
        />
        <SelectField label={t('games.players.role')} bind:value={newRole} options={roleOptions} />
        <Button type="submit" variant="primary" loading={form.submitting}>
          {t('games.players.add')}
        </Button>
      </div>
      <ErrorAlert failure={form.failure} />
    </form>
  {:else}
    <p class="small muted">{t('games.players.read_only')}</p>
  {/if}

  {#if !model.listsLoaded}
    <p class="muted" aria-busy="true">{t('common.loading')}</p>
  {:else}
    <div class="table-wrap">
      <table class="table">
        <caption class="visually-hidden">{t('games.players.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('games.players.user')}</th>
            <th scope="col">{t('games.players.role')}</th>
            <th scope="col">{t('games.players.joined_at')}</th>
            {#if manage}<th scope="col">{t('common.actions')}</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each members as member (member.user.id)}
            <tr>
              <th scope="row">{member.user.username}</th>
              <td>
                {#if manage && member.role !== 'gm'}
                  <label class="visually-hidden" for={`role-${member.user.id}`}>
                    {t('games.players.role_of', { name: member.user.username })}
                  </label>
                  <select
                    id={`role-${member.user.id}`}
                    value={member.role}
                    onchange={(event) => changeRole(member, event.currentTarget.value)}
                  >
                    {#each roleOptions as option (option.value)}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                {:else}
                  {roleLabel(member.role)}
                {/if}
              </td>
              <td>{formatDateTime(member.joined_at)}</td>
              {#if manage}
                <td>
                  {#if member.role !== 'gm'}
                    <button
                      type="button"
                      class="button button-small"
                      onclick={() => askRemove(member)}
                      aria-label={t('games.players.remove_named', { name: member.user.username })}
                    >
                      {t('games.players.remove')}
                    </button>
                  {/if}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if members.length <= 1}
      <p class="small muted">{t('games.players.empty')}</p>
    {/if}
  {/if}
</section>

<ConfirmDialog
  bind:open={confirmOpen}
  title={t('games.players.remove_title')}
  message={t('games.players.remove_text', { name: removing?.user.username ?? '' })}
  confirmLabel={t('games.players.remove')}
  danger
  {busy}
  onconfirm={remove}
/>

<style>
  .add {
    display: grid;
    gap: var(--space-3);
  }
  .add h3 {
    margin: 0;
    font-size: var(--font-size-md);
  }
  .fields {
    align-items: flex-start;
  }
  .fields > :global(.field:first-child) {
    flex: 2 1 14rem;
  }
  .fields > :global(.field) {
    flex: 1 1 9rem;
  }
  .fields > :global(.button) {
    margin-top: 1.75rem;
  }
  select {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface-raised);
  }
  p {
    margin: 0;
  }
</style>
