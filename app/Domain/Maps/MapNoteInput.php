<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Domain\Games\Fields;
use JDR\Maps\ObjectRules;

/**
 * Stateless validation of the note ops of POST /maps/{id}/ops (etapes P09 D3), shared with the
 * session action note.share and the map document:
 * - note.add {note: {uid, title, body, asset_id?, audience?, audience_users?, read_aloud?}};
 * - note.update {uid, patch: same members but uid, at least one}; note.remove {uid};
 * - secrets.reset {}.
 * title 1-120 after trim, body <= 20 000 characters (Markdown stored as it is, never transformed),
 * audience gm | players | all (default gm), audience_users: ids, required and non-empty for
 * "players", ignored otherwise. What depends on the map (uid taken, membership, asset, limit) is
 * checked by MapNotesOps. Field errors: ops.<i>.note.<key> / ops.<i>.patch.<key>: required |
 * invalid | too_long | too_many.
 */
final class MapNoteInput
{
    public const TITLE_MAX = 120;
    public const BODY_MAX = 20000;
    public const MAX_NOTES = 500;
    public const MAX_USERS = 500;
    public const AUDIENCE_GM = 'gm';
    public const AUDIENCE_PLAYERS = 'players';
    public const AUDIENCE_ALL = 'all';
    public const AUDIENCES = [self::AUDIENCE_GM, self::AUDIENCE_PLAYERS, self::AUDIENCE_ALL];

    private const PATCH_KEYS = ['title', 'body', 'asset_id', 'audience', 'audience_users', 'read_aloud'];

    /**
     * @param array<string, mixed>  $op
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    public static function add(array $op, string $field, array &$errors): ?array
    {
        $f = $field . '.note';
        if (!array_key_exists('note', $op)) {
            $errors[$f] = 'required';

            return null;
        }
        $n = Fields::object($op['note'], ['uid', ...self::PATCH_KEYS]);
        if ($n === null || $n === []) {
            $errors[$f] = 'invalid';

            return null;
        }
        $before = count($errors);
        $uid = ObjectRules::uid($n, 'uid', $f . '.uid', $errors);
        $values = self::values($n, $f, $errors, false);
        if (count($errors) !== $before || $uid === null) {
            return null;
        }

        return ['type' => 'note.add', 'note' => ['uid' => $uid] + $values + [
            'asset_id' => null,
            'audience' => self::AUDIENCE_GM,
            'audience_users' => [],
            'read_aloud' => false,
        ]];
    }

    /**
     * @param array<string, mixed>  $op
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    public static function update(array $op, string $field, array &$errors): ?array
    {
        $before = count($errors);
        $uid = ObjectRules::uid($op, 'uid', $field . '.uid', $errors);
        $f = $field . '.patch';
        $patch = Fields::object($op['patch'] ?? null, self::PATCH_KEYS);
        if ($patch === null || $patch === []) {
            $errors[$f] = array_key_exists('patch', $op) ? 'invalid' : 'required';

            return null;
        }
        $values = self::values($patch, $f, $errors, true);

        return count($errors) === $before && $uid !== null ? ['type' => 'note.update', 'uid' => $uid, 'patch' => $values] : null;
    }

    /**
     * @param array<string, mixed>  $op
     * @param array<string, string> $errors
     * @return array<string, mixed>|null
     */
    public static function remove(array $op, string $field, array &$errors): ?array
    {
        $uid = ObjectRules::uid($op, 'uid', $field . '.uid', $errors);

        return $uid === null ? null : ['type' => 'note.remove', 'uid' => $uid];
    }

    /**
     * The members of a note present in $n (title and body required unless $partial).
     *
     * @param array<string, mixed>  $n
     * @param array<string, string> $errors
     * @return array<string, mixed>
     */
    public static function values(array $n, string $f, array &$errors, bool $partial): array
    {
        $out = [];
        if (array_key_exists('title', $n) || !$partial) {
            $out['title'] = self::title($n['title'] ?? null, $f . '.title', $errors);
        }
        if (array_key_exists('body', $n) || !$partial) {
            $out['body'] = self::body($n['body'] ?? null, $f . '.body', $errors);
        }
        if (array_key_exists('asset_id', $n) && $n['asset_id'] !== null) {
            $out['asset_id'] = Fields::id($n['asset_id']);
            if ($out['asset_id'] === null) {
                $errors[$f . '.asset_id'] = 'invalid';
            }
        } elseif (array_key_exists('asset_id', $n)) {
            $out['asset_id'] = null;
        }
        if (array_key_exists('read_aloud', $n)) {
            $out['read_aloud'] = $n['read_aloud'] === true;
            if (!is_bool($n['read_aloud'])) {
                $errors[$f . '.read_aloud'] = 'invalid';
            }
        }
        if (array_key_exists('audience', $n)) {
            $out['audience'] = self::audience($n['audience'], $f . '.audience', $errors);
        }
        // A patch may name the accounts alone (the note already is "players"), or the audience
        // "players" alone (MapNotesOps then needs accounts already stored).
        $audience = $out['audience'] ?? ($partial ? null : self::AUDIENCE_GM);
        if ($audience === self::AUDIENCE_GM || $audience === self::AUDIENCE_ALL) {
            $out['audience_users'] = [];
        } elseif (array_key_exists('audience_users', $n) || !$partial) {
            $out['audience_users'] = self::users($n['audience_users'] ?? null, $f . '.audience_users', $errors);
        }

        return $out;
    }

    /**
     * Accounts of the audience "players": non-empty list of ids, without duplicates.
     *
     * @param array<string, string> $errors
     * @return list<int>
     */
    public static function users(mixed $value, string $field, array &$errors): array
    {
        if ($value === null || $value === []) {
            $errors[$field] = 'required';

            return [];
        }
        if (!is_array($value) || !array_is_list($value)) {
            $errors[$field] = 'invalid';

            return [];
        }
        if (count($value) > self::MAX_USERS) {
            $errors[$field] = 'too_many';

            return [];
        }
        $ids = [];
        foreach ($value as $v) {
            $id = Fields::id($v);
            if ($id === null) {
                $errors[$field] = 'invalid';

                return [];
            }
            $ids[$id] = $id;
        }

        return array_values($ids);
    }

    /**
     * @param array<string, string> $errors
     */
    public static function audience(mixed $value, string $field, array &$errors): ?string
    {
        if (!is_string($value) || !in_array($value, self::AUDIENCES, true)) {
            $errors[$field] = $value === null ? 'required' : 'invalid';

            return null;
        }

        return $value;
    }

    /**
     * @param array<string, string> $errors
     */
    private static function title(mixed $value, string $field, array &$errors): ?string
    {
        $title = Fields::text($value, self::TITLE_MAX);
        if ($title === null || $title === '') {
            $long = is_string($value) && mb_strlen(trim($value), 'UTF-8') > self::TITLE_MAX;
            $errors[$field] = $value === null || $title === '' ? 'required' : ($long ? 'too_long' : 'invalid');

            return null;
        }

        return $title;
    }

    /**
     * The body as it was sent (no trim): only its type and size are checked.
     *
     * @param array<string, string> $errors
     */
    private static function body(mixed $value, string $field, array &$errors): ?string
    {
        if (!is_string($value) || preg_match('//u', $value) !== 1 || str_contains($value, "\0")) {
            $errors[$field] = $value === null ? 'required' : 'invalid';

            return null;
        }
        if (mb_strlen($value, 'UTF-8') > self::BODY_MAX) {
            $errors[$field] = 'too_long';

            return null;
        }

        return $value;
    }
}
