/**
 * Full-text search of the help (P13-2): case and accent insensitive, every word of the query
 * must appear in the title or in the text of a section; title matches rank first.
 */
import { normalizeText } from '../commands';
import type { HelpSection } from './catalog';

export interface HelpHit {
  readonly section: HelpSection;
  readonly score: number;
  /** Short excerpt around the first match (plain text). */
  readonly snippet: string;
}

/** Words of a query, normalized (no accent, lower case). */
export function queryWords(query: string): string[] {
  return normalizeText(query)
    .split(/[\s]+/)
    .filter((word) => word !== '');
}

function snippetOf(section: HelpSection, words: readonly string[]): string {
  const flat = section.text.replace(/\s+/g, ' ');
  const key = normalizeText(flat);
  // Same length unless a character expands when lower-cased: then keep the text start.
  if (key.length !== flat.length) return flat.slice(0, 140);
  let at = -1;
  for (const word of words) {
    const found = key.indexOf(word);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) return flat.slice(0, 140);
  const start = Math.max(0, at - 50);
  const end = Math.min(flat.length, at + 90);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

/** Sections matching `query`, best first; an empty query returns nothing. */
export function searchHelp(sections: readonly HelpSection[], query: string): HelpHit[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const hits: HelpHit[] = [];
  for (const section of sections) {
    let score = 0;
    let all = true;
    for (const word of words) {
      const inTitle = section.titleKey.includes(word);
      const inText = section.textKey.includes(word);
      if (!inTitle && !inText) {
        all = false;
        break;
      }
      score += inTitle ? 100 : 0;
      score += inText ? 10 : 0;
      if (inTitle && section.titleKey.startsWith(word)) score += 20;
    }
    if (all) hits.push({ section, score, snippet: snippetOf(section, words) });
  }
  return hits.sort((a, b) => b.score - a.score);
}
