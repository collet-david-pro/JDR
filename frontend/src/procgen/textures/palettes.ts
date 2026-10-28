/** Named colour ramps (dark to light) for the procedural textures. */
import type { Material } from './materials';

export interface PaletteInfo {
  id: string;
  /** French label (not in i18n: displayed by the future Textures tab of P8f). */
  name: string;
  /** Materials this palette suits. */
  materials: readonly Material[];
  /** 0xRRGGBB stops, from dark (low) to light (high). */
  colors: readonly number[];
}

const p = (
  id: string,
  name: string,
  materials: Material[],
  colors: number[],
): [string, PaletteInfo] => [id, { id, name, materials, colors }];

export const PALETTES: Readonly<Record<string, PaletteInfo>> = Object.freeze(
  Object.fromEntries([
    p('stone_grey', 'Pierre grise', ['stone'], [0x4a4c52, 0x6b6d73, 0x8a8c92, 0xa9abb0]),
    p('cave', 'Caverne', ['stone'], [0x1f2024, 0x30323a, 0x41444d, 0x575a65]),
    p('flag_grey', 'Dalles grises', ['flagstone'], [0x2e2f33, 0x70727a, 0x8c8e96, 0xaaacb4]),
    p('flag_sand', 'Dalles ocre', ['flagstone'], [0x3a3226, 0x9c8c6c, 0xb9a982, 0xd2c49c]),
    p('cobble_grey', 'Pavés gris', ['cobble'], [0x26272b, 0x5f6168, 0x7c7e86, 0x9a9ca4]),
    p('cobble_brown', 'Pavés bruns', ['cobble'], [0x2b2118, 0x6d5a46, 0x8a7459, 0xa68f70]),
    p('oak', 'Chêne', ['wood'], [0x2a1a0e, 0x6b4423, 0x8b5e34, 0xa87746]),
    p('dark_wood', 'Bois sombre', ['wood'], [0x150d07, 0x3b2414, 0x543520, 0x6e4a2e]),
    p('meadow', 'Prairie', ['grass'], [0x20481c, 0x356b2a, 0x4c8a38, 0x6aa84a]),
    p('dry_grass', 'Herbe sèche', ['grass'], [0x5a4f26, 0x7d7036, 0x9e9048, 0xbfb05f]),
    p('earth', 'Terre', ['dirt'], [0x3a2a1c, 0x5b432c, 0x7a5c3d, 0x987851]),
    p('mud', 'Boue', ['dirt'], [0x20160e, 0x3a2918, 0x4d3822, 0x624830]),
    p('dune', 'Dune', ['sand'], [0x9c8250, 0xc2a86f, 0xd8c088, 0xe8d6a4]),
    p('snow', 'Neige', ['sand', 'ice'], [0xb4c4d8, 0xd0dcec, 0xe6eefa, 0xf8fbff]),
    p('water_blue', 'Eau claire', ['water'], [0x1b4f8c, 0x2a6fb5, 0x4a93d4, 0xa6d4f2]),
    p('deep_water', 'Eau profonde', ['water'], [0x08203f, 0x0f3463, 0x174a86, 0x2b69ae]),
    p('lava', 'Lave', ['lava'], [0x1a0803, 0x5a1405, 0xc8350a, 0xff8a1c, 0xffe27a]),
    p('ice_blue', 'Glace', ['ice'], [0x6aa0c8, 0x9cc6e2, 0xc4e2f2, 0xeaf7fd]),
  ]),
);
