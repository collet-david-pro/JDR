<script lang="ts">
  interface Props {
    title: string;
    text: string;
  }

  let { title, text }: Props = $props();
</script>

<section class="empty">
  <h2>{title}</h2>
  <p class="muted">{text}</p>
</section>

<style>
  .empty {
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
    margin: 0;
  }
</style>
