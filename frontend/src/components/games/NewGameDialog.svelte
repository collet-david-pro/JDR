<script lang="ts">
  import Button from '../Button.svelte';
  import ErrorAlert from '../ErrorAlert.svelte';
  import Modal from '../Modal.svelte';
  import TextAreaField from '../TextAreaField.svelte';
  import TextField from '../TextField.svelte';
  import { FormState } from '../../lib/form.svelte';
  import { checkDescription, checkGameName, GAME_NAME_MAX } from '../../lib/games/game-form';
  import { t } from '../../lib/i18n';
  import type { Game, GameInput } from '../../lib/types';
  import { collectErrors } from '../../lib/validation';

  interface Props {
    open: boolean;
    oncreate: (input: GameInput) => Promise<Game>;
    oncreated: (game: Game) => void;
  }

  let { open = $bindable(), oncreate, oncreated }: Props = $props();

  let name = $state('');
  let description = $state('');
  let formEl: HTMLFormElement | undefined = $state();
  const form = new FormState();

  // Fresh form at each opening.
  $effect(() => {
    if (open) {
      name = '';
      description = '';
      form.reset();
    }
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const result: { game: Game | null } = { game: null };
    const ok = await form.submit(
      async () => {
        const input: GameInput =
          description.trim() === ''
            ? { name: name.trim() }
            : { name: name.trim(), description: description.trim() };
        result.game = await oncreate(input);
      },
      {
        form: formEl,
        validate: () =>
          collectErrors({ name: checkGameName(name), description: checkDescription(description) }),
      },
    );
    if (ok && result.game !== null) {
      open = false;
      oncreated(result.game);
    }
  }
</script>

<Modal bind:open title={t('games.create.title')}>
  <form class="stack" novalidate bind:this={formEl} onsubmit={submit}>
    <TextField
      label={t('games.fields.name')}
      name="name"
      bind:value={name}
      required
      maxlength={GAME_NAME_MAX}
      autocomplete="off"
      error={form.message('name')}
    />
    <TextAreaField
      label={t('games.fields.description')}
      name="description"
      bind:value={description}
      hint={t('games.fields.description_hint')}
      error={form.message('description')}
    />
    <ErrorAlert failure={form.failure} />
    <div class="row actions">
      <button type="button" class="button" onclick={() => (open = false)}>
        {t('common.cancel')}
      </button>
      <Button type="submit" variant="primary" loading={form.submitting}>
        {t('games.create.submit')}
      </Button>
    </div>
  </form>
</Modal>

<style>
  .actions {
    justify-content: flex-end;
  }
</style>
