<?php

declare(strict_types=1);

namespace JDR\Domain\Displays;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;

/**
 * Settings of a screen (D8): defaults, decoding and validation of a partial patch.
 * Errors are 422 with fields "settings.<key>".
 */
final class DisplaySettings
{
    public const DEFAULTS = [
        'diagonal_in' => null,
        'px_per_mm' => null,
        'mm_per_cell' => 25,
        'rotation' => 0,
        'mirror' => false,
        'show_tokens' => true,
        'follow_camera' => true,
        'view_lock' => null,
    ];

    /** Keys the screen itself may change (PATCH /display/me). */
    public const DEVICE_KEYS = ['diagonal_in', 'px_per_mm', 'rotation', 'mirror'];

    /**
     * Stored JSON merged over the defaults.
     *
     * @return array<string, mixed>
     */
    public static function decode(mixed $json): array
    {
        $stored = is_string($json) ? json_decode($json, true) : null;

        return array_replace(self::DEFAULTS, is_array($stored) ? array_intersect_key($stored, self::DEFAULTS) : []);
    }

    /**
     * @param array<string, mixed> $current complete current settings
     * @param list<string>         $allowed keys the caller may change
     * @param list<string>         $floorIds ids (strings) of the floors of the current map (view_lock)
     * @return array<string, mixed> complete new settings
     * @throws ValidationException
     */
    public static function patch(array $current, mixed $patch, array $allowed, array $floorIds): array
    {
        if (!is_array($patch) || ($patch !== [] && array_is_list($patch))) {
            throw new ValidationException('', ['settings' => 'invalid']);
        }
        $errors = [];
        $out = $current;
        foreach ($patch as $key => $value) {
            $key = (string) $key;
            if (!array_key_exists($key, self::DEFAULTS) || !in_array($key, $allowed, true)) {
                $errors['settings.' . substr($key, 0, 40)] = array_key_exists($key, self::DEFAULTS) ? 'forbidden' : 'unknown';
                continue;
            }
            $clean = self::value($key, $value, $floorIds);
            if ($clean === false && $key !== 'mirror' && $key !== 'show_tokens' && $key !== 'follow_camera') {
                $errors['settings.' . $key] = 'invalid';
                continue;
            }
            $out[$key] = $clean;
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }

        return $out;
    }

    /**
     * @param list<string> $floorIds
     * @return mixed the clean value; false when invalid (booleans: see caller)
     */
    private static function value(string $key, mixed $v, array $floorIds): mixed
    {
        switch ($key) {
            case 'diagonal_in':
                return $v === null ? null : self::number($v, 5, 300);
            case 'px_per_mm':
                return $v === null ? null : self::number($v, 0.5, 50);
            case 'mm_per_cell':
                return self::number($v, 5, 100);
            case 'rotation':
                return is_int($v) && in_array($v, [0, 90, 180, 270], true) ? $v : false;
            case 'view_lock':
                return $v === null ? null : self::viewLock($v, $floorIds);
            default:
                // Booleans: an invalid value must not look like a valid "false".
                if (!is_bool($v)) {
                    throw new ValidationException('', ['settings.' . $key => 'invalid']);
                }

                return $v;
        }
    }

    private static function number(mixed $v, float $min, float $max): int|float|false
    {
        if ((!is_int($v) && !is_float($v)) || !is_finite((float) $v) || $v < $min || $v > $max) {
            return false;
        }

        return self::round($v);
    }

    private static function round(int|float $v): int|float
    {
        $r = round((float) $v, 3);

        return $r == floor($r) && abs($r) < 1e9 ? (int) $r : $r;
    }

    /**
     * @param list<string> $floorIds
     * @return array{x: int|float, y: int|float, zoom: int|float, floor_id: string|null}|false
     */
    private static function viewLock(mixed $v, array $floorIds): array|false
    {
        if (!is_array($v) || array_is_list($v) || array_diff(array_keys($v), ['x', 'y', 'zoom', 'floor_id']) !== []) {
            return false;
        }
        $x = $v['x'] ?? null;
        $y = $v['y'] ?? null;
        $zoom = self::number($v['zoom'] ?? null, 0.1, 8);
        if ((!is_int($x) && !is_float($x)) || (!is_int($y) && !is_float($y)) || !is_finite((float) $x) || !is_finite((float) $y)
            || abs($x) > 1e7 || abs($y) > 1e7 || $zoom === false) {
            return false;
        }
        $floor = $v['floor_id'] ?? null;
        if ($floor !== null && (!is_string($floor) || !in_array($floor, $floorIds, true))) {
            return false;
        }

        return ['x' => self::round($x), 'y' => self::round($y), 'zoom' => $zoom, 'floor_id' => $floor];
    }
}
