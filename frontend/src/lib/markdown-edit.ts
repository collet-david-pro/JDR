/**
 * Formatting helpers of the Markdown editor (P9b2a): pure functions on the text and the
 * selection of a `textarea`, so that they can be tested without a DOM.
 */
export type MarkdownFormat = 'heading' | 'bold' | 'italic' | 'list' | 'ordered' | 'quote' | 'rule';

export const MARKDOWN_FORMATS: readonly MarkdownFormat[] = [
  'heading',
  'bold',
  'italic',
  'list',
  'ordered',
  'quote',
  'rule',
];

export interface EditResult {
  readonly value: string;
  readonly selStart: number;
  readonly selEnd: number;
}

function wrap(value: string, start: number, end: number, mark: string): EditResult {
  const n = mark.length;
  const inside = value.slice(start, end);
  // Selection already holding its markers: take them off.
  if (inside.length >= 2 * n && inside.startsWith(mark) && inside.endsWith(mark)) {
    const core = inside.slice(n, inside.length - n);
    return {
      value: value.slice(0, start) + core + value.slice(end),
      selStart: start,
      selEnd: start + core.length,
    };
  }
  // Markers just around the selection: take them off.
  if (start >= n && value.slice(start - n, start) === mark && value.slice(end, end + n) === mark) {
    return {
      value: value.slice(0, start - n) + inside + value.slice(end + n),
      selStart: start - n,
      selEnd: end - n,
    };
  }
  return {
    value: value.slice(0, start) + mark + inside + mark + value.slice(end),
    selStart: start + n,
    selEnd: end + n,
  };
}

const HEADING_PREFIX = /^#{1,6} /;
const LIST_PREFIX = /^(?:[-*+] |\d{1,9}[.)] )/;
const ORDERED_PREFIX = /^\d{1,9}[.)] /;
const QUOTE_PREFIX = /^> ?/;

function lines(
  value: string,
  start: number,
  end: number,
  prefix: (i: number) => string,
  has: RegExp,
  any: RegExp,
): EditResult {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const nl = value.indexOf('\n', end > start ? end - 1 : end);
  const to = nl === -1 ? value.length : nl;
  const block = value.slice(from, to).split('\n');
  const marked = block.every((l) => l.trim() === '' || has.test(l));
  const out = block.map((l, i) => {
    if (marked) return l.replace(any, '');
    return prefix(i) + l.replace(any, '');
  });
  const text = out.join('\n');
  return {
    value: value.slice(0, from) + text + value.slice(to),
    selStart: from,
    selEnd: from + text.length,
  };
}

export function applyFormat(
  value: string,
  selStart: number,
  selEnd: number,
  format: MarkdownFormat,
): EditResult {
  const start = Math.max(0, Math.min(selStart, selEnd, value.length));
  const end = Math.min(value.length, Math.max(selStart, selEnd));
  switch (format) {
    case 'bold':
      return wrap(value, start, end, '**');
    case 'italic':
      return wrap(value, start, end, '*');
    case 'heading':
      return lines(value, start, end, () => '## ', HEADING_PREFIX, HEADING_PREFIX);
    case 'list':
      return lines(value, start, end, () => '- ', /^[-*+] /, LIST_PREFIX);
    case 'ordered':
      return lines(value, start, end, (i) => `${i + 1}. `, ORDERED_PREFIX, LIST_PREFIX);
    case 'quote':
      return lines(value, start, end, () => '> ', QUOTE_PREFIX, QUOTE_PREFIX);
    case 'rule': {
      const before = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
      const after = end < value.length && value[end] !== '\n' ? '\n' : '';
      const insert = `${before}---${after === '' && end >= value.length ? '\n' : after || ''}`;
      const text = value.slice(0, start) + insert + value.slice(end);
      const caret = start + insert.length;
      return { value: text, selStart: caret, selEnd: caret };
    }
  }
}
