<script lang="ts">
  import LibraryView from '../components/library/LibraryView.svelte';
  import type { PageProps } from '../lib/page';

  let _props: PageProps = $props();
</script>

<!-- Asset library (projet.md 18.1 p.10), loaded on demand. -->
<LibraryView />
