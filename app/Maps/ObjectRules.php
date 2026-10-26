<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

use JDR\Domain\Games\Fields;
use JDR\Domain\Maps\MapInput;

/**
 * Pure validation of the map objects of P5 (projet.md 12.4, etapes/P05 "Contrat d'API P5"),
 * shared by the ops (MapOpsInput, OpsApplier) and the map document (MapDocumentValidator).
 * Coordinates in cells, rounded to 3 decimals, inside [0, width] x [0, height].
 *
 * Types: wall {points [[x, y]] 2-1 000, closed}, door / window {a, b} (length 0.1-20),
 * light {x, y}. Every geometry / props key is required (the document accepts a few defaults,
 * see $lenient); unknown keys are refused. Other 12.4 types arrive with P9 (refused until then).
 * texture_asset / asset_open / asset_closed are reserved (null) until P9.
 *
 * Errors are added to $errors as "<field>.<key>[.<sub>]" => required | invalid | too_small |
 * too_large | too_many | below_radius. Normalized values keep the canonical key order (MySQL
 * JSON columns do not keep it: canonical() rebuilds it after a read).
 */
final class ObjectRules
{
    public const TYPES = ['wall', 'door', 'window', 'light'];
    public const VISIBILITIES = ['all', 'gm', 'hidden_until_revealed'];
    public const UID_PATTERN = '/^[A-Za-z0-9_-]{1,21}$/D';
    public const SORT_MAX = 1000000;
    public const MAX_OBJECTS = 20000;
    public const WALL_POINTS_MIN = 2;
    public const WALL_POINTS_MAX = 1000;
    public const WALL_KINDS = ['stone', 'brick', 'wood', 'metal', 'natural', 'invisible'];
    public const THICKNESS_MIN = 0.05;
    public const THICKNESS_MAX = 2.0;
    public const HEIGHT_MAX = 20.0;
    public const SEGMENT_MIN = 0.1;
    public const SEGMENT_MAX = 20.0;
    public const DOOR_STATES = ['open', 'closed'];
    public const DOOR_SWINGS = ['a', 'b', 'slide'];
    public const WINDOW_KINDS = ['glass', 'bars', 'opening'];
    public const LIGHT_RADIUS_MAX = 100.0;
    public const FLICKER_TYPES = ['none', 'torch', 'pulse'];
    public const FLICKER_SPEED_MIN = 0.1;
    public const FLICKER_SPEED_MAX = 10.0;
    public const DEFAULT_LAYERS = ['wall' => 'walls', 'door' => 'walls', 'window' => 'walls', 'light' => 'lighting'];

    /** Keys of an object, in canonical order (API form). */
    public const OBJECT_KEYS = ['uid', 'floor', 'type', 'layer', 'geometry', 'props', 'visibility', 'locked', 'sort_order', 'rev'];
    public const PATCH_KEYS = ['geometry', 'props', 'visibility', 'layer', 'locked', 'sort_order'];

    private const GEOMETRY_KEYS = [
        'wall' => ['points', 'closed'],
        'door' => ['a', 'b'],
        'window' => ['a', 'b'],
        'light' => ['x', 'y'],
    ];
    private const PROPS_KEYS = [
        'wall' => ['kind', 'thickness', 'blocks_vision', 'blocks_light', 'blocks_move', 'texture_asset', 'height'],
        'door' => ['state', 'locked', 'secret', 'asset_open', 'asset_closed', 'swing'],
        'window' => ['kind'],
        'light' => ['radius', 'dim_radius', 'color', 'intensity', 'flicker', 'cone', 'enabled', 'follows_token'],
    ];
    /** Props keys the document may omit (reserved for P9): default null. */
    private const LENIENT_PROPS = ['texture_asset', 'height', 'asset_open', 'asset_closed'];
    private const FLICKER_KEYS = ['type', 'amp', 'speed'];
    private const CONE_KEYS = ['angle', 'direction'];

