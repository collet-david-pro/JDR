<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

use JDR\Domain\Games\Fields;

/**
 * Rules of the P9 objects tied to notes (etapes P09 D3, D4), pure, called from ObjectRules:
 * - pin {x, y}; props {icon, color, note}; layer: any object layer but gm; visibility free
 *   (default gm), but a pin with a note follows the note (PlayerFilter);
 * - zone {polygon: [{x, y}, ...] (3-200)}; props {kind: description, note, show_on_enter};
 *   layer gm and visibility gm imposed: never sent to a player nor a screen;
 * - trap {x, y} | {polygon}; props {note, reveal_effect: pulse | none}; layer: not gm; visibility
 *   hidden_until_revealed imposed;
 * - secret: kind passage {a, b} (same points as a door) on the layer walls, kind room | object
 *   {polygon} on any layer but gm; props {kind, note}; visibility hidden_until_revealed imposed.
 * props.note is the uid of a note of the map or null (MapNotesOps checks that it exists).
 * Optional when adding: layer, visibility, locked, sort_order, and props note, show_on_enter,
 * reveal_effect, zone kind. Errors: required | invalid | too_small | too_large | too_many.
 */
final class ObjectRulesNotes
{
    public const TYPES = ['pin', 'zone', 'trap', 'secret'];
    public const PIN_ICONS = ['place', 'danger', 'treasure', 'npc', 'info'];
    public const ZONE_KINDS = ['description'];
    public const REVEAL_EFFECTS = ['pulse', 'none'];
    public const SECRET_KINDS = ['passage', 'room', 'object'];
    public const POLYGON_MIN = 3;
    public const POLYGON_MAX = 200;
    public const OBJECT_LAYER = 'props';
    public const HIDDEN = 'hidden_until_revealed';

    /**
     * Tells whether the object type is a note type.
     */
    public static function handles(mixed $type): bool
    {
        return is_string($type) && in_array($type, self::TYPES, true);
    }

    /**
     * Fills the members that may be omitted (layer, visibility, locked, sort_order).
     *
     * @param array<string, mixed> $o raw object
     * @return array<string, mixed>
     */
    public static function withDefaults(array $o): array
    {
        $type = $o['type'] ?? null;
        if (!self::handles($type)) {
            return $o;
        }
        $passage = $type === 'secret' && is_array($o['props'] ?? null) && ($o['props']['kind'] ?? null) === 'passage';
        $o += [
            'layer' => $type === 'zone' ? 'gm' : ($passage ? 'walls' : self::OBJECT_LAYER),
            'visibility' => $type === 'zone' || $type === 'pin' ? 'gm' : self::HIDDEN,
            'locked' => false,
            'sort_order' => 0,
        ];

        return $o;
    }

