/** Translated labels of game enumerations (literal keys, checked by tests/i18n-keys). */

import { t } from '../i18n';
import type { GameRole, TokenKind } from '../types';
import type { SettingFlag } from './game-form';
import type { GameTab } from './roles';

export function roleLabel(role: GameRole): string {
  switch (role) {
    case 'gm':
      return t('games.roles.gm');
    case 'co_gm':
      return t('games.roles.co_gm');
    case 'player':
      return t('games.roles.player');
  }
}

export function tokenKindLabel(kind: TokenKind): string {
  switch (kind) {
    case 'pc':
      return t('games.tokens.kinds.pc');
    case 'npc':
      return t('games.tokens.kinds.npc');
    case 'monster':
      return t('games.tokens.kinds.monster');
    case 'object':
      return t('games.tokens.kinds.object');
  }
}

export function tabLabel(tab: GameTab): string {
  switch (tab) {
    case 'maps':
      return t('games.tabs.maps');
    case 'tokens':
      return t('games.tabs.tokens');
    case 'players':
      return t('games.tabs.players');
    case 'sessions':
      return t('games.tabs.sessions');
    case 'settings':
      return t('games.tabs.settings');
  }
}

export function settingFlagLabel(flag: SettingFlag): { label: string; hint: string } {
  switch (flag) {
    case 'fog_strict':
      return {
        label: t('games.settings.fog_strict'),
        hint: t('games.settings.fog_strict_hint'),
      };
    case 'players_blocked_by_walls':
      return {
        label: t('games.settings.players_blocked_by_walls'),
        hint: t('games.settings.players_blocked_by_walls_hint'),
      };
    case 'players_can_move_own_tokens':
      return {
        label: t('games.settings.players_can_move_own_tokens'),
        hint: t('games.settings.players_can_move_own_tokens_hint'),
      };
    case 'players_see_other_pcs':
      return {
        label: t('games.settings.players_see_other_pcs'),
        hint: t('games.settings.players_see_other_pcs_hint'),
      };
  }
}
