/**
 * Markdown of the built-in help (P13-2). The help files are written by the maintainers and
 * shipped with the application, but the output stays plain data (blocks of runs printed as
 * Svelte elements and text nodes): no HTML is ever interpreted. Every step is linear.
 *
 * Supported: `#` section title (taken by the catalog), `##` and `###` sub-headings, paragraphs,
 * `-` and `1.` lists, `>` tips, `![alt](file.webp)` figures on their own line, and inline
 * `**bold**`, `*italic*`, `` `code` `` (printed as a key or a name), `[text](#section-id)`
 * (link to another section) and `[text](https://…)` (external link).
 */
export interface HelpRun {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly code: boolean;
  /** `#section-id` (internal) or an absolute http(s) URL; null for plain text. */
  readonly link: string | null;
}

export type HelpBlock =
  | { readonly kind: 'heading'; readonly level: 4 | 5; readonly text: string }
  | { readonly kind: 'paragraph'; readonly runs: readonly HelpRun[] }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly HelpRun[])[];
    }
  | { readonly kind: 'tip'; readonly runs: readonly HelpRun[] }
  | { readonly kind: 'figure'; readonly src: string; readonly alt: string };

const LINK_TARGET = /^(#[a-z0-9-]+|https?:\/\/\S+)$/;

/** Inline runs of one text (bold, italic, code, links). */
export function parseHelpInline(src: string): HelpRun[] {
  const runs: HelpRun[] = [];
  let bold = false;
  let italic = false;
  let buf = '';
  const flush = (): void => {
    if (buf === '') return;
    runs.push({ text: buf, bold, italic, code: false, link: null });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (ch === '\\' && i + 1 < src.length) {
      buf += src.charAt(i + 1);
      i += 2;
    } else if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end === -1) {
        buf += ch;
        i++;
      } else {
        flush();
        runs.push({ text: src.slice(i + 1, end), bold, italic, code: true, link: null });
        i = end + 1;
      }
    } else if (ch === '[') {
      const close = src.indexOf('](', i + 1);
      const end = close === -1 ? -1 : src.indexOf(')', close + 2);
      const target = end === -1 ? '' : src.slice(close + 2, end);
      if (end !== -1 && LINK_TARGET.test(target)) {
        flush();
        runs.push({ text: src.slice(i + 1, close), bold, italic, code: false, link: target });
        i = end + 1;
      } else {
        buf += ch;
        i++;
      }
    } else if (ch === '*' && src.charAt(i + 1) === '*') {
      flush();
      bold = !bold;
      i += 2;
    } else if (ch === '*') {
      flush();
      italic = !italic;
      i++;
    } else {
      buf += ch;
      i++;
    }
  }
  flush();
  return runs;
}

const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+\.\s+(.*)$/;

/** Blocks of a help text (the `# title` line included: it is skipped here). */
export function parseHelpMarkdown(markdown: string): HelpBlock[] {
  const blocks: HelpBlock[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let tip: string[] = [];

  const flushAll = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', runs: parseHelpInline(paragraph.join(' ')) });
      paragraph = [];
    }
    if (list !== null) {
      blocks.push({
        kind: 'list',
        ordered: list.ordered,
        items: list.items.map((item) => parseHelpInline(item)),
      });
      list = null;
    }
    if (tip.length > 0) {
      blocks.push({ kind: 'tip', runs: parseHelpInline(tip.join(' ')) });
      tip = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') {
      flushAll();
      continue;
    }
    const image = IMAGE.exec(line);
    if (image !== null) {
      flushAll();
      blocks.push({ kind: 'figure', alt: image[1] ?? '', src: image[2] ?? '' });
      continue;
    }
    if (line.startsWith('# ')) {
      flushAll();
      continue;
    }
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      flushAll();
      blocks.push({
        kind: 'heading',
        level: heading[1] === '##' ? 4 : 5,
        text: heading[2] ?? '',
      });
      continue;
    }
    if (line.startsWith('>')) {
      if (paragraph.length > 0 || list !== null) flushAll();
      tip.push(line.replace(/^>\s?/, ''));
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    const item = bullet ?? numbered;
    if (item !== null) {
      const ordered = bullet === null;
      if (list !== null && list.ordered !== ordered) flushAll();
      if (list === null) {
        flushAll();
        list = { ordered, items: [] };
      }
      list.items.push(item[1] ?? '');
      continue;
    }
    if (list !== null && raw.startsWith(' ')) {
      // Continuation of the previous list item.
      list.items[list.items.length - 1] += ` ${line}`;
      continue;
    }
    if (tip.length > 0 || list !== null) flushAll();
    paragraph.push(line);
  }
  flushAll();
  return blocks;
}

/** Plain text of runs, as read by the search. */
export function helpRunsText(runs: readonly HelpRun[]): string {
  return runs.map((run) => run.text).join('');
}
