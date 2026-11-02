import { describe, expect, it } from 'vitest';
import { normalizeText, searchCommands, type Command } from '../../src/lib/commands';

const cmd = (id: string, label: string, extra: Partial<Command> = {}): Command => ({
  id,
  label,
  group: 'Groupe',
  run: () => undefined,
  ...extra,
});

describe('searchCommands', () => {
  const list = [
    cmd('a', 'Réinitialiser le brouillard'),
    cmd('b', 'Annuler'),
    cmd('c', 'Placer un token'),
    cmd('d', 'Ouvrir la grille', { keywords: ['quadrillage'] }),
  ];

  it('keeps the registry order for an empty query', () => {
    expect(searchCommands(list, '').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(searchCommands(list, '   ').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ignores case and accents', () => {
    expect(normalizeText('Étage ÉCRAN')).toBe('etage ecran');
    expect(searchCommands(list, 'REINITIALISER').map((c) => c.id)).toEqual(['a']);
    expect(searchCommands(list, 'brouillard').map((c) => c.id)).toEqual(['a']);
  });

  it('matches a subsequence of letters', () => {
    expect(searchCommands(list, 'plctk').map((c) => c.id)).toEqual(['c']);
    expect(searchCommands(list, 'zzz')).toEqual([]);
  });

  it('matches keywords and ids', () => {
    expect(searchCommands(list, 'quadrillage').map((c) => c.id)).toEqual(['d']);
    const walls = [cmd('editor.tool.wall', 'Mur'), cmd('x', 'Autre')];
    expect(searchCommands(walls, 'tool.wall').map((c) => c.id)).toEqual(['editor.tool.wall']);
  });

  it('ranks a word start and a contiguous match above a scattered one', () => {
    const ranked = searchCommands(
      [
        cmd('1', 'Sélection large'),
        cmd('2', 'Outil de sélection'),
        cmd('3', 'Stationnement élevé de lames'),
      ],
      'sel',
    ).map((c) => c.id);
    expect(ranked.slice(0, 2).sort()).toEqual(['1', '2']);
    expect(ranked[0]).toBe('1');
    expect(ranked[ranked.length - 1]).toBe('3');
  });

  it('hides commands whose when() is false, with or without a query', () => {
    const hidden = cmd('h', 'Cachée', { when: () => false });
    expect(searchCommands([hidden, ...list], '')).toHaveLength(4);
    expect(searchCommands([hidden], 'cachee')).toEqual([]);
  });

  it('stays linear on 5000 commands', () => {
    const many = Array.from({ length: 5000 }, (_, i) => cmd(`c${i}`, `Commande numéro ${i}`));
    const started = performance.now();
    const found = searchCommands(many, 'cnm42');
    expect(performance.now() - started).toBeLessThan(500);
    expect(found.length).toBeGreaterThan(0);
  });
});
