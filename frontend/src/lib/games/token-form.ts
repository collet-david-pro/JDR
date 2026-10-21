/**
 * Token definition form (projet.md 2.2, 7.2 `tokens`): purely visual data, no game rule.
 * The form edits strings (what the inputs hold); `validateToken` checks the bounds and
 * builds the payload of POST /games/{id}/tokens and PATCH /tokens/{id}.
 */

import type { FieldErrors } from '../validation';
import { TOKEN_KINDS, type Token, type TokenInput, type TokenKind } from '../types';
import { numberToInput, parseDecimal, roundTo } from './units';

export const TOKEN_NAME_MAX = 80;
/** Size in cells (DECIMAL(4,2)). */
export const TOKEN_SIZE_MIN = 0.25;
export const TOKEN_SIZE_MAX = 20;
/** Vision and light distances, in cells. */
export const DISTANCE_MAX = 1000;

export const DEFAULT_VISION = { enabled: true, range: 12, dark: 0 } as const;
export const DEFAULT_LIGHT = {
  radius: 4,
  dim_radius: 8,
  color: '#ffcc66',
  intensity: 0.8,
  flicker: false,
} as const;
export const DEFAULT_RING_COLOR = '#2f5bd3';

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export interface TokenDraft {
  name: string;
  asset_id: string | null;
  /** Preview of the chosen image (signed thumbnail URL). */
  image_url: string | null;
  kind: TokenKind;
  size_w: string;
  size_h: string;
  /** '' = nobody. */
  owner: string;
  vision_enabled: boolean;
  vision_range: string;
  vision_dark: string;
  light_enabled: boolean;
  light_radius: string;
  light_dim_radius: string;
  light_color: string;
  light_intensity: string;
  light_flicker: boolean;
  ring_enabled: boolean;
  ring_color: string;
}

export function isTokenKind(value: string): value is TokenKind {
  return (TOKEN_KINDS as readonly string[]).includes(value);
}

/** True for "#rrggbb" (case-insensitive). */
export function isHexColor(value: string): boolean {
  return COLOR_PATTERN.test(value.trim());
}

/** "#AbC123" → "#abc123"; null when invalid. */
export function normalizeColor(value: string): string | null {
  const v = value.trim();
  return COLOR_PATTERN.test(v) ? v.toLowerCase() : null;
}

/** Empty form (new token). */
export function emptyTokenDraft(kind: TokenKind = 'pc'): TokenDraft {
  return {
    name: '',
    asset_id: null,
    image_url: null,
    kind,
    size_w: '1',
    size_h: '1',
    owner: '',
    vision_enabled: DEFAULT_VISION.enabled,
    vision_range: String(DEFAULT_VISION.range),
    vision_dark: String(DEFAULT_VISION.dark),
    light_enabled: false,
    light_radius: String(DEFAULT_LIGHT.radius),
    light_dim_radius: String(DEFAULT_LIGHT.dim_radius),
    light_color: DEFAULT_LIGHT.color,
    light_intensity: String(DEFAULT_LIGHT.intensity),
    light_flicker: DEFAULT_LIGHT.flicker,
    ring_enabled: false,
    ring_color: DEFAULT_RING_COLOR,
  };
}

/** Form of an existing token. */
export function tokenToDraft(token: Token): TokenDraft {
  const light = token.light;
  return {
    name: token.name,
    asset_id: token.asset_id,
    image_url: token.image?.thumb ?? null,
    kind: token.kind,
    size_w: numberToInput(token.size_w, 2),
    size_h: numberToInput(token.size_h, 2),
    owner: token.default_owner_user_id ?? '',
    vision_enabled: token.vision.enabled,
    vision_range: numberToInput(token.vision.range),
    vision_dark: numberToInput(token.vision.dark),
    light_enabled: light !== null,
    light_radius: numberToInput(light?.radius ?? DEFAULT_LIGHT.radius),
    light_dim_radius: numberToInput(light?.dim_radius ?? DEFAULT_LIGHT.dim_radius),
    light_color: light?.color ?? DEFAULT_LIGHT.color,
    light_intensity: numberToInput(light?.intensity ?? DEFAULT_LIGHT.intensity, 2),
    light_flicker: light?.flicker ?? DEFAULT_LIGHT.flicker,
    ring_enabled: token.ring_color !== null,
    ring_color: token.ring_color ?? DEFAULT_RING_COLOR,
  };
}

