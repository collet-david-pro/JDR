/**
 * Safe Markdown (P9b2a). The text is written by a user: the output is plain strings (blocks of
 * runs `{text, bold, italic}`) that a template prints as text nodes. No HTML is ever
 * interpreted; links and images are rendered as text and never followed:
 * `[a](b)` ⇒ `a (b)`, `![a](b)` ⇒ `a`. Every step is linear in the size of the input (no
 * regular expression that can backtrack, bounded searches), also for pathological bodies.
 *
 * Supported: `#` headings (1-6), paragraphs, `-` `*` `+` / `1.` lists, `>` quotes, rules
 * (`---`), `**bold**` / `__bold__`, `*italic*` / `_italic_`, `\` escapes.
 */
export interface MdRun {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

export type MdBlock =
  | { readonly kind: 'heading'; readonly level: number; readonly runs: readonly MdRun[] }
  | { readonly kind: 'paragraph'; readonly runs: readonly MdRun[] }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly MdRun[])[];
    }
  | { readonly kind: 'quote'; readonly runs: readonly MdRun[] }
  | { readonly kind: 'rule' };

export const MAX_BLOCKS = 1000;

const PUNCT = '\\`*_{}[]()#+-.!<>|~"\'&:;,/=@$%^?';

interface Delim {
  readonly delim: true;
  readonly c: '*' | '_';
  readonly n: 1 | 2;
  readonly open: boolean;
  readonly close: boolean;
  role: 'none' | 'open' | 'close';
}
type Tok = { readonly delim: false; readonly s: string } | Delim;

const isSpace = (c: string | undefined): boolean =>
  c === undefined || c === ' ' || c === '\t' || c === '\n';
