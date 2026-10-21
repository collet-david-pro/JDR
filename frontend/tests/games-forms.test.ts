import { describe, expect, it } from 'vitest';
import {
  applyGamePatch,
  checkGameName,
  gamePatch,
  gameToDraft,
  validateGameDraft,
} from '../src/lib/games/game-form';
import {
  checkNumber,
  emptyTokenDraft,
  isHexColor,
  normalizeColor,
  tokenToDraft,
  validateToken,
  type TokenDraft,
} from '../src/lib/games/token-form';
import {
  cellsToUnits,
  formatCellDistance,
  parseDecimal,
  unitsToCells,
} from '../src/lib/games/units';
import { makeGame, makeToken } from './fixtures/games';

const draft = (overrides: Partial<TokenDraft> = {}): TokenDraft => ({
  ...emptyTokenDraft(),
  name: 'Gobelin',
  ...overrides,
});

function errorsOf(d: TokenDraft): Record<string, string> {
  const result = validateToken(d);
  return result.ok ? {} : { ...result.errors };
}

describe('units', () => {
  it('parses decimals typed with a comma or a dot', () => {
    expect(parseDecimal('1,5')).toBe(1.5);
    expect(parseDecimal(' 2.25 ')).toBe(2.25);
    expect(parseDecimal('-3')).toBe(-3);
    expect(parseDecimal('.5')).toBe(0.5);
    for (const bad of ['', 'abc', '1e3', '1 000', 'NaN', 'Infinity', '1,2,3']) {
      expect(parseDecimal(bad)).toBeNull();
    }
  });

  it('converts cells to game units and back', () => {
    const ft = { unit_label: 'ft', unit_per_cell: 5 };
    const m = { unit_label: 'm', unit_per_cell: 1.5 };
    expect(cellsToUnits(12, ft)).toBe(60);
    expect(cellsToUnits(3, m)).toBe(4.5);
    expect(cellsToUnits(0.1, { unit_label: 'm', unit_per_cell: 0.2 })).toBe(0.02);
    expect(unitsToCells(60, ft)).toBe(12);
    expect(unitsToCells(10, m)).toBe(6.667);
    expect(unitsToCells(10, { unit_label: 'm', unit_per_cell: 0 })).toBeNull();
  });

  it('formats a distance in cells with the unit of the game', () => {
    const settings = { unit_label: 'm', unit_per_cell: 1.5 };
    expect(formatCellDistance(12, settings)).toBe('18 m');
    expect(formatCellDistance('3', settings)).toBe('4,5 m');
    expect(formatCellDistance('x', settings)).toBe('');
  });
});

