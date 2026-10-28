import { describe, expect, it } from 'vitest';
import { parseNotes } from '../../src/lib/admin-update-notes';

describe('parseNotes', () => {
  it('builds headings, paragraphs and lists', () => {
    const blocks = parseNotes(
      '## Nouveautés\n\nUne ligne\nsuite\n\n- un\n- deux\n  suite\n1. trois\n',
    );
    expect(blocks).toEqual([
      { kind: 'heading', text: 'Nouveautés' },
      { kind: 'paragraph', text: 'Une ligne suite' },
      { kind: 'list', items: ['un', 'deux suite', 'trois'] },
    ]);
  });

  it('keeps HTML as inert text', () => {
    const blocks = parseNotes('<img src=x onerror=alert(1)>\n\n- <script>alert(1)</script>');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: '<img src=x onerror=alert(1)>' },
      { kind: 'list', items: ['<script>alert(1)</script>'] },
    ]);
  });

  it('handles null, empty and CRLF input', () => {
    expect(parseNotes(null)).toEqual([]);
    expect(parseNotes('')).toEqual([]);
    expect(parseNotes('a\r\n\r\nb')).toHaveLength(2);
  });
});
