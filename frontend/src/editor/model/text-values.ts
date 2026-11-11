/** Text objects: props normalisation (same rules as app/Maps/ObjectRulesText.php). */
import {
  TEXT_FONTS,
  TEXT_MAX,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  type TextProps,
} from '../contracts-text';
import { MapOpError } from './ops';

function bad(message: string): never {
  throw new MapOpError('bad_object', message);
}

function num(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) bad(`Invalid ${what}`);
  return v;
}

/** Validated copy of the props of a text object (text trimmed, single line, 1-200 characters). */
export function textProps(p: unknown): TextProps {
  const q = p as Partial<Record<keyof TextProps, unknown>>;
  if (typeof q.text !== 'string') bad('Invalid text');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(q.text.trim())) bad('Invalid text');
  const text = q.text.trim();
  if (text === '' || [...text].length > TEXT_MAX) bad('Invalid text');
  if (typeof q.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(q.color)) bad('Invalid color');
  if (typeof q.font !== 'string' || !(TEXT_FONTS as readonly string[]).includes(q.font)) {
    bad('Invalid font');
  }
  return {
    text,
    size: Math.round(num(q.size, TEXT_SIZE_MIN, TEXT_SIZE_MAX, 'size') * 1000) / 1000,
    color: q.color.toLowerCase(),
    font: q.font as TextProps['font'],
    rotation: Math.round(num(q.rotation, -360, 360, 'rotation') * 100) / 100,
  };
}
