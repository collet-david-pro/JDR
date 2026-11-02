import { describe, expect, it } from 'vitest';
import { parseMarkdown, runsText } from '../../src/lib/markdown-safe';

const text = (b: ReturnType<typeof parseMarkdown>[number]): string =>
  b.kind === 'rule'
    ? ''
    : b.kind === 'list'
      ? b.items.map((i) => runsText(i)).join('|')
      : runsText(b.runs);

describe('release notes through the safe Markdown parser', () => {
  it('builds headings, paragraphs and lists', () => {
    const blocks = parseMarkdown(
      '## Nouveautés\n\nUne ligne\nsuite\n\n- un\n- deux\n  suite\n1. trois\n',
    );
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list']);
    expect(blocks.map(text)).toEqual(['Nouveautés', 'Une ligne suite', 'un|deux suite|trois']);
  });

  it('keeps HTML as inert text', () => {
    const blocks = parseMarkdown('<img src=x onerror=alert(1)>\n\n- <script>alert(1)</script>');
    expect(blocks.map(text)).toEqual(['<img src=x onerror=alert(1)>', '<script>alert(1)</script>']);
  });

  it('handles null, empty and CRLF input', () => {
    expect(parseMarkdown(null)).toEqual([]);
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('a\r\n\r\nb')).toHaveLength(2);
  });
});
