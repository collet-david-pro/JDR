<script lang="ts">
  import { t } from '../../lib/i18n';

  /** Pause screen: neutral dark background, the GM's image and text. */
  interface Props {
    url: string | null;
    text: string;
  }
  let { url, text }: Props = $props();
</script>

<div class="pause" data-testid="display-pause">
  {#if url !== null}
    <img src={url} alt="" data-testid="display-pause-image" />
  {/if}
  <p class="text">{text.trim() === '' ? t('display.pause.default') : text}</p>
</div>

<style>
  .pause {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #14161c;
  }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .text {
    position: relative;
    margin: 0;
    padding: 0.75rem 1.5rem;
    max-width: 80%;
    text-align: center;
    font-size: clamp(2rem, 7vmin, 5rem);
    background: rgb(0 0 0 / 0.55);
    border-radius: 0.75rem;
    text-shadow: 0 2px 8px #000;
  }
</style>
