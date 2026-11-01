<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Domain\Games\Fields;
use JDR\Domain\Maps\MapFloors;
use JDR\Domain\Maps\MapInput;
use JDR\Maps\ObjectRules;

/**
 * Validation of the bodies of the session endpoints. Errors: ValidationException with
 * fields {name: required | invalid | too_long | not_found...} (422).
 */
final class SessionInput
{
    public const NAME_MAX = 120;
    public const MAX_MOVE_TOKENS = 100;
    public const PAUSE_TEXT_MAX = 2000;

    /**
     * @param array<array-key, mixed> $body {name?, map_id?, floor_id?}
     * @return array{name: ?string, map_id: ?int, floor_id: int|string|null}
     */
    public static function create(array $body): array
    {
        $errors = [];
        $name = array_key_exists('name', $body) ? self::name($body['name'], $errors) : null;
        $mapId = self::optionalId($body, 'map_id', $errors);
        $floorId = null;
        if (array_key_exists('floor_id', $body) && $body['floor_id'] !== null) {
            $floorId = MapFloors::ref($body['floor_id']);
            if ($floorId === null) {
                $errors['floor_id'] = 'invalid';
            }
        }
        if ($mapId === null && $floorId !== null && !isset($errors['floor_id'])) {
            $errors['map_id'] = 'required';
        }
        self::throw($errors);

        return ['name' => $name, 'map_id' => $mapId, 'floor_id' => $floorId];
    }

    /**
     * @param array<array-key, mixed> $body {name?, pause_screen?}
     * @return array{name?: ?string, pause_screen?: array{asset_id: ?int, text: ?string}|null}
     */
    public static function patch(array $body): array
    {
        $errors = [];
        $out = [];
        if (array_key_exists('name', $body)) {
            $out['name'] = self::name($body['name'], $errors);
        }
        if (array_key_exists('pause_screen', $body)) {
            $out['pause_screen'] = self::pauseScreen($body['pause_screen'], $errors);
        }
        self::throw($errors);

        return $out;
    }

    /**
     * POST /sessions/{id}/change-map (P9a1): {map_id, floor_id? (id or uid), focus?: {x, y} (cells),
     * move_tokens?: [placed token uid, ...] (<= 100, needs focus), client_op_id?}.
     *
     * @param array<array-key, mixed> $body
     * @return array{map_id: int, floor_id: int|string|null, focus: array{0: int|float, 1: int|float}|null, move_tokens: list<string>}
     */
    public static function changeMap(array $body): array
    {
        $errors = [];
        $mapId = self::optionalId($body, 'map_id', $errors);
        $floorId = null;
        if (array_key_exists('floor_id', $body) && $body['floor_id'] !== null) {
            $floorId = MapFloors::ref($body['floor_id']);
            if ($floorId === null) {
                $errors['floor_id'] = 'invalid';
            }
        }
        if ($mapId === null && !isset($errors['map_id'])) {
            $errors['map_id'] = 'required';
        }
        $focus = null;
        if (array_key_exists('focus', $body) && $body['focus'] !== null) {
            $f = Fields::object($body['focus'], ['x', 'y']);
            $max = (float) MapInput::GRID_MAX;
            $x = $f === null ? null : Fields::number($f['x'] ?? null, 0, $max);
            $y = $f === null ? null : Fields::number($f['y'] ?? null, 0, $max);
            if ($x === null || $y === null) {
                $errors['focus'] = 'invalid';
            } else {
                $focus = [$x, $y];
            }
        }
        $tokens = [];
        if (array_key_exists('move_tokens', $body) && $body['move_tokens'] !== null) {
            $list = $body['move_tokens'];
            if (!is_array($list) || !array_is_list($list)) {
                $errors['move_tokens'] = 'invalid';
            } elseif (count($list) > self::MAX_MOVE_TOKENS) {
                $errors['move_tokens'] = 'too_many';
            } else {
                foreach ($list as $i => $uid) {
                    if (!ObjectRules::isUid($uid)) {
                        $errors['move_tokens.' . $i] = 'invalid';
                    } elseif (isset($tokens[strtolower($uid)])) {
                        $errors['move_tokens.' . $i] = 'duplicate';
                    } else {
                        $tokens[strtolower($uid)] = $uid;
                    }
                }
            }
            if ($tokens !== [] && $focus === null && !isset($errors['focus'])) {
                $errors['focus'] = 'required';
            }
        }
        self::throw($errors);

        return ['map_id' => (int) $mapId, 'floor_id' => $floorId, 'focus' => $focus, 'move_tokens' => array_values($tokens)];
    }

