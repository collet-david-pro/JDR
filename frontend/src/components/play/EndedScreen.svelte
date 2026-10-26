<script lang="ts">
  import { t } from '../../lib/i18n';
  import { href } from '../../lib/services';

  /** The session is over. */
  interface Props {
    gameId: string;
    name: string;
  }
  let { gameId, name }: Props = $props();
</script>

<section class="card stack notice" data-testid="play-ended">
  <h1>{name}</h1>
  <p>{t('play.ended.title')}</p>
  <p>
    <a class="button" href={href(`/games/${encodeURIComponent(gameId)}`)}
      >{t('sessions.player.back')}</a
    >
  </p>
</section>

<style>
  .notice {
    max-width: 32rem;
    margin: var(--space-6) auto;
  }
</style>
