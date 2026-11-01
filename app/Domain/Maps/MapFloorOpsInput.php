<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Domain\Games\Fields;

/**
 * Stateless validation of the floor ops of POST /maps/{id}/ops (P9a1, D1):
 * - floor.add {floor: {uid, name, level}}: uid [A-Za-z0-9_-]{1,21} not entirely numeric, name 1-60
 *   after trim, level integer -9..+9;
 * - floor.update {uid, patch: {name?, level?}} (patch not empty);
 * - floor.remove {uid}.
 * What depends on the map (uid / level taken, 10 floors max, last floor, unknown uid) is checked
 * by FloorApplier. Field errors: "ops.<i>.floor.uid|name|level", "ops.<i>.uid", "ops.<i>.patch[.name|level]".
 */
final class MapFloorOpsInput
{
    public const KEYS = [
        'floor.add' => ['type', 'floor'],
        'floor.update' => ['type', 'uid', 'patch'],
        'floor.remove' => ['type', 'uid'],
    ];

    /**
     * @param array<string, mixed>  $op
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    public static function parse(array $op, string $field, array &$errors): ?array
    {
        $before = count($errors);
        switch ($op['type']) {
            case 'floor.add':
                $f = Fields::object($op['floor'] ?? null, ['uid', 'name', 'level']);
                if ($f === null || $f === []) {
                    $errors[$field . '.floor'] = array_key_exists('floor', $op) ? 'invalid' : 'required';

                    return null;
                }
                $uid = self::uid($f, $field . '.floor.uid', $errors);
                $name = self::name($f['name'] ?? null, array_key_exists('name', $f), $field . '.floor.name', $errors);
                $level = self::level($f['level'] ?? null, array_key_exists('level', $f), $field . '.floor.level', $errors);

                return count($errors) === $before ? ['type' => 'floor.add', 'floor' => ['uid' => $uid, 'name' => $name, 'level' => $level]] : null;
            case 'floor.update':
                $uid = self::uid($op, $field . '.uid', $errors);
                $patch = Fields::object($op['patch'] ?? null, ['name', 'level']);
                if ($patch === null || $patch === []) {
                    $errors[$field . '.patch'] = array_key_exists('patch', $op) ? 'invalid' : 'required';

                    return null;
                }
                $out = [];
                if (array_key_exists('name', $patch)) {
                    $out['name'] = self::name($patch['name'], true, $field . '.patch.name', $errors);
                }
                if (array_key_exists('level', $patch)) {
                    $out['level'] = self::level($patch['level'], true, $field . '.patch.level', $errors);
                }

                return count($errors) === $before ? ['type' => 'floor.update', 'uid' => $uid, 'patch' => $out] : null;
            default:
                $uid = self::uid($op, $field . '.uid', $errors);

                return count($errors) === $before ? ['type' => 'floor.remove', 'uid' => $uid] : null;
        }
    }

    /**
     * @param array<string, mixed>  $o
     * @param array<string, string> $errors
     */
    private static function uid(array $o, string $field, array &$errors): ?string
    {
        $uid = $o['uid'] ?? null;
        if (!MapFloors::isUid($uid)) {
            $errors[$field] = array_key_exists('uid', $o) ? 'invalid' : 'required';

            return null;
        }

        return $uid;
    }

    /**
     * @param array<string, string> $errors
     */
    private static function name(mixed $value, bool $present, string $field, array &$errors): ?string
    {
        if (!$present) {
            $errors[$field] = 'required';

            return null;
        }
        $name = is_string($value) ? trim($value) : null;
        if ($name === null || $name === '' || mb_strlen($name) > 60) {
            $errors[$field] = 'invalid';

            return null;
        }

        return $name;
    }

    /**
     * @param array<string, string> $errors
     */
    private static function level(mixed $value, bool $present, string $field, array &$errors): ?int
    {
        if (!$present) {
            $errors[$field] = 'required';

            return null;
        }
        $level = is_int($value) && $value >= MapFloors::LEVEL_MIN && $value <= MapFloors::LEVEL_MAX ? $value : null;
        if ($level === null) {
            $errors[$field] = 'invalid';
        }

        return $level;
    }
}
