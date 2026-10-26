<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

use JDR\Domain\Games\Fields;
use JDR\Domain\Tokens\TokenInput;

/**
 * Pure validation of placed tokens (table map_tokens, etapes/P05 "Contrat d'API P5"), shared by
 * the ops and the map document: x in [0, width], y in [0, height] (3 decimals), rotation integer
 * 0-359, scale 0.25-4 (2 decimals), hidden bool, light_override null or a P3 token light (every
 * key required, same rules as TokenInput::light: dim_radius >= radius).
 */
final class TokenRules
{
    public const MAX_TOKENS = 2000;
    public const SCALE_MIN = 0.25;
    public const SCALE_MAX = 4.0;
    public const ROTATION_MAX = 359;
    /** Keys of a placed token, in canonical order (API form). */
    public const TOKEN_KEYS = ['uid', 'floor', 'token_id', 'x', 'y', 'rotation', 'scale', 'hidden', 'light_override', 'rev'];
    public const PATCH_KEYS = ['x', 'y', 'rotation', 'scale', 'hidden', 'light_override'];
    private const DEFAULTS = ['rotation' => 0, 'scale' => 1, 'hidden' => false, 'light_override' => null];

    /**
     * Position and appearance members of $t (x, y, rotation, scale, hidden, light_override);
     * $lenient (document): rotation, scale, hidden and light_override may be omitted.
     *
     * @param array<string, mixed>  $t
     * @param array<string, string> $errors
     * @return array{x: int|float, y: int|float, rotation: int, scale: int|float, hidden: bool, light_override: ?array<string, mixed>}|null
     */
    public static function placement(array $t, string $field, array &$errors, float $width, float $height, bool $lenient = false): ?array
    {
        $before = count($errors);
        foreach (self::PATCH_KEYS as $key) {
            if (!array_key_exists($key, $t)) {
                if ($lenient && array_key_exists($key, self::DEFAULTS)) {
                    $t[$key] = self::DEFAULTS[$key];
                } else {
                    $errors[$field . '.' . $key] = 'required';
                }
            }
        }
        if (count($errors) !== $before) {
            return null;
        }
        $out = self::values($t, $field, $errors, $width, $height);

        return count($errors) === $before ? $out : null;
    }

    /**
     * maptoken.update patch (non-empty, keys among PATCH_KEYS), values normalized.
     *
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    public static function patch(mixed $value, string $field, array &$errors, float $width, float $height): ?array
    {
        $p = Fields::object($value, self::PATCH_KEYS);
        if ($p === null || $p === []) {
            $errors[$field] = $value === null ? 'required' : 'invalid';

            return null;
        }
        $before = count($errors);
        $out = self::values($p, $field, $errors, $width, $height);

        return count($errors) === $before ? $out : null;
    }

    /**
     * Checks the position of a normalized token / patch against the map size.
     *
     * @param array<string, mixed>  $t
     * @param array<string, string> $errors
     */
    public static function checkBounds(array $t, string $field, array &$errors, float $width, float $height): bool
    {
        $before = count($errors);
        if (array_key_exists('x', $t)) {
            ObjectRules::coordinate($t['x'], $field . '.x', $errors, $width);
        }
        if (array_key_exists('y', $t)) {
            ObjectRules::coordinate($t['y'], $field . '.y', $errors, $height);
        }

        return count($errors) === $before;
    }

    /**
     * Canonical key order of a stored token light (MySQL JSON columns reorder keys).
     *
     * @return array<string, mixed>|null
     */
    public static function canonicalLight(mixed $light): ?array
    {
        if (!is_array($light)) {
            return null;
        }
        $out = [];
        foreach (array_keys(TokenInput::LIGHT_DEFAULTS) as $key) {
            if (array_key_exists($key, $light)) {
                $out[$key] = $light[$key];
            }
        }

        return $out;
    }

    /**
     * @param array<string, mixed>  $t
     * @param array<string, string> $errors
     * @return array<string, mixed>
     */
    private static function values(array $t, string $field, array &$errors, float $width, float $height): array
    {
        $out = [];
        foreach (self::PATCH_KEYS as $key) {
            if (!array_key_exists($key, $t)) {
                continue;
            }
            $v = $t[$key];
            $f = $field . '.' . $key;
            switch ($key) {
                case 'x':
                case 'y':
                    $out[$key] = ObjectRules::coordinate($v, $f, $errors, $key === 'x' ? $width : $height);
                    break;
                case 'rotation':
                    $out[$key] = Fields::int($v, 0, self::ROTATION_MAX);
                    if ($out[$key] === null) {
                        $errors[$f] = Fields::numberError($v, 0, self::ROTATION_MAX, true) ?? 'invalid';
                    }
                    break;
                case 'scale':
                    $out[$key] = ObjectRules::number($v, self::SCALE_MIN, self::SCALE_MAX, $f, $errors, 2);
                    break;
                case 'hidden':
                    $out[$key] = is_bool($v) ? $v : null;
                    if ($out[$key] === null) {
                        $errors[$f] = 'invalid';
                    }
                    break;
                default:
                    $out[$key] = self::light($v, $f, $errors);
            }
        }

        return $out;
    }

    /**
     * null, or a full P3 light (TokenInput::light rules), errors as "<field>.<key>".
     *
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    private static function light(mixed $value, string $field, array &$errors): ?array
    {
        if ($value === null) {
            return null;
        }
        $keys = array_keys(TokenInput::LIGHT_DEFAULTS);
        $light = Fields::object($value, $keys);
        if ($light === null) {
            $errors[$field] = 'invalid';

            return null;
        }
        $missing = false;
        foreach ($keys as $key) {
            if (!array_key_exists($key, $light)) {
                $errors[$field . '.' . $key] = 'required';
                $missing = true;
            }
        }
        if ($missing) {
            return null;
        }
        $local = [];
        $checked = TokenInput::light($light, TokenInput::LIGHT_DEFAULTS, $local);
        foreach ($local as $key => $code) {
            $errors[$field . substr($key, strlen('light'))] = $code;
        }

        return $checked;
    }
}