    /**
     * A full object (object.add, document). The floor is parsed by $floor (op: map floor id,
     * document: floor uid); "rev" is accepted and ignored when $allowRev. $lenient (document):
     * layer (default by type), visibility ("all"), locked (false), sort_order (0) and the
     * reserved props may be omitted.
     *
     * @param \Closure(mixed): (int|string|null) $floor null = invalid
     * @param array<string, string>             $errors
     * @return array{uid: string, floor: int|string, type: string, layer: string, geometry: array<string, mixed>,
     *     props: array<string, mixed>, visibility: string, locked: bool, sort_order: int}|null
     */
    public static function object(
        mixed $value,
        string $field,
        array &$errors,
        float $width,
        float $height,
        \Closure $floor,
        bool $allowRev,
        bool $lenient = false,
    ): ?array {
        $keys = $allowRev ? self::OBJECT_KEYS : array_slice(self::OBJECT_KEYS, 0, -1);
        $o = Fields::object($value, $keys);
        if ($o === null || $o === []) {
            $errors[$field] = 'invalid';

            return null;
        }
        $before = count($errors);
        $uid = self::uid($o, 'uid', $field . '.uid', $errors);
        $floorValue = null;
        if (!array_key_exists('floor', $o)) {
            $errors[$field . '.floor'] = 'required';
        } else {
            $floorValue = $floor($o['floor']);
            if ($floorValue === null) {
                $errors[$field . '.floor'] = 'invalid';
            }
        }
        $type = $o['type'] ?? null;
        if (!is_string($type) || !in_array($type, self::TYPES, true)) {
            $errors[$field . '.type'] = array_key_exists('type', $o) ? 'invalid' : 'required';
            $type = null;
        }
        $layer = self::defaulted($o, 'layer', $lenient, $type === null ? null : self::DEFAULT_LAYERS[$type], $field, $errors);
        if ($layer !== null && !self::isLayer($layer)) {
            $errors[$field . '.layer'] = 'invalid';
        }
        $visibility = self::defaulted($o, 'visibility', $lenient, 'all', $field, $errors);
        if ($visibility !== null && !self::isVisibility($visibility)) {
            $errors[$field . '.visibility'] = 'invalid';
        }
        $locked = self::defaulted($o, 'locked', $lenient, false, $field, $errors);
        if ($locked !== null && !is_bool($locked)) {
            $errors[$field . '.locked'] = 'invalid';
        }
        $sort = self::defaulted($o, 'sort_order', $lenient, 0, $field, $errors);
        if ($sort !== null) {
            $sort = self::sortOrder($sort, $field . '.sort_order', $errors);
        }
        if (array_key_exists('rev', $o) && Fields::int($o['rev'], 0, PHP_INT_MAX) === null) {
            $errors[$field . '.rev'] = 'invalid';
        }
        $geometry = null;
        $props = null;
        if ($type !== null) {
            if (!array_key_exists('geometry', $o)) {
                $errors[$field . '.geometry'] = 'required';
            } else {
                $geometry = self::geometry($type, $o['geometry'], $field . '.geometry', $errors, $width, $height);
            }
            if (!array_key_exists('props', $o)) {
                $errors[$field . '.props'] = 'required';
            } else {
                $props = self::props($type, $o['props'], $field . '.props', $errors, $lenient);
            }
        }
        if (count($errors) !== $before || $type === null || $geometry === null || $props === null || $uid === null) {
            return null;
        }

        return [
            'uid' => $uid,
            'floor' => $floorValue,
            'type' => $type,
            'layer' => (string) $layer,
            'geometry' => $geometry,
            'props' => $props,
            'visibility' => (string) $visibility,
            'locked' => (bool) $locked,
            'sort_order' => (int) $sort,
        ];
    }