const isWord = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** First index of `ch` at or after `from`; the answer is kept for increasing `from`. */
function finder(src: string, ch: string): (from: number) => number {
  let last = -2;
  return (from) => {
    if (last === -1) return -1;
    if (last >= from) return last;
    last = src.indexOf(ch, from);
    return last;
  };
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const closeBracket = finder(src, ']');
  const closeParen = finder(src, ')');
  let buf = '';
  const flush = (): void => {
    if (buf !== '') toks.push({ delim: false, s: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\\' && i + 1 < src.length && PUNCT.includes(src[i + 1]!)) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    const image = ch === '!' && src[i + 1] === '[';
    if (ch === '[' || image) {
      const open = image ? i + 1 : i;
      const close = closeBracket(open + 1);
      if (close !== -1 && src[close + 1] === '(') {
        const end = closeParen(close + 2);
        if (end !== -1) {
          const label = src.slice(open + 1, close);
          const target = src.slice(close + 2, end).trim();
          buf += image || target === '' ? label : `${label} (${target})`;
          i = end + 1;
          continue;
        }
      }
      buf += ch;
      i++;
      continue;
    }
    if (ch === '*' || ch === '_') {
      let k = 1;
      while (src[i + k] === ch) k++;
      const prev = src[i - 1];
      const next = src[i + k];
      let open = !isSpace(next);
      let close = !isSpace(prev);
      if (ch === '_' && isWord(prev) && isWord(next)) {
        open = false;
        close = false;
      }
      flush();
      for (let left = k; left > 0;) {
        const n = left >= 2 ? 2 : 1;
        toks.push({ delim: true, c: ch, n, open, close, role: 'none' });
        left -= n;
      }
      i += k;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return toks;
}

/** Pairs openers and closers (stack, each delimiter pushed and popped once at most). */
function pair(toks: readonly Tok[]): void {
  const stack: Delim[] = [];
  const counts = new Map<string, number>();
  const key = (d: Delim): string => d.c + String(d.n);
  for (const t of toks) {
    if (!t.delim) continue;
    if (t.close && (counts.get(key(t)) ?? 0) > 0) {
      for (;;) {
        const top = stack.pop()!;
        counts.set(key(top), (counts.get(key(top)) ?? 1) - 1);
        if (key(top) === key(t)) {
          top.role = 'open';
          t.role = 'close';
          break;
        }
      }
    } else if (t.open) {
      stack.push(t);
      counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
    }
  }
}

export function parseInline(src: string): MdRun[] {
  const toks = tokenize(src);
  pair(toks);
  const runs: MdRun[] = [];
  let bold = 0;
  let italic = 0;
  const push = (text: string): void => {
    const last = runs[runs.length - 1];
    const b = bold > 0;
    const it = italic > 0;
    if (last !== undefined && last.bold === b && last.italic === it) {
      runs[runs.length - 1] = { text: last.text + text, bold: b, italic: it };
    } else runs.push({ text, bold: b, italic: it });
  };
  for (const t of toks) {
    if (!t.delim) push(t.s);
    else if (t.role === 'none') push(t.c.repeat(t.n));
    else {
      const d = t.role === 'open' ? 1 : -1;
      if (t.n === 2) bold += d;
      else italic += d;
    }
  }
  return runs.filter((r) => r.text !== '');
}

function trimStart(s: string): string {
  let i = 0;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
  return s.slice(i);
}

/** Content of a list item line, or null. */
function listItem(line: string): string | null {
  const s = trimStart(line);
  const c = s[0];
  if ((c === '-' || c === '*' || c === '+') && (s[1] === ' ' || s[1] === '\t')) {
    return s.slice(2);
  }
  let d = 0;
  while (d < s.length && d < 10 && s[d]! >= '0' && s[d]! <= '9') d++;
  if (
    d > 0 &&
    d < 10 &&
    (s[d] === '.' || s[d] === ')') &&
    (s[d + 1] === ' ' || s[d + 1] === '\t')
  ) {
    return s.slice(d + 2);
  }
  return null;
}

function isRule(line: string): boolean {
  const s = line.trim();
  const c = s[0];
  if (c !== '-' && c !== '*' && c !== '_') return false;
  let n = 0;
  for (const x of s) {
    if (x === c) n++;
    else if (x !== ' ' && x !== '\t') return false;
  }
  return n >= 3;
}

/** Heading level and text, or null. */
function heading(line: string): { level: number; text: string } | null {
  const s = trimStart(line);
  let level = 0;
  while (s[level] === '#') level++;
  if (level < 1 || level > 6 || (s[level] !== undefined && s[level] !== ' ' && s[level] !== '\t')) {
    return null;
  }
  let text = s.slice(level).trim();
  let j = text.length;
  while (j > 0 && text[j - 1] === '#') j--;
  if (j === 0) text = '';
  else if (j < text.length && text[j - 1] === ' ') text = text.slice(0, j).trimEnd();
  return { level, text };
}

export function parseMarkdown(markdown: string | null | undefined): MdBlock[] {
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: string[] = [];
  let ordered = false;

  const flush = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', runs: parseInline(paragraph.join(' ')) });
    } else if (quote.length > 0) {
      blocks.push({ kind: 'quote', runs: parseInline(quote.join(' ')) });
    } else if (list.length > 0) {
      blocks.push({ kind: 'list', ordered, items: list.map((i) => parseInline(i)) });
    }
    paragraph = [];
    quote = [];
    list = [];
  };

  for (const raw of (markdown ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const trimmed = trimStart(line);
    const head = heading(line);
    const item = listItem(line);
    if (trimmed === '') {
      flush();
    } else if (isRule(line)) {
      flush();
      blocks.push({ kind: 'rule' });
    } else if (head !== null) {
      flush();
      blocks.push({ kind: 'heading', level: head.level, runs: parseInline(head.text) });
    } else if (trimmed[0] === '>') {
      if (quote.length === 0) flush();
      const body = trimmed.slice(1);
      quote.push(body[0] === ' ' ? body.slice(1) : body);
    } else if (item !== null) {
      if (list.length === 0) {
        flush();
        ordered = !'-*+'.includes(trimmed[0]!);
      }
      list.push(item);
    } else if (list.length > 0 && trimmed !== line) {
      list[list.length - 1] += ` ${trimmed}`;
    } else {
      if (paragraph.length === 0) flush();
      paragraph.push(trimmed);
    }
    if (blocks.length >= MAX_BLOCKS) break;
  }
  flush();
  return blocks.slice(0, MAX_BLOCKS);
}

/** The plain text of runs (for tests and summaries). */
export function runsText(runs: readonly MdRun[]): string {
  return runs.map((r) => r.text).join('');
}