/** Field error codes (i18n `validation.<code>` or `validation.fields.<field>.<code>`). */
export type NumberCheck =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly code: 'required' | 'invalid' | 'too_small' | 'too_large' };

/** Parses a bounded decimal field. */
export function checkNumber(text: string, min: number, max: number, decimals = 3): NumberCheck {
  if (text.trim() === '') return { ok: false, code: 'required' };
  const value = parseDecimal(text);
  if (value === null) return { ok: false, code: 'invalid' };
  const rounded = roundTo(value, decimals);
  if (rounded < min) return { ok: false, code: 'too_small' };
  if (rounded > max) return { ok: false, code: 'too_large' };
  return { ok: true, value: rounded };
}

export type TokenValidation =
  | { readonly ok: true; readonly input: TokenInput }
  | { readonly ok: false; readonly errors: FieldErrors };

/**
 * Validates the draft. Field names match the API payload where possible so that server
 * 422 errors land on the same inputs (see TOKEN_FIELD_RENAME).
 */
export function validateToken(draft: TokenDraft): TokenValidation {
  const errors: Record<string, string> = {};
  const name = draft.name.trim();
  if (name === '') errors['name'] = 'required';
  else if ([...name].length > TOKEN_NAME_MAX) errors['name'] = 'too_long';
  if (!isTokenKind(draft.kind)) errors['kind'] = 'invalid';

  const number = (field: string, text: string, min: number, max: number, decimals = 3) => {
    const result = checkNumber(text, min, max, decimals);
    if (!result.ok) {
      errors[field] = result.code;
      return 0;
    }
    return result.value;
  };

  const sizeW = number('size_w', draft.size_w, TOKEN_SIZE_MIN, TOKEN_SIZE_MAX, 2);
  const sizeH = number('size_h', draft.size_h, TOKEN_SIZE_MIN, TOKEN_SIZE_MAX, 2);

  // Vision distances are kept (and checked) even when vision is disabled.
  const range = number('vision_range', draft.vision_range, 0, DISTANCE_MAX);
  const dark = number('vision_dark', draft.vision_dark, 0, DISTANCE_MAX);

  let light: TokenInput['light'] = null;
  if (draft.light_enabled) {
    const radius = number('light_radius', draft.light_radius, 0, DISTANCE_MAX);
    const dim = number('light_dim_radius', draft.light_dim_radius, 0, DISTANCE_MAX);
    if (errors['light_radius'] === undefined && errors['light_dim_radius'] === undefined) {
      if (dim < radius) errors['light_dim_radius'] = 'below_radius';
    }
    const intensity = number('light_intensity', draft.light_intensity, 0, 1, 2);
    const color = normalizeColor(draft.light_color);
    if (color === null) errors['light_color'] = 'invalid';
    light = {
      radius,
      dim_radius: dim,
      color: color ?? '',
      intensity,
      flicker: draft.light_flicker,
    };
  }

  let ring: string | null = null;
  if (draft.ring_enabled) {
    ring = normalizeColor(draft.ring_color);
    if (ring === null) errors['ring_color'] = 'invalid';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      name,
      asset_id: draft.asset_id,
      kind: draft.kind,
      size_w: sizeW,
      size_h: sizeH,
      default_owner_user_id: draft.owner === '' ? null : draft.owner,
      vision: { enabled: draft.vision_enabled, range, dark },
      light,
      ring_color: ring,
    },
  };
}

/** Server field names (422 `fields`) → form field names. */
export const TOKEN_FIELD_RENAME: Readonly<Record<string, string>> = {
  default_owner_user_id: 'owner',
  'vision.range': 'vision_range',
  'vision.dark': 'vision_dark',
  'light.radius': 'light_radius',
  'light.dim_radius': 'light_dim_radius',
  'light.color': 'light_color',
  'light.intensity': 'light_intensity',
};
