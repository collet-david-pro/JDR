/**
 * Command registry of the palette (Cmd/Ctrl+K, P9c2). Pure: no Svelte, no DOM. A command is
 * an action of the editor or of the GM console; the palette searches them with a linear fuzzy
 * match (case and accent insensitive, subsequence of letters, bonus at the start of a word).
 */
export interface Command {
  /** Stable id (`editor.tool.wall`, `console.pause`...). Also searched, at a lower rank. */
  readonly id: string;
  /** Text shown (user data such as a note title is plain text, never HTML). */
  readonly label: string;
  /** Section shown next to the label. */
  readonly group: string;
  /** Shortcut label shown on the right ("Ctrl+Z"). */
  readonly shortcut?: string | null;
  /** Extra words matched by the search. */
  readonly keywords?: readonly string[];
  /** The command is offered only while this is true (default: always). */
  readonly when?: () => boolean;
  readonly run: () => void;
}

/** Lower case without accents (NFD, combining marks removed). */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const WORD_BREAK = /[\s.\-_/:'"()«»]/;

function wordStart(text: string, index: number): boolean {
  return index === 0 || WORD_BREAK.test(text.charAt(index - 1));
}

/** Score of a query in a text (both normalized), or -1 when it is not a subsequence. */
function score(text: string, query: string): number {
  const at = text.indexOf(query);
  if (at >= 0)
    return 1000 - Math.min(at, 200) + (wordStart(text, at) ? 300 : 0) - text.length / 100;
  let value = 0;
  let from = 0;
  let last = -1;
  for (let i = 0; i < query.length; i++) {
    const found = text.indexOf(query.charAt(i), from);
    if (found < 0) return -1;
    if (wordStart(text, found)) value += 40;
    value += last >= 0 && found === last + 1 ? 15 : -Math.min(found - last, 10);
    last = found;
    from = found + 1;
  }
  return 400 + value - text.length / 100;
}

const FIELD_PENALTY = { label: 0, keyword: 150, group: 250, id: 300 } as const;

function commandScore(command: Command, query: string): number {
  let best = -1;
  const consider = (text: string, penalty: number): void => {
    const s = score(normalizeText(text), query);
    if (s >= 0 && (best < 0 || s - penalty > best)) best = s - penalty;
  };
  consider(command.label, FIELD_PENALTY.label);
  for (const word of command.keywords ?? []) consider(word, FIELD_PENALTY.keyword);
  consider(command.group, FIELD_PENALTY.group);
  consider(command.id, FIELD_PENALTY.id);
  return best;
}

/**
 * Commands matching `query`, best first. An empty query keeps the registry order. A command
 * whose `when` is false is never returned. Linear in the number of commands.
 */
export function searchCommands(commands: readonly Command[], query: string): Command[] {
  const available = commands.filter((c) => c.when === undefined || c.when());
  const q = normalizeText(query).trim();
  if (q === '') return available;
  const scored: { command: Command; score: number; index: number }[] = [];
  for (const [index, command] of available.entries()) {
    const s = commandScore(command, q);
    if (s >= 0) scored.push({ command, score: s, index });
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.command);
}
