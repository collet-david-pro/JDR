import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeText } from '../src/lib/commands';
import {
  AUDIENCES,
  buildCatalog,
  findSection,
  internalLinks,
  parseHelpPath,
  referencedImages,
  sectionsOf,
} from '../src/lib/help/catalog';
import { helpImageNames, helpSections } from '../src/lib/help/content';
import { helpPath, requestedAnchor } from '../src/lib/help/links';
import { parseHelpInline, parseHelpMarkdown } from '../src/lib/help/markdown';
import { queryWords, searchHelp } from '../src/lib/help/search';
import { decideAccess } from '../src/lib/guard';
import { routes } from '../src/routes';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|svelte)$/.test(name) ? [path] : [];
  });
}

describe('help markdown', () => {
  it('parses inline bold, italic, code and links', () => {
    const runs = parseHelpInline('a **b** *c* `d` [e](#mj-x) [f](https://x.org) [g](javascript:1)');
    expect(runs.filter((r) => r.bold).map((r) => r.text)).toEqual(['b']);
    expect(runs.filter((r) => r.italic).map((r) => r.text)).toEqual(['c']);
    expect(runs.filter((r) => r.code).map((r) => r.text)).toEqual(['d']);
    expect(runs.filter((r) => r.link !== null).map((r) => r.link)).toEqual([
      '#mj-x',
      'https://x.org',
    ]);
    // A non-allowed target stays visible as plain text, never a link.
    expect(runs.map((r) => r.text).join('')).toContain('[g](javascript:1)');
  });

  it('parses blocks: lists, tips, figures, sub-headings', () => {
    const blocks = parseHelpMarkdown(
      '# Titre\n\nUn texte\nsur deux lignes.\n\n- a\n- b\n\n1. un\n2. deux\n\n> astuce\n\n![alt](x.webp)\n\n## Sous-titre\n',
    );
    expect(blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'list',
      'list',
      'tip',
      'figure',
      'heading',
    ]);
  });
});

describe('help catalog', () => {
  it('derives stable ids from file paths', () => {
    expect(parseHelpPath('../../help/mj/06-creer-une-map.md')).toEqual({
      audience: 'mj',
      order: 6,
      name: 'creer-une-map',
    });
    expect(parseHelpPath('../../help/autre/x.md')).toBeNull();
    const sections = buildCatalog({
      '/h/mj/02-b.md': '# Bé\n\ntexte',
      '/h/mj/01-a.md': '# A\n\ntexte',
      '/h/joueur/01-c.md': '# C\n\ntexte',
    });
    expect(sections.map((s) => s.id)).toEqual(['joueur-c', 'mj-a', 'mj-b']);
  });

  it('every real section has a unique id, a title and a body', () => {
    const ids = helpSections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of helpSections) {
      expect(section.title.length).toBeGreaterThan(2);
      expect(section.blocks.length).toBeGreaterThan(0);
      expect(section.id).toMatch(/^(joueur|mj|irl|admin)-[a-z0-9-]+$/);
    }
    for (const audience of AUDIENCES) {
      expect(sectionsOf(helpSections, audience).length).toBeGreaterThan(5);
    }
  });

  it('internal links and figures point to existing targets', () => {
    const known = new Set([...helpSections.map((s) => s.id), 'raccourcis-clavier']);
    for (const id of internalLinks(helpSections)) expect(known.has(id), id).toBe(true);
    const images = new Set(helpImageNames());
    for (const name of referencedImages(helpSections))
      expect(images.has(name.replace(/\.[a-z0-9]+$/i, '')), name).toBe(true);
  });

  it('every help link of the interface points to an existing section', () => {
    const anchors = new Set<string>();
    for (const file of sourceFiles(srcDir)) {
      if (file.includes('/help/') || file.includes('/lib/help/')) continue;
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/anchor="([a-z0-9-]+)"/g)) anchors.add(m[1] ?? '');
      for (const m of text.matchAll(/anchor=\{[^}]*'((?:joueur|mj|irl|admin)-[a-z0-9-]+)'/g)) {
        anchors.add(m[1] ?? '');
      }
      for (const m of text.matchAll(
        /^\s+(?:'[a-z]*'|[a-z]+): '((?:joueur|mj|irl|admin)-[a-z0-9-]+)',?$/gm,
      )) {
        anchors.add(m[1] ?? '');
      }
    }
    expect(anchors.size).toBeGreaterThan(15);
    for (const anchor of anchors) {
      expect(findSection(helpSections, anchor), anchor).not.toBeNull();
    }
  });
});

describe('help search', () => {
  const sections = buildCatalog({
    '/h/mj/01-brouillard.md': '# Le brouillard de guerre\n\nRévélez une zone aux joueurs.',
    '/h/mj/02-lumiere.md': '# Lumières\n\nUne torche éclaire la pièce. Le brouillard recule.',
    '/h/joueur/01-compte.md': '# Créer un compte\n\nÉcrivez votre adresse.',
  });

  it('ignores case and accents', () => {
    expect(normalizeText('Révélez')).toBe('revelez');
    expect(searchHelp(sections, 'REVELEZ').map((h) => h.section.id)).toEqual(['mj-brouillard']);
    expect(searchHelp(sections, 'creer').map((h) => h.section.id)).toEqual(['joueur-compte']);
    expect(searchHelp(sections, 'lumiere').map((h) => h.section.id)).toEqual(['mj-lumiere']);
  });

  it('ranks title matches first and requires every word', () => {
    expect(searchHelp(sections, 'brouillard').map((h) => h.section.id)).toEqual([
      'mj-brouillard',
      'mj-lumiere',
    ]);
    expect(searchHelp(sections, 'brouillard torche').map((h) => h.section.id)).toEqual([
      'mj-lumiere',
    ]);
    expect(searchHelp(sections, 'introuvable')).toEqual([]);
    expect(searchHelp(sections, '   ')).toEqual([]);
    expect(queryWords('  Été  fini ')).toEqual(['ete', 'fini']);
  });

  it('gives a snippet around the match', () => {
    const hit = searchHelp(sections, 'torche')[0];
    expect(hit?.snippet).toContain('torche');
  });

  it('finds the real content', () => {
    expect(searchHelp(helpSections, 'brouillard').length).toBeGreaterThan(2);
    expect(searchHelp(helpSections, 'ecran de pause').length).toBeGreaterThan(0);
  });
});

describe('help links and public route', () => {
  it('builds section paths and reads the requested anchor', () => {
    expect(helpPath()).toBe('/aide');
    expect(helpPath('mj-creer-une-map')).toBe('/aide?s=mj-creer-une-map');
    expect(requestedAnchor(new URLSearchParams('s=mj-x'), '')).toBe('mj-x');
    expect(requestedAnchor(new URLSearchParams(), '#irl-mise-en-place')).toBe('irl-mise-en-place');
    expect(requestedAnchor(new URLSearchParams('s=<x>'), '#/aide')).toBeNull();
    expect(requestedAnchor(new URLSearchParams(), '')).toBeNull();
  });

  it('/aide is public: no account needed, even while the session loads', () => {
    const route = routes.find((r) => r.path === '/aide');
    expect(route?.access).toBe('public');
    const location = { path: '/aide', query: new URLSearchParams() };
    expect(decideAccess(route?.access, { status: 'loading', user: null }, location)).toEqual({
      kind: 'allow',
    });
    expect(decideAccess(route?.access, { status: 'ready', user: null }, location)).toEqual({
      kind: 'allow',
    });
  });
});
