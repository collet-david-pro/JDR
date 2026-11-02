<script lang="ts">
  import MarkdownView from '../MarkdownView.svelte';

  let { notes }: { notes: string | null } = $props();
</script>

<MarkdownView source={notes} maxHeight="18rem" />
