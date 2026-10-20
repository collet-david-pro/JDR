<script lang="ts">
  import PagePlaceholder from '../components/PagePlaceholder.svelte';
  import type { PageProps } from '../lib/page';

  let { params }: PageProps = $props();
</script>

<!-- Provisional page: delivered in phase P6. -->
<PagePlaceholder titleKey="pages.join.title" phase="P6" {params} />