    /**
     * Type-independent part of an object.update patch (non-empty; geometry / props kept raw:
     * applyPatch() checks them against the stored type and the map size).
     *
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    public static function patch(mixed $value, string $field, array &$errors): ?array
    {
        $p = Fields::object($value, self::PATCH_KEYS);
        if ($p === null || $p === []) {
            $errors[$field] = $value === null ? 'required' : 'invalid';

            return null;
        }
        $before = count($errors);
        if (array_key_exists('visibility', $p) && !self::isVisibility($p['visibility'])) {
            $errors[$field . '.visibility'] = 'invalid';
        }
        if (array_key_exists('layer', $p) && !self::isLayer($p['layer'])) {
            $errors[$field . '.layer'] = 'invalid';
        }
        if (array_key_exists('locked', $p) && !is_bool($p['locked'])) {
            $errors[$field . '.locked'] = 'invalid';
        }
        if (array_key_exists('sort_order', $p)) {
            $p['sort_order'] = self::sortOrder($p['sort_order'], $field . '.sort_order', $errors);
        }
        foreach (['geometry', 'props'] as $key) {
            if (array_key_exists($key, $p) && (!is_array($p[$key]) || ($p[$key] !== [] && array_is_list($p[$key])))) {
                $errors[$field . '.' . $key] = 'invalid';
            }
        }

        return count($errors) === $before ? $p : null;
    }

    /**
     * Stored object + patch (from patch()): geometry / props validated for the stored type.
     *
     * @param array<string, mixed>  $object API form
     * @param array<string, mixed>  $patch
     * @param array<string, string> $errors
     * @return array<string, mixed>|null merged object (rev unchanged)
     */
    public static function applyPatch(array $object, array $patch, string $field, array &$errors, float $width, float $height): ?array
    {
        $before = count($errors);
        $type = (string) $object['type'];
        if (array_key_exists('geometry', $patch)) {
            $geometry = self::geometry($type, $patch['geometry'], $field . '.geometry', $errors, $width, $height);
            if ($geometry !== null) {
                $object['geometry'] = $geometry;
            }
        }
        if (array_key_exists('props', $patch)) {
            $props = self::props($type, $patch['props'], $field . '.props', $errors, false);
            if ($props !== null) {
                $object['props'] = $props;
            }
        }
        foreach (['visibility', 'layer', 'locked', 'sort_order'] as $key) {
            if (array_key_exists($key, $patch)) {
                $object[$key] = $patch[$key];
            }
        }

        return count($errors) === $before ? $object : null;
    }

