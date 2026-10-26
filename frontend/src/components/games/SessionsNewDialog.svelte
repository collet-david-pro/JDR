<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../Button.svelte';
  import ErrorAlert from '../ErrorAlert.svelte';
  import Modal from '../Modal.svelte';
  import SelectField, { type SelectOption } from '../SelectField.svelte';
  import TextField from '../TextField.svelte';
  import { FormState } from '../../lib/form.svelte';
  import { t } from '../../lib/i18n';
  import { mapsClient } from '../../lib/maps/service';
  import { classifySessionError, type Session, type SessionInput } from '../../lib/sessions';

  /** "Nouvelle séance": optional name and starting map. */
  interface Props {
    open: boolean;
    gameId: string;
    oncreate: (input: SessionInput) => Promise<Session>;
    oncreated: (session: Session) => void;
    /** 409 session_exists: the open session of the game. */
    onexists: (sessionId: string | null) => void;
  }

  let { open = $bindable(), gameId, oncreate, oncreated, onexists }: Props = $props();

  let name = $state('');
  let mapId = $state('');
  let options = $state.raw<readonly SelectOption[]>([]);
  const form = new FormState();

  $effect(() => {
    if (open) {
      name = '';
      form.reset();
    }
  });

  onMount(() => {
    mapsClient()
      .list(gameId)
      .then((maps) => {
        options = [
          { value: '', label: t('sessions.new.no_map') },
          ...maps.map((m) => ({ value: m.id, label: m.name })),
        ];
        mapId = maps[0]?.id ?? '';
      })
      .catch(() => {
        options = [{ value: '', label: t('sessions.new.no_map') }];
      });
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const result: { session: Session | null } = { session: null };
    const ok = await form.submit(async () => {
      const input: SessionInput = {
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        ...(mapId === '' ? {} : { map_id: mapId }),
      };
      try {
        result.session = await oncreate(input);
      } catch (error) {
        const info = classifySessionError(error);
        if (info?.code === 'session_exists') {
          open = false;
          onexists(info.sessionId);
          return;
        }
        throw error;
      }
    });
    if (ok && result.session !== null) {
      open = false;
      oncreated(result.session);
    }
  }
</script>

<Modal bind:open title={t('sessions.new.title')}>
  <form class="stack" novalidate onsubmit={submit} data-testid="new-session-form">
    <TextField
      label={t('sessions.new.name')}
      name="name"
      bind:value={name}
      maxlength={120}
      autocomplete="off"
      hint={t('sessions.new.name_hint')}
    />
    <SelectField label={t('sessions.new.map')} bind:value={mapId} {options} />
    <ErrorAlert failure={form.failure} />
    <div class="row actions">
      <button type="button" class="button" onclick={() => (open = false)}>
        {t('common.cancel')}
      </button>
      <Button
        type="submit"
        variant="primary"
        loading={form.submitting}
        data-testid="new-session-submit"
      >
        {t('sessions.new.submit')}
      </Button>
    </div>
  </form>
</Modal>

<style>
  .actions {
    justify-content: flex-end;
  }
</style>
