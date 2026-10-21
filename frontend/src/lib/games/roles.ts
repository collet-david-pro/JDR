/**
 * Game page tabs and rights by role (projet.md 11.2, 18.1 p.3-4). The server stays the
 * authority; the interface only hides what the role cannot do.
 */

import type { GameRole, Member, UserRef } from '../types';

export const GAME_TABS = ['maps', 'tokens', 'players', 'sessions', 'settings'] as const;
export type GameTab = (typeof GAME_TABS)[number];

/** GM-side tabs, or null for the player view. */
export function tabsForRole(role: GameRole): readonly GameTab[] | null {
  return role === 'player' ? null : GAME_TABS;
}

export function isGameTab(value: string | null | undefined): value is GameTab {
  return value !== null && value !== undefined && (GAME_TABS as readonly string[]).includes(value);
}

/** Tab to open: the requested one (?tab=) when the role has it, otherwise the first. */
export function initialTab(role: GameRole, requested: string | null): GameTab | null {
  const tabs = tabsForRole(role);
  if (tabs === null) return null;
  return isGameTab(requested) && tabs.includes(requested) ? requested : (tabs[0] ?? null);
}

/** Maps, tokens, encounters (CRUD): GM and co-GM. */
export function canEditContent(role: GameRole): boolean {
  return role === 'gm' || role === 'co_gm';
}

/** Game settings, archive, delete, members: GM only (the co-GM sees settings read-only). */
export function canManageGame(role: GameRole): boolean {
  return role === 'gm';
}

/** Tablist keyboard navigation (WAI-ARIA tabs pattern, automatic activation). */
export function nextTabIndex(index: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

const ROLE_ORDER: Readonly<Record<GameRole, number>> = { gm: 0, co_gm: 1, player: 2 };

/**
 * Members to display: the GM first (added from `game.gm` when the list does not carry it),
 * then co-GMs and players by name.
 */
export function membersWithGm(members: readonly Member[], gm: UserRef): Member[] {
  const list = members.some((m) => m.role === 'gm' || m.user.id === gm.id)
    ? [...members]
    : [{ user: gm, role: 'gm' as const, joined_at: '' }, ...members];
  return list.sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      a.user.username.localeCompare(b.user.username, 'fr'),
  );
}

/** Members who may own a token by default (everyone but the GM, who owns unassigned ones). */
export function tokenOwners(members: readonly Member[]): UserRef[] {
  return members
    .filter((m) => m.role !== 'gm')
    .map((m) => m.user)
    .sort((a, b) => a.username.localeCompare(b.username, 'fr'));
}