    /**
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    public static function geometry(string $type, mixed $value, string $field, array &$errors, float $width, float $height): ?array
    {
        $g = Fields::object($value, self::GEOMETRY_KEYS[$type]);
        if ($g === null) {
            $errors[$field] = 'invalid';

            return null;
        }
        $before = count($errors);
        foreach (self::GEOMETRY_KEYS[$type] as $key) {
            if (!array_key_exists($key, $g)) {
                $errors[$field . '.' . $key] = 'required';
            }
        }
        if (count($errors) !== $before) {
            return null;
        }
        switch ($type) {
            case 'wall':
                $points = $g['points'];
                if (!is_array($points) || !array_is_list($points)) {
                    $errors[$field . '.points'] = 'invalid';

                    return null;
                }
                if (count($points) < self::WALL_POINTS_MIN) {
                    $errors[$field . '.points'] = 'too_small';

                    return null;
                }
                if (count($points) > self::WALL_POINTS_MAX) {
                    $errors[$field . '.points'] = 'too_many';

                    return null;
                }
                $out = [];
                foreach ($points as $k => $point) {
                    $p = self::point($point, $field . '.points.' . $k, $errors, $width, $height);
                    if ($p === null) {
                        return null;
                    }
                    $out[] = $p;
                }
                if (!is_bool($g['closed'])) {
                    $errors[$field . '.closed'] = 'invalid';

                    return null;
                }

                return ['points' => $out, 'closed' => $g['closed']];
            case 'door':
            case 'window':
                $a = self::point($g['a'], $field . '.a', $errors, $width, $height);
                $b = self::point($g['b'], $field . '.b', $errors, $width, $height);
                if ($a === null || $b === null) {
                    return null;
                }
                $length = hypot($b[0] - $a[0], $b[1] - $a[1]);
                if ($length < self::SEGMENT_MIN - 1e-9 || $length > self::SEGMENT_MAX + 1e-9) {
                    $errors[$field] = $length < self::SEGMENT_MIN ? 'too_small' : 'too_large';

                    return null;
                }

                return ['a' => $a, 'b' => $b];
            default:
                $x = self::coordinate($g['x'], $field . '.x', $errors, $width);
                $y = self::coordinate($g['y'], $field . '.y', $errors, $height);

                return $x === null || $y === null ? null : ['x' => $x, 'y' => $y];
        }
    }

    /**
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    public static function props(string $type, mixed $value, string $field, array &$errors, bool $lenient): ?array
    {
        $keys = self::PROPS_KEYS[$type];
        $p = Fields::object($value, $keys);
        if ($p === null) {
            $errors[$field] = 'invalid';

            return null;
        }
        $before = count($errors);
        foreach ($keys as $key) {
            if (!array_key_exists($key, $p)) {
                if ($lenient && in_array($key, self::LENIENT_PROPS, true)) {
                    $p[$key] = null;
                } else {
                    $errors[$field . '.' . $key] = 'required';
                }
            }
        }
        if (count($errors) !== $before) {
            return null;
        }
        $out = [];
        foreach ($keys as $key) {
            $v = $p[$key];
            $f = $field . '.' . $key;
            $checked = match ($key) {
                'kind' => self::enum($v, $type === 'wall' ? self::WALL_KINDS : self::WINDOW_KINDS, $f, $errors),
                'thickness' => self::number($v, self::THICKNESS_MIN, self::THICKNESS_MAX, $f, $errors),
                'blocks_vision', 'blocks_light', 'blocks_move', 'locked', 'secret', 'enabled' => self::bool($v, $f, $errors),
                'texture_asset', 'asset_open', 'asset_closed' => self::reserved($v, $f, $errors),
                'height' => $v === null ? null : self::number($v, 0, self::HEIGHT_MAX, $f, $errors),
                'state' => self::enum($v, self::DOOR_STATES, $f, $errors),
                'swing' => self::enum($v, self::DOOR_SWINGS, $f, $errors),
                'radius', 'dim_radius' => self::number($v, 0, self::LIGHT_RADIUS_MAX, $f, $errors),
                'color' => self::color($v, $f, $errors),
                'intensity' => self::number($v, 0, 1, $f, $errors),
                'flicker' => self::flicker($v, $f, $errors),
                'cone' => $v === null ? null : self::cone($v, $f, $errors),
                'follows_token' => $v === null ? null : self::uidValue($v, $f, $errors),
                default => null,
            };
            $out[$key] = $checked;
        }
        if (count($errors) !== $before) {
            return null;
        }
        if ($type === 'light' && $out['dim_radius'] < $out['radius']) {
            $errors[$field . '.dim_radius'] = 'below_radius';

            return null;
        }

        return $out;
    }

    /**
     * Bounding box [x1, y1, x2, y2] in cells (3 decimals), bounded to the map:
     * wall = points +/- thickness / 2, door / window = a, b, light = (x, y) +/- dim_radius.
     *
     * @param array<string, mixed> $object normalized
     * @return array{0: float, 1: float, 2: float, 3: float}
     */
    public static function bbox(array $object, float $width, float $height): array
    {
        $g = $object['geometry'];
        $pad = 0.0;
        switch ($object['type']) {
            case 'wall':
                $points = $g['points'];
                $pad = (float) $object['props']['thickness'] / 2;
                break;
            case 'door':
            case 'window':
                $points = [$g['a'], $g['b']];
                break;
            default:
                $points = [[$g['x'], $g['y']]];
                $pad = (float) $object['props']['dim_radius'];
        }
        $xs = array_column($points, 0);
        $ys = array_column($points, 1);
        $clamp = static fn (float $v, float $max): float => round(max(0.0, min($max, $v)), 3);

        return [
            $clamp((float) min($xs) - $pad, $width),
            $clamp((float) min($ys) - $pad, $height),
            $clamp((float) max($xs) + $pad, $width),
            $clamp((float) max($ys) + $pad, $height),
        ];
    }

