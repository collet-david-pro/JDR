/** French labels of the P5 editor parts (i18n keys written literally for the key check). */
import type {
  MapObjectType,
  ObjectVisibility,
  WallKind,
  WeatherType,
  WindowProps,
} from '../contracts';
import type { FogShape, LightPresetId } from '../tools/types';
import { t } from '../../lib/i18n';

export const WALL_KINDS: readonly WallKind[] = [
  'stone',
  'brick',
  'wood',
  'metal',
  'natural',
  'invisible',
];
export const WINDOW_KINDS: readonly WindowProps['kind'][] = ['glass', 'bars', 'opening'];
export const FOG_SHAPES: readonly FogShape[] = ['brush', 'rect', 'room'];
export const WEATHER_TYPES: readonly WeatherType[] = ['none', 'rain', 'snow', 'fog', 'storm'];
export const VISIBILITIES: readonly ObjectVisibility[] = ['all', 'gm', 'hidden_until_revealed'];

export function wallKindLabel(kind: WallKind): string {
  switch (kind) {
    case 'stone':
      return t('editor.objects.wall_kinds.stone');
    case 'brick':
      return t('editor.objects.wall_kinds.brick');
    case 'wood':
      return t('editor.objects.wall_kinds.wood');
    case 'metal':
      return t('editor.objects.wall_kinds.metal');
    case 'natural':
      return t('editor.objects.wall_kinds.natural');
    case 'invisible':
      return t('editor.objects.wall_kinds.invisible');
  }
}

export function windowKindLabel(kind: WindowProps['kind']): string {
  switch (kind) {
    case 'glass':
      return t('editor.objects.window_kinds.glass');
    case 'bars':
      return t('editor.objects.window_kinds.bars');
    case 'opening':
      return t('editor.objects.window_kinds.opening');
  }
}

export function lightPresetLabel(id: LightPresetId): string {
  switch (id) {
    case 'torch':
      return t('editor.objects.light_presets.torch');
    case 'lantern':
      return t('editor.objects.light_presets.lantern');
    case 'candle':
      return t('editor.objects.light_presets.candle');
    case 'campfire':
      return t('editor.objects.light_presets.campfire');
    case 'magic':
      return t('editor.objects.light_presets.magic');
  }
}

export function fogShapeLabel(shape: FogShape): string {
  switch (shape) {
    case 'brush':
      return t('editor.options.fog_shapes.brush');
    case 'rect':
      return t('editor.options.fog_shapes.rect');
    case 'room':
      return t('editor.options.fog_shapes.room');
  }
}

export function objectTypeLabel(type: MapObjectType | 'token'): string {
  switch (type) {
    case 'wall':
      return t('editor.objects.types.wall');
    case 'door':
      return t('editor.objects.types.door');
    case 'window':
      return t('editor.objects.types.window');
    case 'light':
      return t('editor.objects.types.light');
    case 'token':
      return t('editor.objects.types.token');
  }
}

export function visibilityLabel(v: ObjectVisibility): string {
  switch (v) {
    case 'all':
      return t('editor.objects.visibility.all');
    case 'gm':
      return t('editor.objects.visibility.gm');
    case 'hidden_until_revealed':
      return t('editor.objects.visibility.hidden_until_revealed');
  }
}

export function weatherLabel(type: WeatherType): string {
  switch (type) {
    case 'none':
      return t('editor.ambient.weather_types.none');
    case 'rain':
      return t('editor.ambient.weather_types.rain');
    case 'snow':
      return t('editor.ambient.weather_types.snow');
    case 'fog':
      return t('editor.ambient.weather_types.fog');
    case 'storm':
      return t('editor.ambient.weather_types.storm');
  }
}

export function swingLabel(swing: 'a' | 'b' | 'slide'): string {
  switch (swing) {
    case 'a':
      return t('editor.objects.swing.a');
    case 'b':
      return t('editor.objects.swing.b');
    case 'slide':
      return t('editor.objects.swing.slide');
  }
}

export function flickerLabel(type: 'none' | 'torch' | 'pulse'): string {
  switch (type) {
    case 'none':
      return t('editor.objects.flicker.none');
    case 'torch':
      return t('editor.objects.flicker.torch');
    case 'pulse':
      return t('editor.objects.flicker.pulse');
  }
}

/** Text of a selectable item of the keyboard list ("Mur (3, 4)", "Token Aria (2.5, 7.5)"). */
export function sceneItemLabel(item: {
  readonly kind: MapObjectType | 'token';
  readonly name: string | null;
  readonly x: number;
  readonly y: number;
}): string {
  const x = Math.round(item.x * 10) / 10;
  const y = Math.round(item.y * 10) / 10;
  return item.name === null
    ? t('editor.objects.item', { type: objectTypeLabel(item.kind), x, y })
    : t('editor.objects.item_named', { type: objectTypeLabel(item.kind), name: item.name, x, y });
}
