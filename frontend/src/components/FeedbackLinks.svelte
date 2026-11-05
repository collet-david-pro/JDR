<script lang="ts">
  /** Two links (problem / idea) to a pre-filled GitHub issue form, in a new tab. Hidden when the administrator cleared the repository. */
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n';
  import { feedbackUrl } from '../lib/feedback';
  import { services } from '../lib/services';

  let { class: className = '' }: { class?: string } = $props();

  const { boot, router } = services();
  let pattern = $state<string | null>(router.state.match?.route.path ?? null);

  onMount(() =>
    router.subscribe((state) => {
      pattern = state.match?.route.path ?? null;
    }),
  );

  function url(kind: 'bug' | 'idea'): string | null {
    return feedbackUrl({
      repo: boot.feedbackUrl,
      kind,
      version: boot.version,
      userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      pattern,
    });
  }

  const bug = $derived(url('bug'));
  const idea = $derived(url('idea'));
</script>

{#if bug !== null && idea !== null}
  <span class={className} data-testid="feedback-links">
    <a href={bug} target="_blank" rel="noopener noreferrer" data-testid="feedback-bug"
      >{t('feedback.bug')}</a
    >
    <a href={idea} target="_blank" rel="noopener noreferrer" data-testid="feedback-idea"
      >{t('feedback.idea')}</a
    >
  </span>
{/if}

<style>
  span {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
  }
</style>
