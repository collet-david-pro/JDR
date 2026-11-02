import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import MarkdownView from '../src/components/MarkdownView.svelte';

const html = (source: string): string => render(MarkdownView, { props: { source } }).body;
const ALLOWED = new Set([
  'div',
  'p',
  'h3',
  'h4',
  'h5',
  'ul',
  'ol',
  'li',
  'blockquote',
  'hr',
  'strong',
  'em',
]);

function tags(markup: string): string[] {
  return [...markup.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]!.toLowerCase());
}

describe('MarkdownView', () => {
  it('renders the supported blocks as elements', () => {
    const out = html('# Titre\n\nUn **gras** et _italique_\n\n- a\n- b\n\n> cite\n\n---');
    for (const tag of ['h3', 'p', 'strong', 'em', 'ul', 'li', 'blockquote', 'hr']) {
      expect(tags(out)).toContain(tag);
    }
  });

  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[x](javascript:alert(1))',
    '<a href="https://evil.test">x</a>',
    '&lt;b&gt; &amp;',
  ])('prints %s as text only', (source) => {
    const out = html(source);
    expect(tags(out).filter((t) => !ALLOWED.has(t))).toEqual([]);
    for (const m of out.matchAll(/<[a-z][^>]*>/gi)) {
      expect(m[0]).not.toMatch(/\b(href|src|on[a-z]+)\s*=/i);
    }
    expect(out).not.toContain('<script');
  });

  it('escapes the angle brackets of the body', () => {
    expect(html('<img src=x onerror=alert(1)>')).toContain('&lt;img src=x onerror=alert(1)>');
  });
});