    /**
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    public static function geometry(string $type, mixed $value, string $field, array &$errors, float $width, float $height): ?array
    {
        $g = Fields::object($value, ['x', 'y', 'a', 'b', 'polygon']);
        if ($g === null) {
            $errors[$field] = 'invalid';

            return null;
        }
        $shape = match (true) {
            array_key_exists('polygon', $g) => 'polygon',
            array_key_exists('a', $g), array_key_exists('b', $g) => 'segment',
            default => 'point',
        };
        $allowed = match ($type) {
            'pin' => ['point'],
            'zone' => ['polygon'],
            'trap' => ['point', 'polygon'],
            default => ['segment', 'polygon'],
        };
        $expected = in_array($shape, $allowed, true) ? $shape : $allowed[0];
        $keys = ['point' => ['x', 'y'], 'segment' => ['a', 'b'], 'polygon' => ['polygon']][$expected];
        if ($shape !== $expected || array_diff(array_keys($g), $keys) !== []) {
            $errors[$field] = 'invalid';

            return null;
        }
        foreach ($keys as $key) {
            if (!array_key_exists($key, $g)) {
                $errors[$field . '.' . $key] = 'required';

                return null;
            }
        }

        return match ($expected) {
            'point' => self::point($g, $field, $errors, $width, $height),
            'segment' => self::segment($g, $field, $errors, $width, $height),
            default => self::polygon($g['polygon'], $field . '.polygon', $errors, $width, $height),
        };
    }

    /**
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    public static function props(string $type, mixed $value, string $field, array &$errors): ?array
    {
        $keys = match ($type) {
            'pin' => ['icon', 'color', 'note'],
            'zone' => ['kind', 'note', 'show_on_enter'],
            'trap' => ['note', 'reveal_effect'],
            default => ['kind', 'note'],
        };
        $p = Fields::object($value, $keys);
        if ($p === null) {
            $errors[$field] = 'invalid';

            return null;
        }
        $before = count($errors);
        $out = [];
        foreach ($keys as $key) {
            $f = $field . '.' . $key;
            $v = $p[$key] ?? null;
            $out[$key] = match ($key) {
                'icon' => self::choice($v, self::PIN_ICONS, null, $f, $errors),
                'color' => self::color($v, $f, $errors),
                'note' => self::note($v, $f, $errors),
                'show_on_enter' => self::flag($v, $f, $errors),
                'reveal_effect' => self::choice($v, self::REVEAL_EFFECTS, self::REVEAL_EFFECTS[0], $f, $errors),
                default => $type === 'zone'
                    ? self::choice($v, self::ZONE_KINDS, self::ZONE_KINDS[0], $f, $errors)
                    : self::choice($v, self::SECRET_KINDS, null, $f, $errors),
            };
        }

        return count($errors) === $before ? $out : null;
    }

    /**
     * Layer, visibility and shape imposed by the type (object.add, object.update, document).
     *
     * @param array<string, mixed>  $geometry
     * @param array<string, mixed>  $props
     * @param array<string, string> $errors
     */
    public static function enforce(string $type, mixed $layer, mixed $visibility, array $geometry, array $props, string $field, array &$errors): void
    {
        $passage = $type === 'secret' && ($props['kind'] ?? null) === 'passage';
        if ($type === 'secret' && $passage !== array_key_exists('a', $geometry)) {
            $errors[$field . '.geometry'] = 'invalid';
        }
        $layerOk = match (true) {
            $type === 'zone' => $layer === 'gm',
            $passage => $layer === 'walls',
            default => $layer !== 'gm',
        };
        if (!$layerOk) {
            $errors[$field . '.layer'] = 'invalid';
        }
        $visibilityOk = match ($type) {
            'zone' => $visibility === 'gm',
            'pin' => true,
            default => $visibility === self::HIDDEN,
        };
        if (!$visibilityOk) {
            $errors[$field . '.visibility'] = 'invalid';
        }
    }

    /**
     * Bounding box of the (normalized) geometry, bounded to the map.
     *
     * @param array<string, mixed> $object
     * @return array{0: float, 1: float, 2: float, 3: float}
     */
    public static function bbox(array $object, float $width, float $height): array
    {
        $g = $object['geometry'];
        if (isset($g['polygon'])) {
            $xs = array_column($g['polygon'], 'x');
            $ys = array_column($g['polygon'], 'y');
        } elseif (isset($g['a'])) {
            $xs = [$g['a'][0], $g['b'][0]];
            $ys = [$g['a'][1], $g['b'][1]];
        } else {
            $xs = [$g['x']];
            $ys = [$g['y']];
        }
        $clamp = static fn (float $v, float $max): float => round(max(0.0, min($max, $v)), 3);

        return [
            $clamp((float) min($xs), $width),
            $clamp((float) min($ys), $height),
            $clamp((float) max($xs), $width),
            $clamp((float) max($ys), $height),
        ];
    }

    /**
     * Is the point inside the polygon [{x, y}, ...] (even-odd rule; the edges count as inside)?
     *
     * @param list<array{x: int|float, y: int|float}> $polygon
     */
    public static function contains(array $polygon, float $x, float $y): bool
    {
        $inside = false;
        $n = count($polygon);
        for ($i = 0, $j = $n - 1; $i < $n; $j = $i++) {
            $xi = (float) $polygon[$i]['x'];
            $yi = (float) $polygon[$i]['y'];
            $xj = (float) $polygon[$j]['x'];
            $yj = (float) $polygon[$j]['y'];
            $cross = ($xj - $xi) * ($y - $yi) - ($yj - $yi) * ($x - $xi);
            if (abs($cross) < 1e-9 && $x >= min($xi, $xj) && $x <= max($xi, $xj) && $y >= min($yi, $yj) && $y <= max($yi, $yj)) {
                return true;
            }
            if (($yi > $y) !== ($yj > $y) && $x < ($xj - $xi) * ($y - $yi) / ($yj - $yi) + $xi) {
                $inside = !$inside;
            }
        }

        return $inside;
    }

