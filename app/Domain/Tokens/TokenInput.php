<?php

declare(strict_types=1);

namespace JDR\Domain\Tokens;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Domain\Games\Fields;

/**
 * Validation of POST /games/{id}/tokens and PATCH /tokens/{id} (contract P3). Distances in cells.
 * Bounds (aligned with the front): name 1-80, size_w/size_h 0.25-20 (DECIMAL(4,2)),
 * vision.range/dark and light.radius/dim_radius 0-1000, light.intensity 0-1, colours "#rrggbb".
 * light.dim_radius is the outer radius of the dim light, so dim_radius >= radius ("below_radius").
 * vision and light accept partial objects merged with the current values (or the defaults);
 * light: null removes the light. Field errors: "<field>" or "<object>.<key>" => required |
 * invalid | too_long | too_small | too_large | below_radius.
 */
final class TokenInput
{
    public const NAME_MAX = 80;
    public const SIZE_MIN = 0.25;
    public const SIZE_MAX = 20.0;
    public const DISTANCE_MAX = 1000.0;
    public const VISION_DEFAULTS = ['enabled' => true, 'range' => 12, 'dark' => 0];
    public const LIGHT_DEFAULTS = ['radius' => 4, 'dim_radius' => 8, 'color' => '#ffcc66', 'intensity' => 0.8, 'flicker' => false];

    private const FIELDS = ['name', 'asset_id', 'kind', 'size_w', 'size_h', 'default_owner_user_id', 'vision', 'light', 'ring_color'];

    /**
     * @param array<array-key, mixed> $body
     * @return array<string, mixed> every column value
     * @throws ValidationException
     */
    public static function create(array $body): array
    {
        $errors = [];
        foreach (['name', 'kind'] as $required) {
            if (!array_key_exists($required, $body)) {
                $errors[$required] = 'required';
            }
        }
        $values = self::read($body, [
            'asset_id' => null,
            'size_w' => 1,
            'size_h' => 1,
            'default_owner_user_id' => null,
            'vision' => self::VISION_DEFAULTS,
            'light' => null,
            'ring_color' => null,
        ], $errors);
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }

