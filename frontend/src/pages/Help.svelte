<script lang="ts">
  /**
   * Built-in help (P13-2), public: every feature by audience (player, GM, in-person screen,
   * administrator), a table of contents, a full-text search and the keyboard shortcuts read
   * from the real binding table. Loaded on demand (route `/aide`).
   */
  import { onMount, tick } from 'svelte';
  import { detectPlatform } from '../editor/shortcuts';
  import { AUDIENCES, sectionsOf, type Audience, type HelpSection } from '../lib/help/catalog';
  import { helpImageUrl, helpSections } from '../lib/help/content';
  import { helpPath, requestedAnchor } from '../lib/help/links';
  import type { HelpRun } from '../lib/help/markdown';
  import { searchHelp } from '../lib/help/search';
  import { shortcutRows } from '../lib/help/shortcuts';
  import { t } from '../lib/i18n';
  import type { PageProps } from '../lib/page';
  import { href } from '../lib/services';

  let { query }: PageProps = $props();

  const audienceLabel = (audience: Audience): string => {
    switch (audience) {
      case 'joueur':
        return t('help.publics.joueur.title');
      case 'mj':
        return t('help.publics.mj.title');
      case 'irl':
        return t('help.publics.irl.title');
      case 'admin':
        return t('help.publics.admin.title');
    }
  };
  const audienceIntro = (audience: Audience): string => {
    switch (audience) {
      case 'joueur':
        return t('help.publics.joueur.intro');
      case 'mj':
        return t('help.publics.mj.intro');
      case 'irl':
        return t('help.publics.irl.intro');
      case 'admin':
        return t('help.publics.admin.intro');
    }
  };

  const platform = detectPlatform(navigator);
  const shortcuts = shortcutRows(platform);
  const groups = AUDIENCES.map((audience) => ({
    audience,
    sections: sectionsOf(helpSections, audience),
  }));

  let search = $state('');
  let tocOpen = $state(true);
  let page: HTMLElement | undefined = $state();
  const hits = $derived(searchHelp(helpSections, search));
  const searching = $derived(search.trim() !== '');

  async function goTo(id: string): Promise<void> {
    search = '';
    await tick();
    const target = document.getElementById(id);
    if (target === null) return;
    target.scrollIntoView({ block: 'start' });
    const heading = target.querySelector<HTMLElement>('h2, h3');
    heading?.focus({ preventScroll: true });
  }

  function open(event: MouseEvent, id: string): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    history.replaceState(null, '', href(helpPath(id)));
    void goTo(id);
  }

  function sectionLabel(section: HelpSection): string {
    return `${section.title} (${audienceLabel(section.audience)})`;
  }

  // Anchor of the address: `/aide?s=<id>` (both routing modes) or `/aide#<id>` (rewrite mode).
  $effect(() => {
    const id = requestedAnchor(query, window.location.hash);
    if (id !== null) void goTo(id);
  });

  onMount(() => {
    tocOpen = window.matchMedia('(min-width: 60rem)').matches;
    const onHash = (): void => {
      const id = requestedAnchor(new URLSearchParams(), window.location.hash);
      if (id !== null) void goTo(id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });
</script>

{#snippet inline(runs: readonly HelpRun[])}
  {#each runs as run, i (i)}
    {#if run.link !== null && run.link.startsWith('#')}
      {@const id = run.link.slice(1)}
      <a href={href(helpPath(id))} onclick={(e) => open(e, id)}>{run.text}</a>
    {:else if run.link !== null}
      <a href={run.link} target="_blank" rel="noopener noreferrer">{run.text}</a>
    {:else if run.code}
      <kbd>{run.text}</kbd>
    {:else if run.bold && run.italic}
      <strong><em>{run.text}</em></strong>
    {:else if run.bold}
      <strong>{run.text}</strong>
    {:else if run.italic}
      <em>{run.text}</em>
    {:else}
      {run.text}
    {/if}
  {/each}
{/snippet}

<div class="help" bind:this={page} data-testid="help-page">
  <header class="head">
    <h1>{t('help.title')}</h1>
    <p class="muted">{t('help.intro')}</p>
    <form class="search" role="search" onsubmit={(e) => e.preventDefault()}>
      <label for="help-search">{t('help.search.label')}</label>
      <input
        id="help-search"
        type="search"
        autocomplete="off"
        placeholder={t('help.search.placeholder')}
        bind:value={search}
        data-testid="help-search"
      />
    </form>
    <p class="muted small" role="status" aria-live="polite" data-testid="help-status">
      {#if searching}
        {hits.length === 0 ? t('help.search.none') : t('help.search.count', { count: hits.length })}
      {/if}
    </p>
  </header>

  <div class="layout">
    <details class="toc" bind:open={tocOpen}>
      <summary>{t('help.toc.title')}</summary>
      <nav aria-label={t('help.toc.label')}>
        {#each groups as group (group.audience)}
          <p class="toc-audience">
            <a href={href(helpPath(group.audience))} onclick={(e) => open(e, group.audience)}
              >{audienceLabel(group.audience)}</a
            >
          </p>
          <ul>
            {#each group.sections as section (section.id)}
              <li>
                <a href={href(helpPath(section.id))} onclick={(e) => open(e, section.id)}
                  >{section.title}</a
                >
              </li>
            {/each}
          </ul>
        {/each}
        <p class="toc-audience">
          <a
            href={href(helpPath('raccourcis-clavier'))}
            onclick={(e) => open(e, 'raccourcis-clavier')}>{t('help.shortcuts.title')}</a
          >
        </p>
      </nav>
    </details>

    <div class="content">
      {#if searching}
        <section aria-label={t('help.search.results')} data-testid="help-results">
          {#if hits.length === 0}
            <p>{t('help.search.none_detail')}</p>
          {:else}
            <ol class="results">
              {#each hits as hit (hit.section.id)}
                <li>
                  <a
                    class="result-title"
                    href={href(helpPath(hit.section.id))}
                    onclick={(e) => open(e, hit.section.id)}>{sectionLabel(hit.section)}</a
                  >
                  <p class="small muted">{hit.snippet}</p>
                </li>
              {/each}
            </ol>
          {/if}
        </section>
      {:else}
        {#each groups as group (group.audience)}
          <section id={group.audience} aria-labelledby={`${group.audience}-heading`}>
            <h2 id={`${group.audience}-heading`} tabindex="-1">{audienceLabel(group.audience)}</h2>
            <p class="muted">{audienceIntro(group.audience)}</p>
            {#each group.sections as section (section.id)}
              <article id={section.id} aria-labelledby={`${section.id}-title`} class="section">
                <h3 id={`${section.id}-title`} tabindex="-1">
                  {section.title}
                  <a
                    class="permalink"
                    href={href(helpPath(section.id))}
                    onclick={(e) => open(e, section.id)}
                    aria-label={t('help.permalink', { title: section.title })}>#</a
                  >
                </h3>
                {#each section.blocks as block, index (index)}
                  {#if block.kind === 'heading'}
                    {#if block.level === 4}<h4>{block.text}</h4>{:else}<h5>{block.text}</h5>{/if}
                  {:else if block.kind === 'paragraph'}
                    <p>{@render inline(block.runs)}</p>
                  {:else if block.kind === 'tip'}
                    <p class="tip">{@render inline(block.runs)}</p>
                  {:else if block.kind === 'list'}
                    {#if block.ordered}
                      <ol>
                        {#each block.items as item, i (i)}<li>{@render inline(item)}</li>{/each}
                      </ol>
                    {:else}
                      <ul>
                        {#each block.items as item, i (i)}<li>{@render inline(item)}</li>{/each}
                      </ul>
                    {/if}
                  {:else}
                    {@const url = helpImageUrl(block.src)}
                    {#if url !== null}
                      <figure>
                        <img src={url} alt={block.alt} loading="lazy" decoding="async" />
                      </figure>
                    {/if}
                  {/if}
                {/each}
              </article>
            {/each}
          </section>
        {/each}

        <section id="raccourcis-clavier" aria-labelledby="raccourcis-clavier-heading">
          <h2 id="raccourcis-clavier-heading" tabindex="-1">{t('help.shortcuts.title')}</h2>
          <p class="muted">{t('help.shortcuts.intro')}</p>
          <div class="table-wrap">
            <table data-testid="help-shortcuts">
              <caption class="visually-hidden">{t('help.shortcuts.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('help.shortcuts.keys')}</th>
                  <th scope="col">{t('help.shortcuts.action')}</th>
                </tr>
              </thead>
              <tbody>
                {#each shortcuts as row (row.action)}
                  <tr>
                    <td>
                      {#each row.keys as key, i (key)}
                        {#if i > 0}<span class="muted"> / </span>{/if}<kbd>{key}</kbd>
                      {/each}
                    </td>
                    <td>{row.description}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <ul class="small">
            <li>{t('help.shortcuts.pointer_wheel')}</li>
            <li>{t('help.shortcuts.pointer_trackpad')}</li>
            <li>{t('help.shortcuts.pointer_middle')}</li>
            <li>{t('help.shortcuts.typing')}</li>
          </ul>
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .help {
    max-width: 68rem;
    margin: 0 auto;
  }
  .head h1 {
    margin-block-end: var(--space-2);
  }
  .search {
    display: grid;
    gap: var(--space-1);
    max-width: 32rem;
    margin-block: var(--space-4) var(--space-2);
  }
  .search input {
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
    align-items: start;
  }
  .toc {
    background: var(--color-surface);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-3) var(--space-4);
  }
  .toc summary {
    cursor: pointer;
    font-weight: var(--font-weight-medium);
  }
  .toc ul {
    margin: 0 0 var(--space-3);
    padding-inline-start: var(--space-4);
    font-size: var(--font-size-sm);
  }
  .toc li {
    margin-block: var(--space-1);
  }
  .toc-audience {
    margin: var(--space-3) 0 var(--space-1);
    font-weight: var(--font-weight-bold);
  }
  .content section {
    margin-block-end: var(--space-7);
  }
  .section {
    margin-block-end: var(--space-6);
    scroll-margin-top: var(--space-4);
  }
  .content section[id] {
    scroll-margin-top: var(--space-4);
  }
  h3:focus,
  h2:focus {
    outline: none;
  }
  h3:focus-visible,
  h2:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
  .permalink {
    margin-inline-start: var(--space-2);
    color: var(--color-text-muted);
    text-decoration: none;
    font-weight: var(--font-weight-normal, 400);
    opacity: 0.6;
  }
  .permalink:hover,
  .permalink:focus-visible {
    opacity: 1;
  }
  .tip {
    padding: var(--space-3) var(--space-4);
    border-inline-start: 4px solid var(--color-primary);
    background: var(--color-primary-soft);
    border-radius: var(--radius-md);
  }
  figure {
    margin: var(--space-4) 0;
  }
  img {
    display: block;
    max-width: 100%;
    height: auto;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  kbd {
    padding: 0 0.35em;
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm, 4px);
    background: var(--color-surface-sunken);
    font-family: var(--font-mono, monospace);
    font-size: 0.9em;
    white-space: nowrap;
  }
  .results {
    padding-inline-start: var(--space-5);
  }
  .results li {
    margin-block-end: var(--space-3);
  }
  .result-title {
    font-weight: var(--font-weight-medium);
  }
  .table-wrap {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    min-width: 20rem;
  }
  th,
  td {
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-width) solid var(--color-border);
    text-align: start;
    vertical-align: top;
  }
  @media (min-width: 60rem) {
    .layout {
      grid-template-columns: 16rem minmax(0, 1fr);
    }
    .toc {
      position: sticky;
      top: var(--space-4);
      max-height: calc(100vh - 2 * var(--space-4));
      overflow-y: auto;
    }
  }
</style>
