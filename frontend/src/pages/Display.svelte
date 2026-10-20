<script lang="ts">
  import PagePlaceholder from '../components/PagePlaceholder.svelte';
  import type { PageProps } from '../lib/page';

  let { params }: PageProps = $props();
</script>

<!-- Provisional page: delivered in phase P7. -->
<PagePlaceholder titleKey="pages.display.title" phase="P7" {params} />
