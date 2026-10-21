<?php

declare(strict_types=1);

namespace JDR\Domain\Games;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;

/**
 * Validation of the bodies of POST /games and PATCH /games/{id} (contract P3).
 * name 1-120 characters, description at most 5000 (blank => null), settings validated key by key.
 */
final class GameInput
{
    public const NAME_MAX = 120;
    public const DESCRIPTION_MAX = 5000;

    /**
     * @param array<array-key, mixed> $body
     * @return array{name: string, description: ?string, settings: array<string, mixed>}
     * @throws ValidationException
     */
    public static function create(array $body): array
    {
        $errors = [];
        $name = self::name($body['name'] ?? null, $errors);
        $description = array_key_exists('description', $body) ? self::description($body['description'], $errors) : null;
        $settings = GameSettings::DEFAULTS;
        if (array_key_exists('settings', $body) && $body['settings'] !== null) {
            $settings = GameSettings::merge($settings, $body['settings'], $errors);
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }

        return ['name' => (string) $name, 'description' => $description, 'settings' => $settings];
    }

    /**
     * @param array<array-key, mixed> $body
     * @return array{name?: string, description?: ?string, cover_asset_id?: ?int, settings?: array<string, mixed>}
     * @throws ValidationException
     */
    public static function patch(array $body, Game $game): array
    {
        $errors = [];
        $changes = [];
        if (array_key_exists('name', $body)) {
            $changes['name'] = (string) self::name($body['name'], $errors);
        }
        if (array_key_exists('description', $body)) {
            $changes['description'] = self::description($body['description'], $errors);
        }
        if (array_key_exists('cover_asset_id', $body)) {
            $cover = $body['cover_asset_id'];
            $changes['cover_asset_id'] = $cover === null ? null : Fields::id($cover);
            if ($cover !== null && $changes['cover_asset_id'] === null) {
                $errors['cover_asset_id'] = 'invalid';
            }
        }
        if (array_key_exists('settings', $body)) {
            $changes['settings'] = GameSettings::merge($game->settings, $body['settings'], $errors);
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }

        return $changes;
    }

    /**
     * @param array<string, string> $errors
     */
    private static function name(mixed $value, array &$errors): ?string
    {
        if ($value === null || $value === '' || (is_string($value) && trim($value) === '')) {
            $errors['name'] = 'required';

            return null;
        }
        $name = Fields::text($value, PHP_INT_MAX);
        if ($name === null) {
            $errors['name'] = 'invalid';

            return null;
        }
        if (mb_strlen($name, 'UTF-8') > self::NAME_MAX) {
            $errors['name'] = 'too_long';

            return null;
        }

        return $name;
    }

    /**
     * @param array<string, string> $errors
     */
    private static function description(mixed $value, array &$errors): ?string
    {
        if ($value === null) {
            return null;
        }
        $text = Fields::text($value, PHP_INT_MAX, true);
        if ($text === null) {
            $errors['description'] = 'invalid';

            return null;
        }
        if (mb_strlen($text, 'UTF-8') > self::DESCRIPTION_MAX) {
            $errors['description'] = 'too_long';

            return null;
        }

        return $text === '' ? null : $text;
    }
}