    /**
     * True when every coordinate of the (normalized) object is inside a map of this size.
     *
     * @param array<string, mixed> $object
     */
    public static function fitsIn(array $object, float $width, float $height): bool
    {
        $errors = [];

        return self::geometry((string) $object['type'], $object['geometry'], 'geometry', $errors, $width, $height) !== null;
    }

    /**
     * Canonical key order of a stored object (MySQL JSON columns reorder keys).
     *
     * @param array<string, mixed> $object
     * @return array<string, mixed>
     */
    public static function canonical(array $object): array
    {
        $type = (string) ($object['type'] ?? '');
        $out = [];
        foreach (self::OBJECT_KEYS as $key) {
            if (array_key_exists($key, $object)) {
                $out[$key] = $object[$key];
            }
        }
        if (isset(self::GEOMETRY_KEYS[$type]) && is_array($out['geometry'] ?? null)) {
            $out['geometry'] = self::ordered($out['geometry'], self::GEOMETRY_KEYS[$type]);
        }
        if (isset(self::PROPS_KEYS[$type]) && is_array($out['props'] ?? null)) {
            $props = self::ordered($out['props'], self::PROPS_KEYS[$type]);
            if (is_array($props['flicker'] ?? null)) {
                $props['flicker'] = self::ordered($props['flicker'], self::FLICKER_KEYS);
            }
            if (is_array($props['cone'] ?? null)) {
                $props['cone'] = self::ordered($props['cone'], self::CONE_KEYS);
            }
            $out['props'] = $props;
        }

        return $out;
    }

    public static function isLayer(mixed $value): bool
    {
        return is_string($value) && in_array($value, MapInput::OBJECT_LAYERS, true);
    }

    public static function isVisibility(mixed $value): bool
    {
        return is_string($value) && in_array($value, self::VISIBILITIES, true);
    }

    public static function isUid(mixed $value): bool
    {
        return is_string($value) && preg_match(self::UID_PATTERN, $value) === 1;
    }

    /**
     * Required uid member of $o.
     *
     * @param array<string, mixed>  $o
     * @param array<string, string> $errors
     */
    public static function uid(array $o, string $key, string $field, array &$errors): ?string
    {
        if (!array_key_exists($key, $o)) {
            $errors[$field] = 'required';

            return null;
        }

        return self::uidValue($o[$key], $field, $errors);
    }

