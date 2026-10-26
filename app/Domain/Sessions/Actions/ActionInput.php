<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions\Actions;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Domain\Games\Fields;
use JDR\Domain\Maps\MapInput;
use JDR\Domain\Maps\MapOpsInput;
use JDR\Maps\FogCodec;
use JDR\Maps\ObjectRules;

/**
 * Stateless validation of POST /sessions/{id}/actions (contract P6 "Actions de séance"):
 * {client_op_id?, actions: [1-20]}; unknown keys refused; field errors "actions" (required |
 * invalid | too_many) and "actions.<i>.<key>". What depends on the map (bounds, floors, uids) is
 * checked by ActionScene, still before anything is applied.
 * - token.move {uid, x, y, rotation?}: x, y 0-400 (3 decimals), rotation integer 0-359;
 * - door.toggle {uid, state?: open | closed}; light.toggle {uid, enabled?: bool};
 * - reveal {kind: object | token, uid};
 * - fog.reveal / fog.hide {floor, chunks: [[cx, cy, base64 raw deflate of 2 048 bytes]] (1-200)};
 * - camera.set {x, y, zoom 0.1-8, floor_id?, follow?: bool};
 * - ambient.set {ambient: patch of map.meta ambient};
 * - note.show {title 1-120, body 0-4000 (multi-line)}.
 */
final class ActionInput
{
    public const MAX_ACTIONS = 20;
    public const ZOOM_MIN = 0.1;
    public const ZOOM_MAX = 8.0;
    public const TITLE_MAX = 120;
    public const BODY_MAX = 4000;
    /** Actions a player may send (the others are GM / co-GM only). */
    public const PLAYER_TYPES = ['token.move', 'fog.reveal'];

    private const KEYS = [
        'token.move' => ['type', 'uid', 'x', 'y', 'rotation'],
        'door.toggle' => ['type', 'uid', 'state'],
        'reveal' => ['type', 'kind', 'uid'],
        'fog.reveal' => ['type', 'floor', 'chunks'],
        'fog.hide' => ['type', 'floor', 'chunks'],
        'camera.set' => ['type', 'x', 'y', 'zoom', 'floor_id', 'follow'],
        'ambient.set' => ['type', 'ambient'],
        'note.show' => ['type', 'title', 'body'],
        'light.toggle' => ['type', 'uid', 'enabled'],
    ];

    /**
     * @param array<array-key, mixed> $body
     * @return list<array<string, mixed>> normalized actions (fog chunks decoded to raw bitmaps)
     * @throws ValidationException
     */
    public static function parse(array $body): array
    {
        $actions = $body['actions'] ?? null;
        if (!is_array($actions) || !array_is_list($actions) || $actions === []) {
            throw new ValidationException('', ['actions' => $actions === null ? 'required' : 'invalid']);
        }
        if (count($actions) > self::MAX_ACTIONS) {
            throw new ValidationException('', ['actions' => 'too_many']);
        }
        $errors = [];
        $out = [];
        foreach ($actions as $i => $action) {
            $parsed = self::action($action, 'actions.' . $i, $errors);
            if ($parsed !== null) {
                $out[] = $parsed;
            }
        }
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }

