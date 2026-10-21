import { describe, expect, it } from 'vitest';
import {
  canEditContent,
  canManageGame,
  GAME_TABS,
  initialTab,
  membersWithGm,
  nextTabIndex,
  tabsForRole,
  tokenOwners,
} from '../src/lib/games/roles';
import { makeMember } from './fixtures/games';

describe('tabs by my_role', () => {
  it('gives the five tabs to the GM and the co-GM, the player view to players', () => {
    expect(tabsForRole('gm')).toEqual(['maps', 'tokens', 'players', 'sessions', 'settings']);
    expect(tabsForRole('co_gm')).toEqual(GAME_TABS);
    expect(tabsForRole('player')).toBeNull();
  });

  it('opens the requested tab when allowed, the first one otherwise', () => {
    expect(initialTab('gm', 'tokens')).toBe('tokens');
    expect(initialTab('co_gm', 'settings')).toBe('settings');
    expect(initialTab('gm', 'admin')).toBe('maps');
    expect(initialTab('gm', null)).toBe('maps');
    expect(initialTab('player', 'tokens')).toBeNull();
  });

  it('gives the rights of the matrix (projet.md 11.2)', () => {
    expect([canEditContent('gm'), canEditContent('co_gm'), canEditContent('player')]).toEqual([
      true,
      true,
      false,
    ]);
    expect([canManageGame('gm'), canManageGame('co_gm'), canManageGame('player')]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('navigates the tab list with the keyboard (wrapping)', () => {
    expect(nextTabIndex(0, 'ArrowRight', 5)).toBe(1);
    expect(nextTabIndex(4, 'ArrowRight', 5)).toBe(0);
    expect(nextTabIndex(0, 'ArrowLeft', 5)).toBe(4);
    expect(nextTabIndex(2, 'Home', 5)).toBe(0);
    expect(nextTabIndex(2, 'End', 5)).toBe(4);
    expect(nextTabIndex(2, 'a', 5)).toBeNull();
    expect(nextTabIndex(0, 'ArrowRight', 0)).toBeNull();
  });
});

describe('members', () => {
  const gm = { id: '1', username: 'Alice' };

  it('lists the GM first, then co-GMs and players by name', () => {
    const list = membersWithGm(
      [
        makeMember('4', 'Zoé', 'player'),
        makeMember('3', 'Bob', 'player'),
        makeMember('2', 'Chloé', 'co_gm'),
        makeMember('1', 'Alice', 'gm'),
      ],
      gm,
    );
    expect(list.map((m) => m.user.username)).toEqual(['Alice', 'Chloé', 'Bob', 'Zoé']);
  });

  it('adds the GM when the list does not carry it', () => {
    const list = membersWithGm([makeMember('3', 'Bob', 'player')], gm);
    expect(list[0]).toMatchObject({ user: gm, role: 'gm' });
    expect(list).toHaveLength(2);
  });

  it('offers every member but the GM as default token owner', () => {
    expect(
      tokenOwners([
        makeMember('1', 'Alice', 'gm'),
        makeMember('3', 'Bob', 'player'),
        makeMember('2', 'Ana', 'co_gm'),
      ]),
    ).toEqual([
      { id: '2', username: 'Ana' },
      { id: '3', username: 'Bob' },
    ]);
  });
});
