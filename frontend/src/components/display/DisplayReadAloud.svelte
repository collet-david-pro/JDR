<script lang="ts">
  /** Text read aloud by the GM, readable from afar, above the map. No control. */
  interface Props {
    title: string;
    body: string;
  }
  let { title, body }: Props = $props();
</script>

<div class="overlay" data-testid="display-read-aloud" role="status">
  <article>
    {#if title !== ''}<h2>{title}</h2>{/if}
    <p>{body}</p>
  </article>
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4vmin;
    background: rgb(0 0 0 / 0.72);
  }
  article {
    max-width: 90%;
    max-height: 100%;
    overflow: hidden;
    text-align: center;
    color: #fff;
  }
  h2 {
    margin: 0 0 0.5em;
    font-size: clamp(2rem, 7vmin, 5rem);
  }
  p {
    margin: 0;
    font-size: clamp(1.5rem, 5vmin, 3.5rem);
    line-height: 1.35;
    white-space: pre-wrap;
  }
</style>
