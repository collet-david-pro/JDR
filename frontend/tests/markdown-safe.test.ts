import { describe, expect, it } from 'vitest';
import { MAX_BLOCKS, parseInline, parseMarkdown, runsText } from '../src/lib/markdown-safe';

describe('parseMarkdown blocks', () => {
  it('parses headings, quotes, rules and ordered lists', () => {
    const b = parseMarkdown('# T\n\n> citation\n> suite\n\n---\n\n1. a\n2. b');
    expect(b.map((x) => x.kind)).toEqual(['heading', 'quote', 'rule', 'list']);
    const h = b[0]!;
    expect(h.kind === 'heading' && h.level).toBe(1);
    const q = b[1]!;
    expect(q.kind === 'quote' && runsText(q.runs)).toBe('citation suite');
    const l = b[3]!;
    expect(l.kind === 'list' && l.ordered).toBe(true);
  });

  it('does not take 7 hashes or "#x" for a heading', () => {
    expect(parseMarkdown('####### x')[0]?.kind).toBe('paragraph');
    expect(parseMarkdown('#x')[0]?.kind).toBe('paragraph');
  });

  it('caps the number of blocks', () => {
    const blocks = parseMarkdown(Array.from({ length: 3000 }, (_, i) => `# t${i}`).join('\n'));
    expect(blocks.length).toBe(MAX_BLOCKS);
  });
});

describe('parseInline', () => {
  it('reads bold and italic', () => {
    expect(parseInline('a **b** _c_ *d*')).toEqual([
      { text: 'a ', bold: false, italic: false },
      { text: 'b', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'c', bold: false, italic: true },
      { text: ' ', bold: false, italic: false },
      { text: 'd', bold: false, italic: true },
    ]);
  });

  it('keeps an unmatched marker as text and honours escapes', () => {
    expect(runsText(parseInline('2 * 3 and *oops'))).toBe('2 * 3 and *oops');
    expect(runsText(parseInline('\\*x\\*'))).toBe('*x*');
    expect(runsText(parseInline('snake_case_name'))).toBe('snake_case_name');
  });

  it('turns links and images into text', () => {
    expect(runsText(parseInline('[a](http://x.test)'))).toBe('a (http://x.test)');
    expect(runsText(parseInline('![alt](http://x.test/i.png)'))).toBe('alt');
    expect(runsText(parseInline('[x](javascript:alert(1))'))).toBe('x (javascript:alert(1))');
  });
});

describe('safety', () => {
  const dangerous = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '&lt;b&gt; &amp; &#60;',
  ];
  it.each(dangerous)('keeps %s as literal text', (src) => {
    const blocks = parseMarkdown(src);
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    expect(b.kind === 'paragraph' && runsText(b.runs)).toBe(src);
  });

  it('runs in linear time on pathological bodies of 20 000 characters', () => {
    const bodies = [
      '*'.repeat(20_000),
      '_'.repeat(20_000),
      '*a'.repeat(10_000),
      'a*'.repeat(10_000),
      '['.repeat(20_000),
      '[a]('.repeat(5_000),
      '![['.repeat(6_000),
      '[a](b'.repeat(4_000),
      ']('.repeat(10_000),
      '**_'.repeat(6_666),
      '> '.repeat(10_000),
      '- '.repeat(10_000),
    ];
    for (const body of bodies) {
      const t0 = performance.now();
      parseMarkdown(body);
      expect(performance.now() - t0).toBeLessThan(500);
    }
  });
});