describe('token form', () => {
  it('builds the API payload of a valid draft', () => {
    const result = validateToken(
      draft({
        name: '  Gobelin  ',
        size_w: '1,5',
        size_h: '2',
        owner: '2',
        vision_range: '12',
        vision_dark: '12',
        light_enabled: true,
        light_radius: '4',
        light_dim_radius: '8',
        light_color: '#FFCC66',
        light_intensity: '0,8',
        light_flicker: true,
        ring_enabled: true,
        ring_color: '#2F5BD3',
      }),
    );
    expect(result).toEqual({
      ok: true,
      input: {
        name: 'Gobelin',
        asset_id: null,
        kind: 'pc',
        size_w: 1.5,
        size_h: 2,
        default_owner_user_id: '2',
        vision: { enabled: true, range: 12, dark: 12 },
        light: { radius: 4, dim_radius: 8, color: '#ffcc66', intensity: 0.8, flicker: true },
        ring_color: '#2f5bd3',
      },
    });
  });

  it('sends null light, ring and owner when disabled or empty', () => {
    const result = validateToken(draft({ light_color: 'bad', ring_color: 'bad' }));
    expect(result.ok && result.input).toMatchObject({
      light: null,
      ring_color: null,
      default_owner_user_id: null,
    });
  });

  it('checks the name', () => {
    expect(errorsOf(draft({ name: '   ' }))).toEqual({ name: 'required' });
    expect(errorsOf(draft({ name: 'x'.repeat(81) }))).toEqual({ name: 'too_long' });
    expect(errorsOf(draft({ name: 'é'.repeat(80) }))).toEqual({});
  });

  it('checks the size bounds (0.25 to 20 cells)', () => {
    expect(errorsOf(draft({ size_w: '0,25', size_h: '20' }))).toEqual({});
    expect(errorsOf(draft({ size_w: '0.2', size_h: '20.5' }))).toEqual({
      size_w: 'too_small',
      size_h: 'too_large',
    });
    expect(errorsOf(draft({ size_w: '', size_h: 'deux' }))).toEqual({
      size_w: 'required',
      size_h: 'invalid',
    });
  });

  it('checks vision and light distances (0 to 1000 cells)', () => {
    expect(errorsOf(draft({ vision_range: '-1', vision_dark: '1001' }))).toEqual({
      vision_range: 'too_small',
      vision_dark: 'too_large',
    });
    expect(
      errorsOf(draft({ light_enabled: true, light_radius: '6', light_dim_radius: '4' })),
    ).toEqual({ light_dim_radius: 'below_radius' });
    expect(
      errorsOf(draft({ light_enabled: true, light_radius: '4', light_dim_radius: '4' })),
    ).toEqual({});
  });

  it('checks the intensity (0 to 1) and the colours', () => {
    expect(
      errorsOf(
        draft({
          light_enabled: true,
          light_intensity: '1,5',
          light_color: '#fff',
          ring_enabled: true,
          ring_color: 'red',
        }),
      ),
    ).toEqual({ light_intensity: 'too_large', light_color: 'invalid', ring_color: 'invalid' });
  });

  it('round-trips an existing token through the draft', () => {
    const token = makeToken({
      size_w: 2,
      size_h: 0.5,
      default_owner_user_id: '2',
      vision: { enabled: false, range: 6, dark: 3 },
      light: { radius: 2, dim_radius: 5.5, color: '#aabbcc', intensity: 0.25, flicker: false },
      ring_color: '#112233',
      image: { full: '/f', thumb: '/t' },
      asset_id: '9',
    });
    const d = tokenToDraft(token);
    expect(d.image_url).toBe('/t');
    expect(d.light_dim_radius).toBe('5.5');
    const result = validateToken(d);
    expect(result.ok && result.input).toEqual({
      name: token.name,
      asset_id: '9',
      kind: token.kind,
      size_w: 2,
      size_h: 0.5,
      default_owner_user_id: '2',
      vision: token.vision,
      light: token.light,
      ring_color: '#112233',
    });
  });

  it('validates colours and bounded numbers', () => {
    expect(isHexColor('#A1b2C3')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    expect(isHexColor('a1b2c3')).toBe(false);
    expect(normalizeColor(' #A1B2C3 ')).toBe('#a1b2c3');
    expect(normalizeColor('#12345g')).toBeNull();
    expect(checkNumber('0,123456', 0, 1)).toEqual({ ok: true, value: 0.123 });
    expect(checkNumber('5', 0, 1)).toEqual({ ok: false, code: 'too_large' });
  });
});

describe('game form', () => {
  it('checks the name', () => {
    expect(checkGameName(' ')).toBe('required');
    expect(checkGameName('x'.repeat(121))).toBe('too_long');
    expect(checkGameName('Campagne')).toBeNull();
  });

  it('validates the settings bounds', () => {
    const base = gameToDraft(makeGame());
    expect(validateGameDraft(base).ok).toBe(true);
    const result = validateGameDraft({
      ...base,
      unit_label: 'x'.repeat(11),
      unit_per_cell: '0',
      default_cell_px: '70.5',
    });
    expect(result).toEqual({
      ok: false,
      errors: { unit_label: 'too_long', unit_per_cell: 'too_small', default_cell_px: 'invalid' },
    });
    expect(
      validateGameDraft({ ...base, unit_per_cell: '10000', default_cell_px: '513' }),
    ).toMatchObject({
      errors: { unit_per_cell: 'too_large', default_cell_px: 'too_large' },
    });
    expect(validateGameDraft({ ...base, default_cell_px: '15' })).toMatchObject({
      errors: { default_cell_px: 'too_small' },
    });
  });

  it('sends only the changed members (partial settings)', () => {
    const game = makeGame({ description: null });
    const result = validateGameDraft({
      ...gameToDraft(game),
      name: ' Nouvelle ',
      fog_strict: false,
      unit_per_cell: '1,5',
      unit_label: 'm',
    });
    if (!result.ok) throw new Error('invalid');
    expect(
      gamePatch(game, {
        name: result.name,
        description: result.description,
        cover_asset_id: null,
        settings: result.settings,
      }),
    ).toEqual({
      name: 'Nouvelle',
      settings: { fog_strict: false, unit_label: 'm', unit_per_cell: 1.5 },
    });
  });

  it('returns null when nothing changed and applies a patch locally', () => {
    const game = makeGame();
    expect(
      gamePatch(game, {
        name: game.name,
        description: '',
        cover_asset_id: null,
        settings: game.settings,
      }),
    ).toBeNull();
    const local = applyGamePatch(game, { name: 'B', settings: { unit_label: 'm' } });
    expect(local.name).toBe('B');
    expect(local.settings).toEqual({ ...game.settings, unit_label: 'm' });
  });
});
