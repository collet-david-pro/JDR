<script lang="ts">
  import { t } from '../../lib/i18n';
  import { href } from '../../lib/services';

  /** The player was removed from the session. */
  interface Props {
    gameId: string;
  }
  let { gameId }: Props = $props();
</script>

<section class="card stack notice" role="alert" data-testid="play-kicked">
  <h1>{t('play.kicked.title')}</h1>
  <p class="muted">{t('play.kicked.text')}</p>
  <p><a class="button" href={href('/')}>{t('play.kicked.home')}</a></p>
  <p>
    <a href={href(`/games/${encodeURIComponent(gameId)}`)}>{t('sessions.player.back')}</a>
  </p>
</section>

<style>
  .notice {
    max-width: 32rem;
    margin: var(--space-6) auto;
  }
</style>