        return $out;
    }

    /**
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    private static function action(mixed $value, string $field, array &$errors): ?array
    {
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            $errors[$field] = 'invalid';

            return null;
        }
        $type = $value['type'] ?? null;
        if (!is_string($type) || !isset(self::KEYS[$type])) {
            $errors[$field . '.type'] = array_key_exists('type', $value) ? 'invalid' : 'required';

            return null;
        }
        $a = Fields::object($value, self::KEYS[$type]);
        if ($a === null) {
            $errors[$field] = 'invalid';

            return null;
        }
        $before = count($errors);
        $out = match ($type) {
            'token.move' => self::move($a, $field, $errors),
            'door.toggle' => ['uid' => self::uid($a, $field, $errors), 'state' => self::choice($a, 'state', ObjectRules::DOOR_STATES, $field, $errors)],
            'light.toggle' => ['uid' => self::uid($a, $field, $errors), 'enabled' => self::flag($a, 'enabled', $field, $errors)],
            'reveal' => ['kind' => self::choice($a, 'kind', ['object', 'token'], $field, $errors, true), 'uid' => self::uid($a, $field, $errors)],
            'fog.reveal', 'fog.hide' => self::fog($a, $field, $errors),
            'camera.set' => self::camera($a, $field, $errors),
            'ambient.set' => self::ambient($a, $field, $errors),
            default => self::note($a, $field, $errors),
        };

        return count($errors) === $before ? ['type' => $type] + $out : null;
    }

    /**
     * @param array<string, mixed>  $a
     * @param array<string, string> $errors
     * @return array<string, mixed>
     */
    private static function move(array $a, string $field, array &$errors): array
    {
        $rotation = null;
        if (array_key_exists('rotation', $a)) {
            $rotation = Fields::int($a['rotation'], 0, 359);
            if ($rotation === null) {
                $errors[$field . '.rotation'] = Fields::numberError($a['rotation'], 0, 359, true) ?? 'invalid';
            }
        }

        return [
            'uid' => self::uid($a, $field, $errors),
            'x' => self::number($a, 'x', 0, MapInput::GRID_MAX, $field, $errors),
            'y' => self::number($a, 'y', 0, MapInput::GRID_MAX, $field, $errors),
            'rotation' => $rotation,
        ];
    }

    /**
     * @param array<string, mixed>  $a
     * @param array<string, string> $errors
     * @return array<string, mixed>
     */
    private static function fog(array $a, string $field, array &$errors): array
    {
        $floor = Fields::id($a['floor'] ?? null);
        if ($floor === null) {
            $errors[$field . '.floor'] = array_key_exists('floor', $a) ? 'invalid' : 'required';
        }
        $chunks = $a['chunks'] ?? null;
        $out = [];
        if (!is_array($chunks) || !array_is_list($chunks) || $chunks === []) {
            $errors[$field . '.chunks'] = $chunks === null ? 'required' : 'invalid';
        } elseif (count($chunks) > MapOpsInput::MAX_FOG_CHUNKS) {
            $errors[$field . '.chunks'] = 'too_many';
        } else {
            $maxChunk = (MapInput::GRID_MAX - 1) >> 5;
            foreach ($chunks as $j => $chunk) {
                $raw = null;
                $cx = $cy = null;
                if (is_array($chunk) && array_is_list($chunk) && count($chunk) === 3) {
                    $cx = Fields::int($chunk[0], 0, $maxChunk);
                    $cy = Fields::int($chunk[1], 0, $maxChunk);
                    $raw = $cx === null || $cy === null ? null : FogCodec::fromBase64($chunk[2]);
                }
                if ($raw === null) {
                    $errors[$field . '.chunks.' . $j] = 'invalid';
                    break;
                }
                $out[] = [$cx, $cy, $raw];
            }
        }

        return ['floor' => $floor, 'chunks' => $out];
    }

    /**
     * @param array<string, mixed>  $a
     * @param array<string, string> $errors
     * @return array<string, mixed>
     */
    private static function camera(array $a, string $field, array &$errors): array
    {
        $floor = null;
        if (array_key_exists('floor_id', $a) && $a['floor_id'] !== null) {
            $floor = Fields::id($a['floor_id']);
            if ($floor === null) {
                $errors[$field . '.floor_id'] = 'invalid';
            }
        }

        return [
            'x' => self::number($a, 'x', 0, MapInput::GRID_MAX, $field, $errors),
            'y' => self::number($a, 'y', 0, MapInput::GRID_MAX, $field, $errors),
            'zoom' => self::number($a, 'zoom', self::ZOOM_MIN, self::ZOOM_MAX, $field, $errors),
            'floor_id' => $floor,
            'follow' => self::flag($a, 'follow', $field, $errors) ?? true,
        ];
    }

    /**
     * @param array<string, mixed>  $a
     * @param array<string, string> $errors
     * @return array<string, mixed>
     */
    private static function ambient(array $a, string $field, array &$errors): array
    {
        if (!array_key_exists('ambient', $a)) {
            $errors[$field . '.ambient'] = 'required';

            return ['ambient' => null];
        }
        // Values are checked here; ActionScene merges the patch into the stored ambient.
        MapInput::ambient($a['ambient'], MapInput::DEFAULT_AMBIENT, $field . '.ambient', $errors);

        return ['ambient' => $a['ambient']];
    }

    /**
     * @param array<string, mixed>  $a
     * @param array<string, string> $errors
     * @return array<string, mixed>
     */
    private static function note(array $a, string $field, array &$errors): array
    {
        $title = array_key_exists('title', $a) ? Fields::text($a['title'], self::TITLE_MAX) : null;
        if ($title === null || $title === '') {
            $errors[$field . '.title'] = !array_key_exists('title', $a) || $title === '' ? 'required' : (is_string($a['title']) ? 'too_long' : 'invalid');
        }
        $body = array_key_exists('body', $a) ? Fields::text($a['body'], self::BODY_MAX, true) : '';
        if ($body === null) {
            $errors[$field . '.body'] = is_string($a['body']) ? 'too_long' : 'invalid';
        }

        return ['title' => $title, 'body' => $body];
    }

    /**
     * @param array<string, mixed>  $a
     * @param array<string, string> $errors
     */
    private static function uid(array $a, string $field, array &$errors): ?string
    {
        return ObjectRules::uid($a, 'uid', $field . '.uid', $errors);
    }

    /**
     * @param array<string, mixed>  $a
     * @param array<string, string> $errors
     */
    private static function number(array $a, string $key, float $min, float $max, string $field, array &$errors): int|float|null
    {
        if (!array_key_exists($key, $a)) {
            $errors[$field . '.' . $key] = 'required';

            return null;
        }

        return ObjectRules::number($a[$key], $min, $max, $field . '.' . $key, $errors);
    }

    /**
     * Optional (or, $required, mandatory) member among $values.
     *
     * @param array<string, mixed>  $a
     * @param list<string>          $values
     * @param array<string, string> $errors
     */
    private static function choice(array $a, string $key, array $values, string $field, array &$errors, bool $required = false): ?string
    {
        if (!array_key_exists($key, $a) || ($a[$key] === null && !$required)) {
            if ($required) {
                $errors[$field . '.' . $key] = 'required';
            }

            return null;
        }
        if (!is_string($a[$key]) || !in_array($a[$key], $values, true)) {
            $errors[$field . '.' . $key] = 'invalid';

            return null;
        }

        return $a[$key];
    }

    /**
     * Optional boolean member (null when absent or null).
     *
     * @param array<string, mixed>  $a
     * @param array<string, string> $errors
     */
    private static function flag(array $a, string $key, string $field, array &$errors): ?bool
    {
        if (!array_key_exists($key, $a) || $a[$key] === null) {
            return null;
        }
        if (!is_bool($a[$key])) {
            $errors[$field . '.' . $key] = 'invalid';

            return null;
        }

        return $a[$key];
    }
}
