<script lang="ts">
  import PagePlaceholder from '../components/PagePlaceholder.svelte';
  import type { PageProps } from '../lib/page';

  let { params }: PageProps = $props();
</script>

<!-- Provisional page: delivered in phase P3. -->
<PagePlaceholder titleKey="pages.game.title" phase="P3" {params} />
