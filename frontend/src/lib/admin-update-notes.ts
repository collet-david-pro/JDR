/**
 * Release notes are raw Markdown written on GitHub. They are shown as safe text only: the output
 * is plain strings that the template prints as text nodes (no HTML is ever interpreted, no link
 * or image is followed).
 */
export type NoteBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] };

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/;
const MAX_BLOCKS = 200;

export function parseNotes(markdown: string | null | undefined): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = (): void => {
    if (list.length > 0) blocks.push({ kind: 'list', items: list });
    list = [];
  };

  for (const raw of (markdown ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const item = LIST_ITEM.exec(line);
    const heading = HEADING.exec(line);
    if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else if (heading !== null) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', text: heading[1] ?? '' });
    } else if (item !== null) {
      flushParagraph();
      list.push(item[1] ?? '');
    } else if (list.length > 0 && /^\s+/.test(raw)) {
      list[list.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      paragraph.push(line.trim());
    }
    if (blocks.length >= MAX_BLOCKS) break;
  }
  flushParagraph();
  flushList();
  return blocks.slice(0, MAX_BLOCKS);
}
