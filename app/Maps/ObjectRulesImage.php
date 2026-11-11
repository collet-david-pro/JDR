<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

use JDR\Domain\Games\Fields;

/**
 * Free image object of a map (P14, map background or picture), called from ObjectRules; stateless.
 * - geometry {x, y, w, h, rotation}: top-left corner and size in cells (3 decimals), x in
 *   [-width, width], y in [-height, height], w in [0.1, 2 x width], h in [0.1, 2 x height], the
 *   rectangle overlapping the map (out_of_bounds otherwise); rotation in degrees [-360, 360],
 *   normalized to [0, 360) (2 decimals), around the centre;
 * - props {asset_id, opacity 0-1, flip_h, flip_v, placement: background | above}: asset_id is an
 *   asset id (string in answers, ops also accept a number); a document may carry null (resolved on
 *   import from the object's "asset" hash, see MapDocumentImages).
 * - optional props.tile {group, x, y, w, h, tw, th}: the object is one piece (pixel rectangle x, y, w, h)
 *   of a picture of tw x th pixels cut in the browser because it exceeds the image limits; the pieces
 *   of a picture share the group. Informational for the editor (the geometry is what is drawn).
 * Neither vision, light nor movement are blocked. "background" is drawn under the tiles, "above" on
 * the objects (under the tokens). The asset (exists, usable by the editor, kind in ASSET_KINDS) is
 * checked by SceneApplier.
 */
final class ObjectRulesImage
{
    public const TYPE = 'image';
    public const TYPES = [self::TYPE];
    public const GEOMETRY_KEYS = ['x', 'y', 'w', 'h', 'rotation'];
    public const PROPS_KEYS = ['asset_id', 'opacity', 'flip_h', 'flip_v', 'placement', 'tile'];
    /** Props every image carries (tile is optional). */
    private const REQUIRED_PROPS = ['asset_id', 'opacity', 'flip_h', 'flip_v', 'placement'];
    private const TILE_KEYS = ['group', 'x', 'y', 'w', 'h', 'tw', 'th'];
    private const TILE_MAX = 1000000;
    public const PLACEMENTS = ['background', 'above'];
    public const ASSET_KINDS = ['background', 'object', 'token', 'texture'];
    public const SIZE_MIN = 0.1;

    /**
     * Tells whether the object type is the image type.
     */
    public static function handles(mixed $type): bool
    {
        return $type === self::TYPE;
    }

    /**
     * Geometry (keys already checked present).
     *
     * @param array<string, mixed>  $g
     * @param array<string, string> $errors
     * @return array{x: int|float, y: int|float, w: int|float, h: int|float, rotation: int|float}|null
     */
    public static function geometry(array $g, string $field, array &$errors, float $width, float $height): ?array
    {
        $before = count($errors);
        $x = ObjectRules::number($g['x'], -$width, $width, $field . '.x', $errors);
        $y = ObjectRules::number($g['y'], -$height, $height, $field . '.y', $errors);
        $w = ObjectRules::number($g['w'], self::SIZE_MIN, max(self::SIZE_MIN, 2 * $width), $field . '.w', $errors);
        $h = ObjectRules::number($g['h'], self::SIZE_MIN, max(self::SIZE_MIN, 2 * $height), $field . '.h', $errors);
        $rotation = ObjectRules::number($g['rotation'], -360, 360, $field . '.rotation', $errors, 2);
        if (count($errors) !== $before || $x === null || $y === null || $w === null || $h === null || $rotation === null) {
            return null;
        }
        if ($x + $w <= 0 || $y + $h <= 0) {
            $errors[$field] = 'out_of_bounds';

            return null;
        }
        $r = fmod((float) $rotation, 360.0);
        $r = round($r < 0 ? $r + 360.0 : $r, 2);
        $r = $r >= 360.0 ? 0.0 : $r;

        return ['x' => $x, 'y' => $y, 'w' => $w, 'h' => $h, 'rotation' => floor($r) === $r ? (int) $r : $r];
    }

    /**
     * Props; $lenient (document): asset_id may be null.
     *
     * @param array<string, string> $errors
     * @return array{asset_id: ?string, opacity: int|float, flip_h: bool, flip_v: bool, placement: string, tile?: array<string, int|string>}|null
     */
    public static function props(mixed $value, string $field, array &$errors, bool $lenient): ?array
    {
        $p = Fields::object($value, self::PROPS_KEYS);
        if ($p === null) {
            $errors[$field] = 'invalid';

            return null;
        }
        $before = count($errors);
        foreach (self::REQUIRED_PROPS as $key) {
            if (!array_key_exists($key, $p) && !($lenient && $key === 'asset_id')) {
                $errors[$field . '.' . $key] = 'required';
            }
        }
        if (count($errors) !== $before) {
            return null;
        }
        $assetId = null;
        if (($p['asset_id'] ?? null) !== null || !$lenient) {
            $id = Fields::id($p['asset_id'] ?? null);
            if ($id === null) {
                $errors[$field . '.asset_id'] = 'invalid';
            } else {
                $assetId = (string) $id;
            }
        }
        $opacity = ObjectRules::number($p['opacity'], 0, 1, $field . '.opacity', $errors);
        foreach (['flip_h', 'flip_v'] as $key) {
            if (!is_bool($p[$key])) {
                $errors[$field . '.' . $key] = 'invalid';
            }
        }
        if (!is_string($p['placement']) || !in_array($p['placement'], self::PLACEMENTS, true)) {
            $errors[$field . '.placement'] = 'invalid';
        }
        $tile = null;
        if (($p['tile'] ?? null) !== null) {
            $tile = self::tile($p['tile'], $field . '.tile', $errors);
        }
        if (count($errors) !== $before || $opacity === null) {
            return null;
        }
        $out = [
            'asset_id' => $assetId,
            'opacity' => $opacity,
            'flip_h' => $p['flip_h'],
            'flip_v' => $p['flip_v'],
            'placement' => $p['placement'],
        ];
        if ($tile !== null) {
            $out['tile'] = $tile;
        }

        return $out;
    }

