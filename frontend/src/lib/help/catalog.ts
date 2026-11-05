/**
 * Catalog of the built-in help (P13-2): the Markdown files of `src/help/<audience>/NN-name.md`
 * become sections. The section id (the stable anchor) is `<audience>-<name>`: the order prefix
 * `NN-` and the extension are dropped, so reordering or retitling never changes a link.
 */
import { normalizeText } from '../commands';
import { helpRunsText, parseHelpMarkdown, type HelpBlock, type HelpRun } from './markdown';

/** Help audiences. */
export const AUDIENCES = ['joueur', 'mj', 'irl', 'admin'] as const;
export type Audience = (typeof AUDIENCES)[number];

export interface HelpSection {
  /** Stable anchor: `mj-creer-une-map`. */
  readonly id: string;
  readonly audience: Audience;
  readonly title: string;
  readonly blocks: readonly HelpBlock[];
  /** Plain text of the section (title and body), for the search results. */
  readonly text: string;
  /** Normalized title (lower case, no accent). */
  readonly titleKey: string;
  /** Normalized text. */
  readonly textKey: string;
}

const PATH = /(?:^|\/)(joueur|mj|irl|admin)\/(?:(\d+)-)?([a-z0-9-]+)\.md$/;

/** Audience, order and name of a help file path, or null when it is not a help section. */
export function parseHelpPath(
  path: string,
): { audience: Audience; order: number; name: string } | null {
  const match = PATH.exec(path);
  if (match === null) return null;
  return {
    audience: match[1] as Audience,
    order: match[2] === undefined ? 0 : Number(match[2]),
    name: match[3] ?? '',
  };
}

/** Anchor of a section. */
export function sectionId(audience: Audience, name: string): string {
  return `${audience}-${name}`;
}

/** Sections built from raw files (path to Markdown source), ordered by audience then file. */
export function buildCatalog(files: Readonly<Record<string, string>>): HelpSection[] {
  const entries = Object.entries(files).flatMap(([path, source]) => {
    const info = parseHelpPath(path);
    return info === null ? [] : [{ info, path, source }];
  });
  entries.sort(
    (a, b) =>
      AUDIENCES.indexOf(a.info.audience) - AUDIENCES.indexOf(b.info.audience) ||
      a.info.order - b.info.order ||
      a.path.localeCompare(b.path),
  );
  return entries.map(({ info, source }) => {
    const heading = /^#\s+(.+)$/m.exec(source);
    const title = (heading?.[1] ?? info.name).trim();
    const blocks = parseHelpMarkdown(source);
    const body = blocks
      .map((block) => {
        switch (block.kind) {
          case 'heading':
            return block.text;
          case 'paragraph':
          case 'tip':
            return helpRunsText(block.runs);
          case 'list':
            return block.items.map((item) => helpRunsText(item)).join('\n');
          case 'figure':
            return block.alt;
        }
      })
      .join('\n');
    const text = `${title}\n${body}`;
    return {
      id: sectionId(info.audience, info.name),
      audience: info.audience,
      title,
      blocks,
      text,
      titleKey: normalizeText(title),
      textKey: normalizeText(text),
    };
  });
}

/** Sections of one audience. */
export function sectionsOf(sections: readonly HelpSection[], audience: Audience): HelpSection[] {
  return sections.filter((section) => section.audience === audience);
}

/** Section of an anchor, or null. */
export function findSection(sections: readonly HelpSection[], id: string): HelpSection | null {
  return sections.find((section) => section.id === id) ?? null;
}

/** Images (`name.webp`) referenced by the figures of the sections. */
export function referencedImages(sections: readonly HelpSection[]): string[] {
  return sections.flatMap((section) =>
    section.blocks.flatMap((block) => (block.kind === 'figure' ? [block.src] : [])),
  );
}

/** Ids of the internal links (`[text](#id)`) of the sections. */
export function internalLinks(sections: readonly HelpSection[]): string[] {
  const out: string[] = [];
  for (const section of sections) {
    for (const block of section.blocks) {
      let groups: readonly (readonly HelpRun[])[] = [];
      if (block.kind === 'list') groups = block.items;
      else if (block.kind === 'paragraph' || block.kind === 'tip') groups = [block.runs];
      for (const runs of groups) {
        for (const run of runs) if (run.link?.startsWith('#') === true) out.push(run.link.slice(1));
      }
    }
  }
  return out;
}
