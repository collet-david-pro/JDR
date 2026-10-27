<script lang="ts">
  import DisplayScreen from '../components/display/DisplayScreen.svelte';
  import type { PageProps } from '../lib/page';

  /** Public projection screen (no account): pairing, then the table view of the session. */
  let { query }: PageProps = $props();
</script>

<DisplayScreen {query} />
