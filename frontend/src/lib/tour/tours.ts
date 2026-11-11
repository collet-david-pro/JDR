/**
 * Guided tours (first visit of a page): one per screen, for the GM, the player and the
 * administrator. A step points at an element through a CSS selector (`data-tour` or an existing
 * `data-testid`); a step without a target is shown in the middle of the screen. Its texts are
 * `tour.<tour>.<step>.title` and `tour.<tour>.<step>.body` in i18n/fr.json.
 */
export type TourId = 'home' | 'game' | 'editor' | 'console' | 'play' | 'admin';

export interface TourStep {
  /** Step name, part of its i18n keys. */
  readonly key: string;
  /** Element to light up; absent: the card is centred. */
  readonly target?: string;
}

const tour = (name: string): string => `[data-tour="${name}"]`;
const testid = (name: string): string => `[data-testid="${name}"]`;

export const TOURS: Readonly<Record<TourId, readonly TourStep[]>> = {
  home: [
    { key: 'welcome' },
    { key: 'gm', target: tour('home-gm') },
    { key: 'player', target: tour('home-player') },
    { key: 'join', target: tour('home-join') },
    { key: 'nav', target: tour('nav') },
    { key: 'help', target: testid('nav-help') },
  ],
  game: [
    { key: 'intro' },
    { key: 'maps', target: tour('game-tab-maps') },
    { key: 'tokens', target: tour('game-tab-tokens') },
    { key: 'players', target: tour('game-tab-players') },
    { key: 'sessions', target: tour('game-tab-sessions') },
  ],
  editor: [
    { key: 'top', target: tour('editor-top') },
    { key: 'view', target: testid('editor-view-menu') },
    { key: 'tools', target: tour('editor-tools') },
    { key: 'map', target: testid('editor-viewport') },
    { key: 'panels', target: testid('editor-panels-column') },
    { key: 'status', target: testid('editor-status') },
  ],
  console: [
    { key: 'header', target: testid('console-header') },
    { key: 'code', target: testid('session-code-box') },
    { key: 'map', target: testid('console-viewport') },
    { key: 'panels', target: tour('console-panels') },
  ],
  play: [
    { key: 'map', target: testid('play-viewport') },
    { key: 'follow', target: tour('play-follow') },
    { key: 'notes', target: testid('play-notes-button') },
    { key: 'center', target: testid('play-center') },
    { key: 'leave', target: testid('play-leave') },
  ],
  admin: [
    { key: 'tabs', target: tour('admin-tabs') },
    { key: 'dashboard', target: tour('admin-panel') },
    { key: 'update', target: tour('admin-tab-update') },
    { key: 'backup', target: tour('admin-tab-backup') },
  ],
};

export const TOUR_IDS = Object.keys(TOURS) as TourId[];

export function isTourId(value: unknown): value is TourId {
  return typeof value === 'string' && (TOUR_IDS as string[]).includes(value);
}

export function stepTitleKey(id: TourId, step: TourStep): string {
  return `tour.${id}.${step.key}.title`;
}

export function stepBodyKey(id: TourId, step: TourStep): string {
  return `tour.${id}.${step.key}.body`;
}

/** Steps whose target is on screen (steps without a target are always kept). */
export function presentSteps(
  steps: readonly TourStep[],
  isPresent: (selector: string) => boolean,
): TourStep[] {
  return steps.filter((step) => step.target === undefined || isPresent(step.target));
}