        return $values;
    }

    /**
     * @param array<array-key, mixed> $body
     * @return array<string, mixed> changed columns only
     * @throws ValidationException
     */
    public static function patch(array $body, Token $token): array
    {
        $errors = [];
        $changes = self::read($body, ['vision' => $token->vision, 'light' => $token->light], $errors, true);
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }

        return $changes;
    }

    /**
     * Vision object merged over $base; null when invalid (errors added as vision.<key>).
     *
     * @param array<string, mixed>  $base
     * @param array<string, string> $errors
     * @return array{enabled: bool, range: int|float, dark: int|float}|null
     */
    public static function vision(mixed $value, array $base, array &$errors = []): ?array
    {
        $patch = Fields::object($value, array_keys(self::VISION_DEFAULTS));
        if ($patch === null) {
            $errors['vision'] = 'invalid';

            return null;
        }
        $out = $base;
        $failed = false;
        foreach ($patch as $key => $v) {
            if ($key === 'enabled') {
                $checked = is_bool($v) ? $v : null;
                $code = 'invalid';
            } else {
                $checked = Fields::number($v, 0, self::DISTANCE_MAX);
                $code = Fields::numberError($v, 0, self::DISTANCE_MAX) ?? 'invalid';
            }
            if ($checked === null) {
                $errors['vision.' . $key] = $code;
                $failed = true;
                continue;
            }
            $out[$key] = $checked;
        }

        /** @var array{enabled: bool, range: int|float, dark: int|float} $out */
        return $failed ? null : $out;
    }

    /**
     * Light object merged over $base; null when invalid (errors added as light.<key>).
     *
     * @param array<string, mixed>  $base
     * @param array<string, string> $errors
     * @return array{radius: int|float, dim_radius: int|float, color: string, intensity: int|float, flicker: bool}|null
     */
    public static function light(mixed $value, array $base, array &$errors = []): ?array
    {
        $patch = Fields::object($value, array_keys(self::LIGHT_DEFAULTS));
        if ($patch === null) {
            $errors['light'] = 'invalid';

            return null;
        }
        $out = $base;
        $failed = false;
        foreach ($patch as $key => $v) {
            [$checked, $code] = match ($key) {
                'radius', 'dim_radius' => [
                    Fields::number($v, 0, self::DISTANCE_MAX),
                    Fields::numberError($v, 0, self::DISTANCE_MAX) ?? 'invalid',
                ],
                'intensity' => [Fields::number($v, 0, 1), Fields::numberError($v, 0, 1) ?? 'invalid'],
                'color' => [Fields::color($v), 'invalid'],
                default => [is_bool($v) ? $v : null, 'invalid'],
            };
            if ($checked === null) {
                $errors['light.' . $key] = $code;
                $failed = true;
                continue;
            }
            $out[$key] = $checked;
        }
        if (!$failed && $out['dim_radius'] < $out['radius']) {
            $errors['light.dim_radius'] = 'below_radius';
            $failed = true;
        }

        /** @var array{radius: int|float, dim_radius: int|float, color: string, intensity: int|float, flicker: bool} $out */
        return $failed ? null : $out;
    }

    /**
     * Reads the present fields; $defaults gives the values of absent fields (create) or the
     * bases of the partial objects (patch, $onlyPresent).
     *
     * @param array<array-key, mixed> $body
     * @param array<string, mixed>    $defaults
     * @param array<string, string>   $errors
     * @return array<string, mixed>
     */
    private static function read(array $body, array $defaults, array &$errors, bool $onlyPresent = false): array
    {
        $out = $onlyPresent ? [] : $defaults;
        foreach (self::FIELDS as $field) {
            if (!array_key_exists($field, $body)) {
                continue;
            }
            $value = $body[$field];
            switch ($field) {
                case 'name':
                    $name = $value === null ? null : Fields::text($value, PHP_INT_MAX);
                    if ($value === null || $name === '') {
                        $errors['name'] = 'required';
                    } elseif ($name === null) {
                        $errors['name'] = 'invalid';
                    } elseif (mb_strlen($name, 'UTF-8') > self::NAME_MAX) {
                        $errors['name'] = 'too_long';
                    } else {
                        $out['name'] = $name;
                    }
                    break;
                case 'kind':
                    if (!is_string($value) || !in_array($value, Token::KINDS, true)) {
                        $errors['kind'] = 'invalid';
                    } else {
                        $out['kind'] = $value;
                    }
                    break;
                case 'asset_id':
                case 'default_owner_user_id':
                    $id = $value === null ? null : Fields::id($value);
                    if ($value !== null && $id === null) {
                        $errors[$field] = 'invalid';
                    } else {
                        $out[$field] = $id;
                    }
                    break;
                case 'size_w':
                case 'size_h':
                    $size = Fields::number($value, self::SIZE_MIN, self::SIZE_MAX, 2);
                    if ($size === null) {
                        $errors[$field] = Fields::numberError($value, self::SIZE_MIN, self::SIZE_MAX) ?? 'invalid';
                    } else {
                        $out[$field] = $size;
                    }
                    break;
                case 'vision':
                    $base = is_array($defaults['vision'] ?? null) ? $defaults['vision'] : self::VISION_DEFAULTS;
                    $vision = self::vision($value, $base, $errors);
                    if ($vision !== null) {
                        $out['vision'] = $vision;
                    }
                    break;
                case 'light':
                    if ($value === null) {
                        $out['light'] = null;
                        break;
                    }
                    $base = is_array($defaults['light'] ?? null) ? $defaults['light'] : self::LIGHT_DEFAULTS;
                    $light = self::light($value, $base, $errors);
                    if ($light !== null) {
                        $out['light'] = $light;
                    }
                    break;
                case 'ring_color':
                    $color = $value === null ? null : Fields::color($value);
                    if ($value !== null && $color === null) {
                        $errors['ring_color'] = 'invalid';
                    } else {
                        $out['ring_color'] = $color;
                    }
                    break;
            }
        }

        return $out;
    }
}
