<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { PauseScreen } from '../../lib/sessions';

  /**
   * Full-page pause screen: the GM's text, else "Séance en pause". The image of the pause screen
   * (`asset_id`) has no signed URL for a player yet: text only (debt, see the P6f report).
   */
  interface Props {
    screen: PauseScreen | null;
    name: string;
    onleave: () => void;
  }
  let { screen, name, onleave }: Props = $props();
  const text = $derived(
    screen?.text !== null && screen?.text !== undefined && screen.text.trim() !== ''
      ? screen.text
      : t('play.pause.title'),
  );
</script>

<section class="pause" data-testid="play-pause" role="status" aria-live="polite">
  <p class="name muted">{name}</p>
  <h1>{text}</h1>
  <p class="muted">{t('play.pause.hint')}</p>
  <button type="button" class="button button-ghost" onclick={onleave}>{t('play.leave')}</button>
</section>

<style>
  .pause {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
    text-align: center;
    background: var(--color-bg);
    color: var(--color-text);
  }
  h1 {
    margin: 0;
    max-width: 40rem;
    white-space: pre-line;
  }
  p {
    margin: 0;
  }
</style>