    /**
     * Piece of a tiled picture: group [A-Za-z0-9_-]{1,64}, integers x, y >= 0, w, h, tw, th >= 1
     * (at most 1 000 000), the rectangle inside the picture.
     *
     * @param array<string, string> $errors
     * @return array{group: string, x: int, y: int, w: int, h: int, tw: int, th: int}|null
     */
    public static function tile(mixed $value, string $field, array &$errors): ?array
    {
        $t = Fields::object($value, self::TILE_KEYS);
        if ($t === null || count($t) !== count(self::TILE_KEYS)) {
            $errors[$field] = 'invalid';

            return null;
        }
        if (!is_string($t['group']) || preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $t['group']) !== 1) {
            $errors[$field . '.group'] = 'invalid';

            return null;
        }
        $out = ['group' => $t['group']];
        foreach (['x', 'y', 'w', 'h', 'tw', 'th'] as $key) {
            $min = $key === 'x' || $key === 'y' ? 0 : 1;
            $n = $t[$key];
            if (!is_int($n) || $n < $min || $n > self::TILE_MAX) {
                $errors[$field . '.' . $key] = 'invalid';

                return null;
            }
            $out[$key] = $n;
        }
        if ($out['x'] + $out['w'] > $out['tw'] || $out['y'] + $out['h'] > $out['th']) {
            $errors[$field] = 'invalid';

            return null;
        }

        return $out;
    }

    /**
     * Bounding box of the (rotated) rectangle, bounded to the map.
     *
     * @param array<string, mixed> $object normalized
     * @return array{0: float, 1: float, 2: float, 3: float}
     */
    public static function bbox(array $object, float $width, float $height): array
    {
        $g = $object['geometry'];
        $w = (float) $g['w'];
        $h = (float) $g['h'];
        $cx = (float) $g['x'] + $w / 2;
        $cy = (float) $g['y'] + $h / 2;
        $a = deg2rad((float) $g['rotation']);
        $hw = (abs(cos($a)) * $w + abs(sin($a)) * $h) / 2;
        $hh = (abs(sin($a)) * $w + abs(cos($a)) * $h) / 2;
        $clamp = static fn (float $v, float $max): float => round(max(0.0, min($max, $v)), 3);

        return [$clamp($cx - $hw, $width), $clamp($cy - $hh, $height), $clamp($cx + $hw, $width), $clamp($cy + $hh, $height)];
    }

    /**
     * Asset id of an image object (API or document form), null for another type / an unresolved asset.
     *
     * @param array<string, mixed> $object
     */
    public static function assetId(array $object): ?int
    {
        if (!self::handles($object['type'] ?? null)) {
            return null;
        }

        return Fields::id($object['props']['asset_id'] ?? null);
    }

    /** Props of walls / doors that reference an asset (wall texture, door images). */
    public const SKIN_KEYS = [
        'wall' => ['texture_asset'],
        'door' => ['asset_open', 'asset_closed'],
    ];

    /**
     * Prop names of an object type that reference an asset (empty for the other types).
     *
     * @return list<string>
     */
    public static function skinKeys(mixed $type): array
    {
        return is_string($type) ? (self::SKIN_KEYS[$type] ?? []) : [];
    }

    /**
     * Every asset an object references, one entry per reference: the picture of an image object, the
     * texture of a wall, the images of a door.
     *
     * @param array<string, mixed> $object
     * @return list<int>
     */
    public static function refIds(array $object): array
    {
        $out = [];
        $image = self::assetId($object);
        if ($image !== null) {
            $out[] = $image;
        }
        foreach (self::skinKeys($object['type'] ?? null) as $key) {
            $id = Fields::id($object['props'][$key] ?? null);
            if ($id !== null) {
                $out[] = $id;
            }
        }

        return $out;
    }

    /**
     * References per asset among $objects (map_asset_refs: one per image object, wall texture, door image).
     *
     * @param iterable<array<string, mixed>> $objects
     * @return array<int, int>
     */
    public static function counts(iterable $objects): array
    {
        $out = [];
        foreach ($objects as $object) {
            foreach (self::refIds($object) as $id) {
                $out[$id] = ($out[$id] ?? 0) + 1;
            }
        }

        return $out;
    }
}
