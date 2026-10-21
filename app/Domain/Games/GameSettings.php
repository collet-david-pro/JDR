<?php

declare(strict_types=1);

namespace JDR\Domain\Games;

defined('JDR_BOOT') || exit;

/**
 * games.settings (projet.md 7.2, contract P3): opaque JSON, validated key by key before writing.
 * Bounds (aligned with the front): unit_label 1-10 characters, unit_per_cell 0.01-9999.99
 * (maps.unit_per_cell DECIMAL(6,2)), default_cell_px 16-512.
 */
final class GameSettings
{
    public const DEFAULTS = [
        'fog_strict' => true,
        'players_blocked_by_walls' => true,
        'players_can_move_own_tokens' => true,
        'players_see_other_pcs' => true,
        'unit_label' => 'ft',
        'unit_per_cell' => 5,
        'default_cell_px' => 70,
    ];

    public const UNIT_LABEL_MAX = 10;
    public const UNIT_PER_CELL_MIN = 0.01;
    public const UNIT_PER_CELL_MAX = 9999.99;
    public const CELL_PX_MIN = 16;
    public const CELL_PX_MAX = 512;

    private const BOOLEANS = ['fog_strict', 'players_blocked_by_walls', 'players_can_move_own_tokens', 'players_see_other_pcs'];

    /**
     * Stored JSON -> complete settings (unknown or invalid stored values fall back to the defaults).
     *
     * @return array<string, mixed>
     */
    public static function fromJson(?string $json): array
    {
        $stored = $json === null ? null : json_decode($json, true);
        $settings = self::DEFAULTS;
        if (!is_array($stored)) {
            return $settings;
        }
        foreach (array_keys(self::DEFAULTS) as $key) {
            if (array_key_exists($key, $stored) && self::check($key, $stored[$key]) !== null) {
                $settings[$key] = self::check($key, $stored[$key]);
            }
        }

        return $settings;
    }

    /**
     * Applies a partial update to $base. Errors are added to $errors as "settings" (not an
     * object, unknown key) or "settings.<key>" => "invalid".
     *
     * @param array<string, mixed>  $base complete settings
     * @param array<string, string> $errors
     * @return array<string, mixed>
     */
    public static function merge(array $base, mixed $patch, array &$errors): array
    {
        $patch = Fields::object($patch, array_keys(self::DEFAULTS));
        if ($patch === null) {
            $errors['settings'] = 'invalid';

            return $base;
        }
        foreach ($patch as $key => $value) {
            $checked = self::check($key, $value);
            if ($checked === null) {
                $errors['settings.' . $key] = self::errorCode($key, $value);
                continue;
            }
            $base[$key] = $checked;
        }

        return $base;
    }

    /**
     * @param array<string, mixed> $settings
     */
    public static function toJson(array $settings): string
    {
        return json_encode($settings, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private static function errorCode(string $key, mixed $value): string
    {
        return match ($key) {
            'unit_label' => is_string($value) && trim($value) === '' ? 'required'
                : (is_string($value) && Fields::text($value, PHP_INT_MAX) !== null ? 'too_long' : 'invalid'),
            'unit_per_cell' => Fields::numberError($value, self::UNIT_PER_CELL_MIN, self::UNIT_PER_CELL_MAX) ?? 'invalid',
            'default_cell_px' => Fields::numberError($value, self::CELL_PX_MIN, self::CELL_PX_MAX, true) ?? 'invalid',
            default => 'invalid',
        };
    }

    private static function check(string $key, mixed $value): mixed
    {
        if (in_array($key, self::BOOLEANS, true)) {
            return is_bool($value) ? $value : null;
        }

        return match ($key) {
            'unit_label' => ($label = Fields::text($value, self::UNIT_LABEL_MAX)) === null || $label === '' ? null : $label,
            'unit_per_cell' => Fields::number($value, self::UNIT_PER_CELL_MIN, self::UNIT_PER_CELL_MAX, 2),
            'default_cell_px' => Fields::int($value, self::CELL_PX_MIN, self::CELL_PX_MAX),
            default => null,
        };
    }
}
