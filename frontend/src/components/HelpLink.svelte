<script lang="ts">
  /**
   * Small "?" link to a section of the help (P13-2). Opens the help in a new tab so that a
   * session, an editor or a form is never left by mistake.
   */
  import { t } from '../lib/i18n';
  import { helpPath } from '../lib/help/links';
  import { href } from '../lib/services';

  interface Props {
    /** Anchor of the help section (`mj-creer-une-map`). */
    anchor: string;
    /** Accessible name; default "Aide sur cette page". */
    label?: string;
  }

  let { anchor, label }: Props = $props();
  const name = $derived(label ?? t('help.link.label'));
</script>

<a
  class="help-link"
  href={href(helpPath(anchor))}
  target="_blank"
  rel="noopener"
  aria-label={name}
  title={name}
  data-testid="help-link"
  data-help-anchor={anchor}><span aria-hidden="true">?</span></a
>

<style>
  .help-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 1.5rem;
    block-size: 1.5rem;
    flex: none;
    border: var(--border-width) solid var(--color-border-strong, var(--color-border));
    border-radius: 50%;
    background: var(--color-surface);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-bold);
    line-height: 1;
    text-decoration: none;
    vertical-align: middle;
  }
  .help-link:hover {
    background: var(--color-primary-soft);
    color: var(--color-primary);
  }
</style>
