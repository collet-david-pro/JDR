<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

use JDR\Domain\Games\Fields;
use JDR\Domain\Maps\MapFloors;

/**
 * Object rules added by P9a (called from ObjectRules; stateless):
 * - stairs: geometry {x, y, w, h} (integer cells, w and h 1-10, inside the map), props
 *   {direction: up|down, to_floor: floor uid, link?: Link};
 * - portal: geometry {x, y} (cells, 3 decimals), props {icon, color: #rrggbb, label?: <= 60, link: Link};
 * - door: optional props.link (a door may lead to another map);
 * - Link {map_id, floor, x, y}: normalized, in this key order, floor uid or null, x / y cells (3 decimals) or
 *   null. $imported (documents only): map_id may be null for a link that lost its map, with the
 *   optional hints map_name (<= 120) and broken (true).
 * What depends on the database (target map of the game, floors) is checked by ObjectLinkRules.
 */
final class ObjectRulesP9
{
    public const TYPES = ['stairs', 'portal'];
    public const DIRECTIONS = ['up', 'down'];
    public const ICONS = ['portal', 'door', 'stairs', 'ladder', 'trapdoor'];
    public const STAIRS_SIZE_MAX = 10;
    public const LABEL_MAX = 60;
    public const LINK_KEYS = ['map_id', 'floor', 'x', 'y', 'map_name', 'broken'];
    /** Props that may be absent (and are then not stored). */
    public const OPTIONAL_PROPS = ['link', 'label'];

    public static function handles(string $type): bool
    {
        return in_array($type, self::TYPES, true);
    }

    /**
     * Geometry of a stairs / portal (keys already checked present).
     *
     * @param array<string, mixed>  $g
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    public static function geometry(string $type, array $g, string $field, array &$errors, float $width, float $height): ?array
    {
        if ($type === 'portal') {
            $x = ObjectRules::coordinate($g['x'], $field . '.x', $errors, $width);
            $y = ObjectRules::coordinate($g['y'], $field . '.y', $errors, $height);

            return $x === null || $y === null ? null : ['x' => $x, 'y' => $y];
        }
        $out = [];
        $before = count($errors);
        foreach (['x' => $width, 'y' => $height, 'w' => self::STAIRS_SIZE_MAX, 'h' => self::STAIRS_SIZE_MAX] as $key => $max) {
            $min = $key === 'w' || $key === 'h' ? 1 : 0;
            $n = Fields::int($g[$key], $min, (int) $max);
            if ($n === null) {
                $errors[$field . '.' . $key] = Fields::numberError($g[$key], $min, $max, true) ?? 'invalid';
            }
            $out[$key] = $n;
        }
        if (count($errors) !== $before) {
            return null;
        }
        if ($out['x'] + $out['w'] > $width || $out['y'] + $out['h'] > $height) {
            $errors[$field] = 'out_of_bounds';

            return null;
        }

        return $out;
    }

    /**
     * One props member of a stairs / portal, or the link of a door ($imported: document form of a link).
     *
     * @param array<string, string> $errors
     */
    public static function prop(string $key, mixed $value, string $field, array &$errors, bool $imported = false): mixed
    {
        switch ($key) {
            case 'direction':
                return self::enum($value, self::DIRECTIONS, $field, $errors);
            case 'icon':
                return self::enum($value, self::ICONS, $field, $errors);
            case 'color':
                $c = Fields::color($value);
                if ($c === null) {
                    $errors[$field] = 'invalid';
                }

                return $c;
            case 'to_floor':
                if (!MapFloors::isUid($value)) {
                    $errors[$field] = 'invalid';

                    return null;
                }

                return $value;
            case 'label':
                $label = Fields::text($value, self::LABEL_MAX);
                if ($label === null || $label === '') {
                    $errors[$field] = 'invalid';
                }

                return $label;
            default:
                return self::link($value, $field, $errors, $imported);
        }
    }

    /**
     * A normalized Link, or null (error recorded).
     *
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    public static function link(mixed $value, string $field, array &$errors, bool $imported): ?array
    {
        $l = Fields::object($value, $imported ? self::LINK_KEYS : array_slice(self::LINK_KEYS, 0, 4));
        if ($l === null || $l === []) {
            $errors[$field] = 'invalid';

            return null;
        }
        $before = count($errors);
        $mapId = Fields::id($l['map_id'] ?? null);
        if ($mapId === null && !($imported && array_key_exists('map_id', $l) && $l['map_id'] === null)) {
            $errors[$field . '.map_id'] = array_key_exists('map_id', $l) ? 'invalid' : 'required';
        }
        $floor = $l['floor'] ?? null;
        if ($floor !== null && !MapFloors::isUid($floor)) {
            $errors[$field . '.floor'] = 'invalid';
        }
        $max = (float) \JDR\Domain\Maps\MapInput::GRID_MAX;
        $x = ($l['x'] ?? null) === null ? null : ObjectRules::coordinate($l['x'], $field . '.x', $errors, $max);
        $y = ($l['y'] ?? null) === null ? null : ObjectRules::coordinate($l['y'], $field . '.y', $errors, $max);
        $out = ['map_id' => $mapId, 'floor' => $floor, 'x' => $x, 'y' => $y];
        if ($imported) {
            $name = $l['map_name'] ?? null;
            if ($name !== null) {
                $name = Fields::text($name, 120);
                if ($name === null || $name === '') {
                    $errors[$field . '.map_name'] = 'invalid';
                }
                $out['map_name'] = $name;
            }
            if (array_key_exists('broken', $l)) {
                if ($l['broken'] !== true) {
                    $errors[$field . '.broken'] = 'invalid';
                }
                $out['broken'] = true;
            }
        }

        return count($errors) === $before ? $out : null;
    }

    /**
     * Bounding box [x1, y1, x2, y2] of a stairs (its cells) or a portal (the cell around the point).
     *
     * @param array<string, mixed> $object
     * @return array{0: float, 1: float, 2: float, 3: float}
     */
    public static function bbox(array $object, float $width, float $height): array
    {
        $g = $object['geometry'];
        $clamp = static fn (float $v, float $max): float => round(max(0.0, min($max, $v)), 3);
        if ($object['type'] === 'stairs') {
            return [$clamp((float) $g['x'], $width), $clamp((float) $g['y'], $height), $clamp((float) ($g['x'] + $g['w']), $width), $clamp((float) ($g['y'] + $g['h']), $height)];
        }

        return [$clamp($g['x'] - 0.5, $width), $clamp($g['y'] - 0.5, $height), $clamp($g['x'] + 0.5, $width), $clamp($g['y'] + 0.5, $height)];
    }

    /**
     * Canonical key order of a Link.
     *
     * @param array<string, mixed> $link
     * @return array<string, mixed>
     */
    public static function canonicalLink(array $link): array
    {
        $out = [];
        foreach (self::LINK_KEYS as $key) {
            if (array_key_exists($key, $link)) {
                $out[$key] = $link[$key];
            }
        }

        return $out;
    }

    /**
     * The object without what only the GM may know: props.link (the destination).
     *
     * @param array<string, mixed> $object API form
     * @return array<string, mixed>
     */
    public static function forPlayer(array $object): array
    {
        if (is_array($object['props'] ?? null)) {
            unset($object['props']['link']);
        }

        return $object;
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
}
