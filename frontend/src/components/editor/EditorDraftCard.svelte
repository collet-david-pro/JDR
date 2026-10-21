<script lang="ts">
  import { t } from '../../lib/i18n';
  import { href } from '../../lib/services';

  /** Maps tab of the game page until P4b: opens the editor on a local draft map. */
  interface Props {
    gameId: string;
  }

  let { gameId }: Props = $props();
</script>

<section class="draft">
  <h2>{t('games.maps.draft_title')}</h2>
  <p class="muted">{t('games.maps.draft_text')}</p>
  <p>
    <a
      class="button button-primary"
      href={href(`/games/${gameId}/maps/local/edit`)}
      data-testid="open-editor">{t('games.maps.open_editor')}</a
    >
  </p>
</section>

<style>
  .draft {
    padding: var(--space-6) var(--space-4);
    text-align: center;
    border: var(--border-width) dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-lg);
  }
  p {
    margin: 0 0 var(--space-3);
  }
  .button {
    text-decoration: none;
  }
</style>
