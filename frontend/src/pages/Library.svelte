<script lang="ts">
  import PagePlaceholder from '../components/PagePlaceholder.svelte';
  import type { PageProps } from '../lib/page';

  let { params }: PageProps = $props();
</script>

<!-- Provisional page: delivered in phase P2. -->
<PagePlaceholder titleKey="pages.library.title" phase="P2" {params} />
