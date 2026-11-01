<?php

declare(strict_types=1);

namespace JDR\Maps\Document;

defined('JDR_BOOT') || exit;

use JDR\Domain\Games\Fields;
use JDR\Domain\Maps\MapNoteInput;
use JDR\Maps\ObjectRules;

/**
 * The notes and revealed objects of a map document (etapes P09), for MapDocumentValidator. Pure.
 * A note: {uid, title, body, asset: "sha256:<hex>" | null, audience, read_aloud}, and asset_id,
 * audience_users in an internal document (a version): an asset id or an account means nothing in
 * another installation, so an imported document never carries them and its "players" notes
 * become "gm". Normalized: {uid, title, body, sha256: ?string, asset_id?: int, audience,
 * audience_users: list<int>, read_aloud}. asset_id is resolved by the caller of the writer.
 * An object may carry revealed_at (ISO, UTC): normalized to the SQL form. A props.note without note
 * in the document becomes null.
 */
final class MapDocumentNotes
{
    private const KEYS = ['uid', 'title', 'body', 'asset', 'audience', 'read_aloud'];
    private const ASSET_REF = '/^sha256:([0-9a-fA-F]{64})$/D';

    /**
     * @param array<string, string> $errors
     * @return list<array<string, mixed>>
     */
    public static function parse(mixed $value, bool $internal, array &$errors): array
    {
        if ($value === null || $value === []) {
            return [];
        }
        if (!is_array($value) || !array_is_list($value)) {
            $errors['notes'] = 'invalid';

            return [];
        }
        if (count($value) > MapNoteInput::MAX_NOTES) {
            $errors['notes'] = 'too_many';

            return [];
        }
        $keys = $internal ? [...self::KEYS, 'asset_id', 'audience_users'] : self::KEYS;
        $out = [];
        $seen = [];
        foreach ($value as $i => $item) {
            $field = 'notes.' . $i;
            $before = count($errors);
            $n = Fields::object($item, $keys);
            if ($n === null || $n === []) {
                $errors[$field] = 'invalid';
                continue;
            }
            $uid = ObjectRules::uid($n, 'uid', $field . '.uid', $errors);
            if ($uid !== null && isset($seen[strtolower($uid)])) {
                $errors[$field . '.uid'] = 'duplicate';
            }
            $seen[strtolower((string) $uid)] = true;
            $sha = null;
            if (($n['asset'] ?? null) !== null) {
                if (!is_string($n['asset']) || preg_match(self::ASSET_REF, $n['asset'], $m) !== 1) {
                    $errors[$field . '.asset'] = 'invalid';
                } else {
                    $sha = strtolower($m[1]);
                }
            }
            // Accounts do not travel; a version may hold a note whose accounts were all deleted.
            if (($n['audience'] ?? null) === MapNoteInput::AUDIENCE_PLAYERS && (!$internal || ($n['audience_users'] ?? []) === [])) {
                $n['audience'] = MapNoteInput::AUDIENCE_GM;
            }
            $values = MapNoteInput::values(array_diff_key($n, ['uid' => 0, 'asset' => 0]), $field, $errors, false);
            if (count($errors) !== $before) {
                continue;
            }
            $out[] = ['uid' => $uid, 'sha256' => $sha] + $values + ['audience' => MapNoteInput::AUDIENCE_GM, 'audience_users' => [], 'read_aloud' => false];
        }

        return $out;
    }

    /**
     * Takes revealed_at out of an object of the document.
     *
     * @param array<string, string> $errors
     * @return array{0: mixed, 1: ?string} [the object without it, SQL datetime]
     */
    public static function takeRevealed(mixed $item, string $field, array &$errors): array
    {
        if (!is_array($item) || !array_key_exists('revealed_at', $item)) {
            return [$item, null];
        }
        $value = $item['revealed_at'];
        unset($item['revealed_at']);
        if ($value === null) {
            return [$item, null];
        }
        $at = is_string($value) ? \DateTimeImmutable::createFromFormat('Y-m-d\TH:i:s\Z', $value, new \DateTimeZone('UTC')) : false;
        if ($at === false || $at->format('Y-m-d\TH:i:s\Z') !== $value) {
            $errors[$field . '.revealed_at'] = 'invalid';

            return [$item, null];
        }

        return [$item, $at->format('Y-m-d H:i:s')];
    }

    /**
     * A props.note that names no note of the document becomes null.
     *
     * @param list<array<string, mixed>> $objects
     * @param list<array<string, mixed>> $notes
     * @return list<array<string, mixed>>
     */
    public static function relink(array $objects, array $notes): array
    {
        $known = array_fill_keys(array_column($notes, 'uid'), true);
        foreach ($objects as $i => $object) {
            $note = $object['props']['note'] ?? null;
            if (is_string($note) && !isset($known[$note])) {
                $objects[$i]['props']['note'] = null;
            }
        }

        return $objects;
    }

    /**
     * asset_id of the notes of an imported document from the resolved hashes; the references left
     * unresolved are listed.
     *
     * @param list<array<string, mixed>> $notes
     * @param array<string, int>         $bySha
     * @param array<string, array{ref: string, name: string}> $missing
     * @return list<array<string, mixed>>
     */
    public static function resolveImported(array $notes, array $bySha, array &$missing): array
    {
        foreach ($notes as $i => $note) {
            $sha = $note['sha256'];
            $notes[$i]['asset_id'] = $sha === null ? null : ($bySha[$sha] ?? null);
            if ($sha !== null && !isset($bySha[$sha])) {
                $missing['sha256:' . $sha] ??= ['ref' => 'sha256:' . $sha, 'name' => $note['title']];
            }
        }

        return $notes;
    }
}
