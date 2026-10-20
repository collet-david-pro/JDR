<script lang="ts">
  import PagePlaceholder from '../components/PagePlaceholder.svelte';
  import type { PageProps } from '../lib/page';

  let { params }: PageProps = $props();
</script>

<!-- Provisional page: delivered in phase P4. -->
<PagePlaceholder titleKey="pages.editor.title" phase="P4" {params} />
