<?php

declare(strict_types=1);

namespace JDR\Domain\Games;

defined('JDR_BOOT') || exit;

/**
 * Strict checks of JSON values shared by games, tokens and encounters. Each helper returns
 * null when the value is invalid (the caller records the field error).
 */
final class Fields
{
    /**
     * Finite JSON number (int or float, never a numeric string) within [$min, $max],
     * rounded to $decimals.
     */
    public static function number(mixed $value, float $min, float $max, int $decimals = 3): int|float|null
    {
        if (!is_int($value) && !is_float($value)) {
            return null;
        }
        if (is_float($value) && !is_finite($value)) {
            return null;
        }
        if ($value < $min || $value > $max) {
            return null;
        }
        if (is_int($value)) {
            return $value;
        }
        $rounded = round($value, $decimals);

        return floor($rounded) === $rounded && abs($rounded) < 1.0E9 ? (int) $rounded : $rounded;
    }

    /**
     * Error code of a number checked by number()/int(): "invalid" (not a number, or not an
     * integer when $integer), "too_small", "too_large"; null when valid.
     */
    public static function numberError(mixed $value, float $min, float $max, bool $integer = false): ?string
    {
        if ((!is_int($value) && !is_float($value)) || (is_float($value) && !is_finite($value))) {
            return 'invalid';
        }
        if ($integer && is_float($value) && floor($value) !== $value) {
            return 'invalid';
        }
        if ($value < $min) {
            return 'too_small';
        }

        return $value > $max ? 'too_large' : null;
    }

    /**
     * Integer (or integral float) within [$min, $max].
     */
    public static function int(mixed $value, int $min, int $max): ?int
    {
        if (is_float($value) && is_finite($value) && floor($value) === $value && abs($value) < 1.0E15) {
            $value = (int) $value;
        }

        return is_int($value) && $value >= $min && $value <= $max ? $value : null;
    }

    /**
     * Colour "#rrggbb", normalized to lower case.
     */
    public static function color(mixed $value): ?string
    {
        return is_string($value) && preg_match('/^#[0-9a-fA-F]{6}$/D', $value) === 1 ? strtolower($value) : null;
    }

    /**
     * Trimmed single-line or multi-line text of at most $max characters; '' when blank.
     */
    public static function text(mixed $value, int $max, bool $multiline = false): ?string
    {
        if (!is_string($value) || preg_match('//u', $value) !== 1 || str_contains($value, "\0")) {
            return null;
        }
        $value = trim($value);
        if (!$multiline && preg_match('/[\x00-\x1F\x7F]/', $value) === 1) {
            return null;
        }

        return mb_strlen($value, 'UTF-8') > $max ? null : $value;
    }

    /**
     * JSON object (associative array, or the empty array) with keys among $allowed.
     *
     * @param list<string> $allowed
     * @return array<string, mixed>|null
     */
    public static function object(mixed $value, array $allowed): ?array
    {
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            return null;
        }
        foreach (array_keys($value) as $key) {
            if (!is_string($key) || !in_array($key, $allowed, true)) {
                return null;
            }
        }

        /** @var array<string, mixed> $value */
        return $value;
    }

    /**
     * Positive id from a string of digits or an integer (JSON ids are strings).
     */
    public static function id(mixed $value): ?int
    {
        if (is_int($value) && $value > 0) {
            return $value;
        }
        if (is_string($value) && $value !== '' && ctype_digit($value) && strlen($value) <= 19 && (int) $value > 0) {
            return (int) $value;
        }

        return null;
    }
}
