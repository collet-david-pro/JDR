<script lang="ts">
  import PagePlaceholder from '../../components/PagePlaceholder.svelte';
  import type { PageProps } from '../../lib/page';

  let { params }: PageProps = $props();
</script>

<!-- Provisional page: delivered in phase P1. -->
<PagePlaceholder titleKey="pages.admin.title" phase="P1" {params} />
