/**
 * Small library of vector emblems and silhouettes (fill paths in a 100 x 100 box, even-odd).
 * No asset to download: the paths are drawn with Path2D by render.ts.
 */

export type EmblemGroup = 'class' | 'creature' | 'symbol';

export interface Emblem {
  readonly id: string;
  readonly group: EmblemGroup;
  readonly path: string;
}

export const EMBLEMS: readonly Emblem[] = [
  // Classes and gear
  {
    id: 'sword',
    group: 'class',
    path: 'M50 4l7 12v46H43V16zM27 62h46v8H27zM45 70h10v18H45zM41 88h18v7H41z',
  },
  { id: 'shield', group: 'class', path: 'M50 6l34 11v27c0 24-15 40-34 50C31 84 16 68 16 44V17z' },
  {
    id: 'axe',
    group: 'class',
    path: 'M47 8h6v84h-6zM53 14c20-6 34 8 34 22-8 8-22 12-34 6zM47 14C27 8 13 22 13 36c8 8 22 12 34 6z',
  },
  {
    id: 'bow',
    group: 'class',
    path: 'M24 8c40 6 60 32 60 42S64 86 24 92c18-12 26-28 26-42S42 20 24 8zM46 47h40v6H46zM82 40l12 10-12 10z',
  },
  {
    id: 'staff',
    group: 'class',
    path: 'M46 30h8v64h-8zM50 4c12 0 20 8 20 18S62 38 50 38 30 32 30 22 38 4 50 4zM50 12a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  },
  {
    id: 'dagger',
    group: 'class',
    path: 'M50 4l9 14v36H41V18zM30 54h40v7H30zM45 61h10v22H45zM42 83h16v8H42z',
  },
  {
    id: 'book',
    group: 'class',
    path: 'M12 20c14-6 28-6 38 4 10-10 24-10 38-4v60c-14-6-28-6-38 4-10-10-24-10-38-4zM50 28v50h0z',
  },
  { id: 'cross', group: 'class', path: 'M42 6h16v30h30v16H58v42H42V52H12V36h30z' },
  {
    id: 'potion',
    group: 'class',
    path: 'M40 6h20v6h-5v22l22 38c4 8-1 20-12 20H35c-11 0-16-12-12-20l22-38V12h-5zM38 62h24l8 14H30z',
  },
  {
    id: 'lute',
    group: 'class',
    path: 'M62 45L80 27l6 3 6-10-12-12-10 6 3 6-18 18A27 27 0 1 0 62 45zM32 64a8 8 0 1 0 16 0 8 8 0 1 0-16 0z',
  },
  // Creatures and silhouettes
  {
    id: 'hero',
    group: 'creature',
    path: 'M50 8a17 17 0 1 0 0 34 17 17 0 0 0 0-34zM18 94c0-24 14-44 32-44s32 20 32 44z',
  },
  {
    id: 'hood',
    group: 'creature',
    path: 'M50 6C30 6 20 24 20 42c0 8-8 14-10 26 8 6 20 8 26 4l-4 22h36l-4-22c6 4 18 2 26-4-2-12-10-18-10-26C80 24 70 6 50 6zM50 30c-8 0-14 6-14 14s6 14 14 14 14-6 14-14-6-14-14-14z',
  },
  { id: 'wizard', group: 'creature', path: 'M50 2l18 62h22v10H10V64h22zM30 78h40l6 16H24z' },
  {
    id: 'helm',
    group: 'creature',
    path: 'M50 6C30 6 16 22 16 42v36c0 6 6 12 12 12h10V62h24v28h10c6 0 12-6 12-12V42C84 22 70 6 50 6zM34 44h32v10H34z',
  },
  {
    id: 'horns',
    group: 'creature',
    path: 'M8 8c6 24 20 34 30 36 4 10 4 20 0 30l12 18 12-18c-4-10-4-20 0-30 10-2 24-12 30-36-12 14-24 18-36 18S20 22 8 8zM40 56a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM60 56a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  },
  {
    id: 'wolf',
    group: 'creature',
    path: 'M10 6l24 18h32L90 6l2 36-10 26-16 8 4 18H30l4-18-16-8L8 42zM34 44a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM66 44a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  },
  {
    id: 'dragon',
    group: 'creature',
    path: 'M20 94l5-16-10-2 13-12-8-6 14-8-4-8 16-4 4-4-10-22 15 15-1-9 8 12h10l22 14-2 8-18 2 14 10-4 6-18-4q-10 6-14 28zM58 40a4 4 0 1 0 8 0 4 4 0 1 0-8 0z',
  },
  {
    id: 'spider',
    group: 'creature',
    path: 'M50 30a14 14 0 1 0 0 28 14 14 0 0 0 0-28zM46 58h8v24l-4 12-4-12zM8 20l30 18-2 6L10 30zM8 56l28-8 2 6-26 12zM92 20L62 38l2 6 28-14zM92 56l-28-8-2 6 26 12zM20 84l22-14 3 5-20 16zM80 84L58 70l-3 5 20 16z',
  },
  {
    id: 'bat',
    group: 'creature',
    path: 'M50 38l5-11 3 13q16-12 38-10-8 10-6 24-8-8-14 0-6-4-10 8-6-6-10 4l-6 10-6-10q-4-10-10-4-4-12-10-8-6-8-14 0 2-14-6-24 22-2 38 10l3-13z',
  },
  {
    id: 'paw',
    group: 'creature',
    path: 'M50 52c-14 0-26 14-26 26 0 8 8 12 16 10 6-2 14-2 20 0 8 2 16-2 16-10 0-12-12-26-26-26zM20 38a9 11 0 1 0 0 22 9 11 0 0 0 0-22zM40 14a9 12 0 1 0 0 24 9 12 0 0 0 0-24zM60 14a9 12 0 1 0 0 24 9 12 0 0 0 0-24zM80 38a9 11 0 1 0 0 22 9 11 0 0 0 0-22z',
  },
  {
    id: 'skull',
    group: 'creature',
    path: 'M50 6C28 6 14 22 14 42c0 12 6 20 14 26v16h12v-8h6v8h8v-8h6v8h12V68c8-6 14-14 14-26C86 22 72 6 50 6zM34 36a9 11 0 1 0 0 22 9 11 0 0 0 0-22zM66 36a9 11 0 1 0 0 22 9 11 0 0 0 0-22zM50 58l-6 12h12z',
  },
  // Symbols
  { id: 'star', group: 'symbol', path: 'M50 4l14 30 32 4-24 22 7 32-29-17-29 17 7-32L4 38l32-4z' },
  {
    id: 'heart',
    group: 'symbol',
    path: 'M50 92C14 62 6 44 6 30 6 16 16 8 28 8c10 0 18 6 22 14 4-8 12-14 22-14 12 0 22 8 22 22 0 14-8 32-44 62z',
  },
  {
    id: 'flame',
    group: 'symbol',
    path: 'M50 2c4 20 24 32 24 56 0 20-10 36-24 36S26 78 26 58c0-10 6-18 10-24 2 8 6 12 10 14-4-18 0-34 4-46z',
  },
  {
    id: 'moon',
    group: 'symbol',
    path: 'M62 12A40 40 0 1 0 62 88 40 40 0 0 1 62 12z',
  },
  {
    id: 'sun',
    group: 'symbol',
    path: 'M50 26a24 24 0 1 0 0 48 24 24 0 0 0 0-48zM46 2h8v16h-8zM46 82h8v16h-8zM2 46h16v8H2zM82 46h16v8H82zM14 14l6-6 12 12-6 6zM74 74l6-6 12 12-6 6zM8 80l12-12 6 6-12 12zM68 26l12-12 6 6-12 12z',
  },
  { id: 'bolt', group: 'symbol', path: 'M58 2L18 56h26L38 98l44-60H56z' },
  { id: 'gem', group: 'symbol', path: 'M26 10h48l22 26L50 92 4 36zM30 36l20 40 20-40z' },
  {
    id: 'crown',
    group: 'symbol',
    path: 'M6 76L14 24l24 24 12-30 12 30 24-24 8 52zM10 82h80v10H10z',
  },
  {
    id: 'key',
    group: 'symbol',
    path: 'M32 6a24 24 0 1 0 14 43l8 8h8v8h8v8h12V50L45 18A24 24 0 0 0 32 6zM30 22a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
  },
  {
    id: 'eye',
    group: 'symbol',
    path: 'M50 18C26 18 8 36 2 50c6 14 24 32 48 32s42-18 48-32C92 36 74 18 50 18zM50 32a18 18 0 1 0 0 36 18 18 0 0 0 0-36zM50 42a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
  },
  {
    id: 'leaf',
    group: 'symbol',
    path: 'M90 6C40 6 12 28 12 62c0 8 4 16 8 22l14-18 4 4-14 20c6 4 12 6 18 6 34 0 50-34 48-90z',
  },
  {
    id: 'drop',
    group: 'symbol',
    path: 'M50 4C34 28 16 46 16 66a34 34 0 0 0 68 0C84 46 66 28 50 4z',
  },
];

export const EMBLEM_IDS: readonly string[] = EMBLEMS.map((e) => e.id);

export function emblemById(id: string): Emblem | undefined {
  return EMBLEMS.find((e) => e.id === id);
}

/** Outline of each token shape in the same 100 x 100 box (centre 50, 50). */
export const SHAPE_PATHS: Readonly<Record<string, string>> = {
  disc: 'M50 3a47 47 0 1 0 0 94 47 47 0 0 0 0-94z',
  hex: 'M50 3l41 23.5v47L50 97 9 73.5v-47z',
  shield: 'M50 3l41 11v32c0 26-16 41-41 51C25 87 9 72 9 46V14z',
  square: 'M18 3h64c8 0 15 7 15 15v64c0 8-7 15-15 15H18C10 97 3 90 3 82V18C3 10 10 3 18 3z',
  diamond: 'M50 2l48 48-48 48L2 50z',
};