    /**
     * @param array<string, mixed>  $g
     * @param array<string, string> $errors
     * @return array{x: int|float, y: int|float}|null
     */
    private static function point(array $g, string $field, array &$errors, float $width, float $height): ?array
    {
        $x = ObjectRules::coordinate($g['x'], $field . '.x', $errors, $width);
        $y = ObjectRules::coordinate($g['y'], $field . '.y', $errors, $height);

        return $x === null || $y === null ? null : ['x' => $x, 'y' => $y];
    }

    /**
     * @param array<string, mixed>  $g
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    private static function segment(array $g, string $field, array &$errors, float $width, float $height): ?array
    {
        $a = ObjectRules::point($g['a'], $field . '.a', $errors, $width, $height);
        $b = ObjectRules::point($g['b'], $field . '.b', $errors, $width, $height);
        if ($a === null || $b === null) {
            return null;
        }
        $length = hypot($b[0] - $a[0], $b[1] - $a[1]);
        if ($length < ObjectRules::SEGMENT_MIN - 1e-9 || $length > ObjectRules::SEGMENT_MAX + 1e-9) {
            $errors[$field] = $length < ObjectRules::SEGMENT_MIN ? 'too_small' : 'too_large';

            return null;
        }

        return ['a' => $a, 'b' => $b];
    }

    /**
     * @param array<string, string> $errors
     * @return array{polygon: list<array{x: int|float, y: int|float}>}|null
     */
    private static function polygon(mixed $value, string $field, array &$errors, float $width, float $height): ?array
    {
        if (!is_array($value) || !array_is_list($value)) {
            $errors[$field] = 'invalid';

            return null;
        }
        if (count($value) < self::POLYGON_MIN || count($value) > self::POLYGON_MAX) {
            $errors[$field] = count($value) < self::POLYGON_MIN ? 'too_small' : 'too_many';

            return null;
        }
        $out = [];
        foreach ($value as $i => $point) {
            $p = Fields::object($point, ['x', 'y']);
            if ($p === null || !array_key_exists('x', $p) || !array_key_exists('y', $p)) {
                $errors[$field . '.' . $i] = 'invalid';

                return null;
            }
            $checked = self::point($p, $field . '.' . $i, $errors, $width, $height);
            if ($checked === null) {
                return null;
            }
            $out[] = $checked;
        }

        return ['polygon' => $out];
    }

    /**
     * @param list<string>          $values
     * @param array<string, string> $errors
     */
    private static function choice(mixed $value, array $values, ?string $default, string $field, array &$errors): ?string
    {
        if ($value === null) {
            if ($default === null) {
                $errors[$field] = 'required';
            }

            return $default;
        }
        if (!is_string($value) || !in_array($value, $values, true)) {
            $errors[$field] = 'invalid';

            return null;
        }

        return $value;
    }

    /**
     * @param array<string, string> $errors
     */
    private static function color(mixed $value, string $field, array &$errors): ?string
    {
        $color = Fields::color($value);
        if ($color === null) {
            $errors[$field] = $value === null ? 'required' : 'invalid';
        }

        return $color;
    }

    /**
     * @param array<string, string> $errors
     */
    private static function note(mixed $value, string $field, array &$errors): ?string
    {
        if ($value !== null && !ObjectRules::isUid($value)) {
            $errors[$field] = 'invalid';

            return null;
        }

        return $value;
    }

    /**
     * @param array<string, string> $errors
     */
    private static function flag(mixed $value, string $field, array &$errors): bool
    {
        if ($value !== null && !is_bool($value)) {
            $errors[$field] = 'invalid';
        }

        return $value === true;
    }
}