    /**
     * @param array<array-key, mixed> $body {user_id}
     */
    public static function userId(array $body): int
    {
        $raw = $body['user_id'] ?? null;
        if ($raw === null) {
            throw new ValidationException('', ['user_id' => 'required']);
        }

        return Fields::id($raw) ?? throw new ValidationException('', ['user_id' => 'invalid']);
    }

    /**
     * {user_id: id | null} of an assignment: the key is required.
     *
     * @param array<array-key, mixed> $body
     */
    public static function assignee(array $body): ?int
    {
        if (!array_key_exists('user_id', $body)) {
            throw new ValidationException('', ['user_id' => 'required']);
        }
        if ($body['user_id'] === null) {
            return null;
        }

        return Fields::id($body['user_id']) ?? throw new ValidationException('', ['user_id' => 'invalid']);
    }

    /**
     * @param array<array-key, mixed> $body {ready: bool}
     */
    public static function ready(array $body): bool
    {
        if (!array_key_exists('ready', $body)) {
            throw new ValidationException('', ['ready' => 'required']);
        }

        return is_bool($body['ready']) ? $body['ready'] : throw new ValidationException('', ['ready' => 'invalid']);
    }

    /**
     * @param array<string, string> $errors
     */
    private static function name(mixed $value, array &$errors): ?string
    {
        if ($value === null) {
            return null;
        }
        $text = Fields::text($value, self::NAME_MAX);
        if ($text === null) {
            $errors['name'] = is_string($value) && Fields::text($value, PHP_INT_MAX) !== null ? 'too_long' : 'invalid';

            return null;
        }

        return $text === '' ? null : $text;
    }

    /**
     * @param array<string, string> $errors
     * @return array{asset_id: ?int, text: ?string}|null
     */
    private static function pauseScreen(mixed $value, array &$errors): ?array
    {
        if ($value === null) {
            return null;
        }
        $object = Fields::object($value, ['asset_id', 'text']);
        if ($object === null) {
            $errors['pause_screen'] = 'invalid';

            return null;
        }
        $assetId = null;
        if (($object['asset_id'] ?? null) !== null) {
            $assetId = Fields::id($object['asset_id']);
            if ($assetId === null) {
                $errors['pause_screen.asset_id'] = 'invalid';
            }
        }
        $text = null;
        if (($object['text'] ?? null) !== null) {
            $text = Fields::text($object['text'], self::PAUSE_TEXT_MAX, true);
            if ($text === null) {
                $errors['pause_screen.text'] = is_string($object['text']) && Fields::text($object['text'], PHP_INT_MAX, true) !== null
                    ? 'too_long' : 'invalid';
            } elseif ($text === '') {
                $text = null;
            }
        }

        return ['asset_id' => $assetId, 'text' => $text];
    }

    /**
     * @param array<array-key, mixed> $body
     * @param array<string, string>   $errors
     */
    private static function optionalId(array $body, string $key, array &$errors): ?int
    {
        if (!array_key_exists($key, $body) || $body[$key] === null) {
            return null;
        }
        $id = Fields::id($body[$key]);
        if ($id === null) {
            $errors[$key] = 'invalid';
        }

        return $id;
    }

    /**
     * @param array<string, string> $errors
     */
    private static function throw(array $errors): void
    {
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
    }
}