    /**
     * [x, y] inside the map.
     *
     * @param array<string, string> $errors
     * @return array{0: int|float, 1: int|float}|null
     */
    public static function point(mixed $value, string $field, array &$errors, float $width, float $height): ?array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) !== 2) {
            $errors[$field] = 'invalid';

            return null;
        }
        $x = self::coordinate($value[0], $field, $errors, $width);
        $y = $x === null ? null : self::coordinate($value[1], $field, $errors, $height);

        return $x === null || $y === null ? null : [$x, $y];
    }

    /**
     * Coordinate in [0, $max], rounded to 3 decimals.
     *
     * @param array<string, string> $errors
     */
    public static function coordinate(mixed $value, string $field, array &$errors, float $max): int|float|null
    {
        return self::number($value, 0, $max, $field, $errors);
    }

    /**
     * @param array<string, string> $errors
     */
    public static function number(mixed $value, float $min, float $max, string $field, array &$errors, int $decimals = 3): int|float|null
    {
        $n = Fields::number($value, $min, $max, $decimals);
        if ($n === null) {
            $errors[$field] = Fields::numberError($value, $min, $max) ?? 'invalid';
        }

        return $n;
    }

    /**
     * @param array<string, string> $errors
     */
    private static function sortOrder(mixed $value, string $field, array &$errors): ?int
    {
        $n = Fields::int($value, -self::SORT_MAX, self::SORT_MAX);
        if ($n === null) {
            $errors[$field] = Fields::numberError($value, -self::SORT_MAX, self::SORT_MAX, true) ?? 'invalid';
        }

        return $n;
    }

    /**
     * Member that the document may omit (default), required otherwise. Returns null when
     * missing and required (error recorded).
     *
     * @param array<string, mixed>  $o
     * @param array<string, string> $errors
     */
    private static function defaulted(array $o, string $key, bool $lenient, mixed $default, string $field, array &$errors): mixed
    {
        if (array_key_exists($key, $o)) {
            return $o[$key];
        }
        if ($lenient) {
            return $default;
        }
        $errors[$field . '.' . $key] = 'required';

        return null;
    }

    /**
     * @param array<string, string> $errors
     */
    private static function uidValue(mixed $value, string $field, array &$errors): ?string
    {
        if (!self::isUid($value)) {
            $errors[$field] = $value === '' || $value === null ? 'required' : 'invalid';

            return null;
        }

        return (string) $value;
    }

    /**
     * @param list<string>          $values
     * @param array<string, string> $errors
     */
    private static function enum(mixed $value, array $values, string $field, array &$errors): ?string
    {
        if (!is_string($value) || !in_array($value, $values, true)) {
            $errors[$field] = 'invalid';

            return null;
        }

        return $value;
    }

    /**
     * @param array<string, string> $errors
     */
    private static function bool(mixed $value, string $field, array &$errors): ?bool
    {
        if (!is_bool($value)) {
            $errors[$field] = 'invalid';

            return null;
        }

        return $value;
    }

    /**
     * Reserved member (P9): null only.
     *
     * @param array<string, string> $errors
     */
    private static function reserved(mixed $value, string $field, array &$errors): mixed
    {
        if ($value !== null) {
            $errors[$field] = 'invalid';
        }

        return null;
    }

    /**
     * @param array<string, string> $errors
     */
    private static function color(mixed $value, string $field, array &$errors): ?string
    {
        $c = Fields::color($value);
        if ($c === null) {
            $errors[$field] = 'invalid';
        }

        return $c;
    }

    /**
     * @param array<string, string> $errors
     * @return array{type: string, amp: int|float, speed: int|float}|null
     */
    private static function flicker(mixed $value, string $field, array &$errors): ?array
    {
        $f = Fields::object($value, self::FLICKER_KEYS);
        if ($f === null) {
            $errors[$field] = 'invalid';

            return null;
        }
        $before = count($errors);
        foreach (self::FLICKER_KEYS as $key) {
            if (!array_key_exists($key, $f)) {
                $errors[$field . '.' . $key] = 'required';
            }
        }
        if (count($errors) !== $before) {
            return null;
        }
        $type = self::enum($f['type'], self::FLICKER_TYPES, $field . '.type', $errors);
        $amp = self::number($f['amp'], 0, 1, $field . '.amp', $errors);
        $speed = self::number($f['speed'], self::FLICKER_SPEED_MIN, self::FLICKER_SPEED_MAX, $field . '.speed', $errors);

        return $type === null || $amp === null || $speed === null ? null : ['type' => $type, 'amp' => $amp, 'speed' => $speed];
    }

    /**
     * @param array<string, string> $errors
     * @return array{angle: int|float, direction: int|float}|null
     */
    private static function cone(mixed $value, string $field, array &$errors): ?array
    {
        $c = Fields::object($value, self::CONE_KEYS);
        if ($c === null || $c === []) {
            $errors[$field] = 'invalid';

            return null;
        }
        $before = count($errors);
        foreach (self::CONE_KEYS as $key) {
            if (!array_key_exists($key, $c)) {
                $errors[$field . '.' . $key] = 'required';
            }
        }
        if (count($errors) !== $before) {
            return null;
        }
        $angle = self::number($c['angle'], 1, 359, $field . '.angle', $errors);
        $direction = self::number($c['direction'], 0, 360, $field . '.direction', $errors);

        return $angle === null || $direction === null ? null : ['angle' => $angle, 'direction' => $direction];
    }

    /**
     * @param array<string, mixed> $value
     * @param list<string>         $keys
     * @return array<string, mixed>
     */
    private static function ordered(array $value, array $keys): array
    {
        $out = [];
        foreach ($keys as $key) {
            if (array_key_exists($key, $value)) {
                $out[$key] = $value[$key];
            }
        }

        return $out + $value;
    }
}
