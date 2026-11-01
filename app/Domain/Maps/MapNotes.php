<?php

declare(strict_types=1);

namespace JDR\Domain\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Domain\Sessions\NoteVisibility;
use JDR\Domain\Support\Dates;

/**
 * SQL access to map_notes and map_note_users (etapes P09 D3), and the links of map_objects to the
 * notes (note_id, never exposed; the API uses props.note = uid) and revealed_at. Forms:
 * - row: {id, uid, title, body, asset_id: ?int, audience, users: list<int>, read_aloud, updated_at};
 * - editor (GM / co-GM): {uid, title, body, asset_id, audience, audience_users, read_aloud, updated_at};
 * - recipient (player / screen): {uid, title, body, asset_id}: nothing about who else reads it.
 * Ids are strings in the two API forms, as in every JSON of the application.
 */
final class MapNotes
{
    public function __construct(private Db $db, private Clock $clock)
    {
    }

    /**
     * @return list<array<string, mixed>> rows
     */
    public function all(int $mapId): array
    {
        return $this->rows('`map_id` = ?', [$mapId]);
    }

    /**
     * Rows whose uid is among $uids (the uid column ignores case, so does this), by stored uid.
     *
     * @param list<string> $uids
     * @return array<string, array<string, mixed>>
     */
    public function byUids(int $mapId, array $uids): array
    {
        if ($uids === []) {
            return [];
        }
        $rows = $this->rows('`map_id` = ? AND `uid` IN (' . implode(', ', array_fill(0, count($uids), '?')) . ')', [$mapId, ...$uids]);

        return array_column($rows, null, 'uid');
    }

    /**
     * @return array<string, int> stored uid => row id
     */
    public function uids(int $mapId): array
    {
        $out = [];
        foreach ($this->db->fetchAll('SELECT `id`, `uid` FROM ' . $this->db->t('map_notes') . ' WHERE `map_id` = ?', [$mapId]) as $r) {
            $out[(string) $r['uid']] = (int) $r['id'];
        }

        return $out;
    }

    /**
     * @return list<array<string, mixed>> editor forms
     */
    public function forEditor(int $mapId): array
    {
        return array_map(self::editorForm(...), $this->all($mapId));
    }

    /**
     * Notes $viewer sees (a player, or TableView::USER).
     *
     * @return list<array{uid: string, title: string, body: string, asset_id: ?string}>
     */
    public function forRecipient(int $mapId, int $viewer): array
    {
        $visibility = $this->visibility($mapId);
        $out = [];
        foreach ($this->all($mapId) as $row) {
            if ($visibility->visibleTo($row['uid'], $viewer)) {
                $out[] = self::recipientForm($row);
            }
        }

        return $out;
    }

    /**
     * Assets of the notes $viewer sees (null: of every note, for a GM).
     *
     * @return list<int>
     */
    public function assetIds(int $mapId, ?int $viewer): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `uid`, `asset_id` FROM ' . $this->db->t('map_notes') . ' WHERE `map_id` = ? AND `asset_id` IS NOT NULL',
            [$mapId],
        );
        if ($rows === []) {
            return [];
        }
        $visibility = $viewer === null ? null : $this->visibility($mapId);
        $out = [];
        foreach ($rows as $r) {
            if ($visibility === null || $visibility->visibleTo((string) $r['uid'], (int) $viewer)) {
                $out[(int) $r['asset_id']] = (int) $r['asset_id'];
            }
        }

        return array_values($out);
    }

    public function visibility(int $mapId): NoteVisibility
    {
        $rows = $this->db->fetchAll(
            'SELECT n.`uid`, n.`audience`, u.`user_id` FROM ' . $this->db->t('map_notes') . ' n LEFT JOIN ' . $this->db->t('map_note_users')
            . " u ON u.`note_id` = n.`id` WHERE n.`map_id` = ? AND n.`audience` <> 'gm'",
            [$mapId],
        );
        $notes = [];
        foreach ($rows as $r) {
            $uid = (string) $r['uid'];
            $notes[$uid] ??= ['audience' => (string) $r['audience'], 'users' => []];
            if ($r['user_id'] !== null) {
                $notes[$uid]['users'][(int) $r['user_id']] = true;
            }
        }

        return new NoteVisibility($notes);
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function editorForm(array $row): array
    {
        return [
            'uid' => $row['uid'],
            'title' => $row['title'],
            'body' => $row['body'],
            'asset_id' => $row['asset_id'] === null ? null : (string) $row['asset_id'],
            'audience' => $row['audience'],
            'audience_users' => array_map('strval', $row['users']),
            'read_aloud' => $row['read_aloud'],
            'updated_at' => Dates::iso($row['updated_at']),
        ];
    }

    /**
     * @param array<string, mixed> $row
     * @return array{uid: string, title: string, body: string, asset_id: ?string}
     */
    public static function recipientForm(array $row): array
    {
        return [
            'uid' => $row['uid'],
            'title' => $row['title'],
            'body' => $row['body'],
            'asset_id' => $row['asset_id'] === null ? null : (string) $row['asset_id'],
        ];
    }

    // ---- Writes ----------------------------------------------------------------------------

    /**
     * @param array{uid: string, title: string, body: string, asset_id: ?int, audience: string, audience_users: list<int>, read_aloud: bool} $note
     */
    public function insert(int $mapId, array $note): int
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('map_notes') . ' (`map_id`, `uid`, `title`, `body`, `asset_id`, `gm_only`, `audience`, `read_aloud`, `updated_at`) '
            . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $mapId, $note['uid'], $note['title'], $note['body'], $note['asset_id'],
                $note['audience'] === MapNoteInput::AUDIENCE_GM ? 1 : 0, $note['audience'], $note['read_aloud'] ? 1 : 0, $this->clock->sql(),
            ],
        );
        $id = (int) $this->db->lastInsertId();
        $this->addUsers($id, $note['audience_users']);

        return $id;
    }

    /**
     * @param array{title: string, body: string, asset_id: ?int, audience: string, users: list<int>, read_aloud: bool} $row
     */
    public function update(int $id, array $row): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('map_notes') . ' SET `title` = ?, `body` = ?, `asset_id` = ?, `gm_only` = ?, `audience` = ?, `read_aloud` = ?, `updated_at` = ? WHERE `id` = ?',
            [
                $row['title'], $row['body'], $row['asset_id'], $row['audience'] === MapNoteInput::AUDIENCE_GM ? 1 : 0,
                $row['audience'], $row['read_aloud'] ? 1 : 0, $this->clock->sql(), $id,
            ],
        );
        $this->db->execute('DELETE FROM ' . $this->db->t('map_note_users') . ' WHERE `note_id` = ?', [$id]);
        $this->addUsers($id, $row['users']);
    }

    public function delete(int $id): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('map_notes') . ' WHERE `id` = ?', [$id]);
    }

    /**
     * Among $ids, those of the members of the game.
     *
     * @param list<int> $ids
     * @return array<int, true>
     */
    public function members(int $gameId, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $rows = $this->db->fetchAll(
            'SELECT `user_id` FROM ' . $this->db->t('game_members') . ' WHERE `game_id` = ? AND `user_id` IN ('
            . implode(', ', array_fill(0, count($ids), '?')) . ')',
            [$gameId, ...$ids],
        );

        return array_fill_keys(array_map(static fn (array $r): int => (int) $r['user_id'], $rows), true);
    }

    // ---- Objects ---------------------------------------------------------------------------

    /**
     * @param list<int> $noteIds
     * @return list<string> uids of the objects linked to these notes
     */
    public function linkedObjectUids(int $mapId, array $noteIds): array
    {
        if ($noteIds === []) {
            return [];
        }
        $rows = $this->db->fetchAll(
            'SELECT `uid` FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ? AND `note_id` IN ('
            . implode(', ', array_fill(0, count($noteIds), '?')) . ')',
            [$mapId, ...$noteIds],
        );

        return array_map(static fn (array $r): string => (string) $r['uid'], $rows);
    }

    public function linkObject(int $mapId, string $objectUid, ?int $noteId): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('map_objects') . ' SET `note_id` = ? WHERE `map_id` = ? AND `uid` = ?',
            [$noteId, $mapId, $objectUid],
        );
    }

    /**
     * Uids of the traps and secrets currently revealed.
     *
     * @return list<string>
     */
    public function revealedSecretUids(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `uid` FROM ' . $this->db->t('map_objects') . " WHERE `map_id` = ? AND `type` IN ('trap', 'secret') AND `revealed_at` IS NOT NULL",
            [$mapId],
        );

        return array_map(static fn (array $r): string => (string) $r['uid'], $rows);
    }

    /**
     * secrets.reset: every trap and secret hidden again.
     *
     * @return int objects hidden again
     */
    public function resetSecrets(int $mapId): int
    {
        return $this->db->execute(
            'UPDATE ' . $this->db->t('map_objects') . " SET `revealed_at` = NULL, `updated_at` = ? WHERE `map_id` = ? AND `type` IN ('trap', 'secret') AND `revealed_at` IS NOT NULL",
            [$this->clock->sql(), $mapId],
        );
    }

    /**
     * @return array<string, string> object uid => revealed_at (ISO), revealed objects only
     */
    public function revealedTimes(int $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `uid`, `revealed_at` FROM ' . $this->db->t('map_objects') . ' WHERE `map_id` = ? AND `revealed_at` IS NOT NULL',
            [$mapId],
        );
        $out = [];
        foreach ($rows as $r) {
            $out[(string) $r['uid']] = (string) Dates::iso($r['revealed_at']);
        }

        return $out;
    }

    // ---- Documents, duplication ------------------------------------------------------------

    /**
     * The notes of a map document (MapDocumentBuilder): {uid, title, body, asset: "sha256:..." | null,
     * audience, read_aloud}, and asset_id, audience_users when $internal (versions).
     *
     * @return list<array<string, mixed>>
     */
    public function documentNotes(int $mapId, bool $internal): array
    {
        $out = [];
        $rows = $this->all($mapId);
        $hashes = $this->hashes(array_values(array_filter(array_column($rows, 'asset_id'), static fn (mixed $id): bool => $id !== null)));
        foreach ($rows as $row) {
            $hash = $row['asset_id'] === null ? null : ($hashes[$row['asset_id']] ?? null);
            $item = [
                'uid' => $row['uid'],
                'title' => $row['title'],
                'body' => $row['body'],
                'asset' => $hash === null ? null : 'sha256:' . $hash,
                'audience' => $row['audience'],
                'read_aloud' => $row['read_aloud'],
            ];
            if ($internal) {
                $item['asset_id'] = $row['asset_id'];
                $item['audience_users'] = $row['users'];
            }
            $out[] = $item;
        }

        return $out;
    }

    /**
     * Writes the notes of a validated document in place of those of the map, then what the objects
     * of the document say (note_id, revealed_at). $doc['notes'][i]['asset_id'] was resolved by the
     * caller. An account that is no longer a member of the game is dropped; a "players" note left
     * without account goes back to "gm".
     *
     * @param array<string, mixed> $doc normalized document
     * @return array<int, int> asset id => notes using it (map_asset_refs)
     */
    public function writeDocument(int $mapId, array $doc): array
    {
        $this->clear($mapId);
        $notes = $doc['notes'] ?? [];
        $gameId = (int) $this->db->fetchValue('SELECT `game_id` FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [$mapId]);
        $ids = [];
        $refs = [];
        foreach ($notes as $note) {
            $members = $this->members($gameId, $note['audience_users']);
            $note['audience_users'] = array_values(array_filter($note['audience_users'], static fn (int $id): bool => isset($members[$id])));
            if ($note['audience'] === MapNoteInput::AUDIENCE_PLAYERS && $note['audience_users'] === []) {
                $note['audience'] = MapNoteInput::AUDIENCE_GM;
            }
            $note['asset_id'] ??= null;
            $ids[$note['uid']] = $this->insert($mapId, $note);
            if ($note['asset_id'] !== null) {
                $refs[$note['asset_id']] = ($refs[$note['asset_id']] ?? 0) + 1;
            }
        }
        foreach ($doc['objects'] ?? [] as $object) {
            $note = $object['props']['note'] ?? null;
            if (is_string($note) && isset($ids[$note])) {
                $this->linkObject($mapId, $object['uid'], $ids[$note]);
            }
            if (isset($object['revealed_at'])) {
                $this->db->execute(
                    'UPDATE ' . $this->db->t('map_objects') . ' SET `revealed_at` = ? WHERE `map_id` = ? AND `uid` = ?',
                    [$object['revealed_at'], $mapId, $object['uid']],
                );
            }
        }

        return $refs;
    }

    public function clear(int $mapId): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('map_notes') . ' WHERE `map_id` = ?', [$mapId]);
    }

    /**
     * Duplication of a map (same game): same notes, same audiences, objects linked again (the
     * objects are copied first).
     */
    public function copy(int $fromMapId, int $toMapId): void
    {
        foreach ($this->all($fromMapId) as $row) {
            $this->insert($toMapId, ['audience_users' => $row['users']] + $row);
        }
        $o = $this->db->t('map_objects');
        $n = $this->db->t('map_notes');
        $this->db->execute(
            'UPDATE ' . $o . ' o JOIN ' . $o . ' so ON so.`map_id` = ? AND so.`uid` = o.`uid` JOIN ' . $n . ' sn ON sn.`id` = so.`note_id` '
            . 'JOIN ' . $n . ' tn ON tn.`map_id` = o.`map_id` AND tn.`uid` = sn.`uid` SET o.`note_id` = tn.`id` WHERE o.`map_id` = ?',
            [$fromMapId, $toMapId],
        );
    }

    // ---- Internals -------------------------------------------------------------------------

    /**
     * @param list<int> $ids
     */
    private function addUsers(int $noteId, array $ids): void
    {
        foreach ($ids as $id) {
            $this->db->execute('INSERT INTO ' . $this->db->t('map_note_users') . ' (`note_id`, `user_id`) VALUES (?, ?)', [$noteId, $id]);
        }
    }

    /**
     * @param list<int> $assetIds
     * @return array<int, string> asset id => lowercase sha256
     */
    private function hashes(array $assetIds): array
    {
        if ($assetIds === []) {
            return [];
        }
        $rows = $this->db->fetchAll(
            'SELECT `id`, `sha256` FROM ' . $this->db->t('assets') . ' WHERE `id` IN (' . implode(', ', array_fill(0, count($assetIds), '?')) . ')',
            $assetIds,
        );
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['id']] = strtolower((string) $r['sha256']);
        }

        return $out;
    }

    /**
     * @param list<mixed> $params
     * @return list<array<string, mixed>>
     */
    private function rows(string $where, array $params): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `id`, `uid`, `title`, `body`, `asset_id`, `audience`, `read_aloud`, `updated_at` FROM ' . $this->db->t('map_notes')
            . ' WHERE ' . $where . ' ORDER BY `id`',
            $params,
        );
        $users = [];
        $ids = array_map(static fn (array $r): int => (int) $r['id'], $rows);
        if ($ids !== []) {
            $links = $this->db->fetchAll(
                'SELECT `note_id`, `user_id` FROM ' . $this->db->t('map_note_users') . ' WHERE `note_id` IN ('
                . implode(', ', array_fill(0, count($ids), '?')) . ') ORDER BY `user_id`',
                $ids,
            );
            foreach ($links as $l) {
                $users[(int) $l['note_id']][] = (int) $l['user_id'];
            }
        }

        return array_map(static fn (array $r): array => [
            'id' => (int) $r['id'],
            'uid' => (string) $r['uid'],
            'title' => (string) $r['title'],
            'body' => (string) $r['body'],
            'asset_id' => $r['asset_id'] === null ? null : (int) $r['asset_id'],
            'audience' => (string) $r['audience'],
            'users' => $users[(int) $r['id']] ?? [],
            'read_aloud' => (int) $r['read_aloud'] === 1,
            'updated_at' => (string) $r['updated_at'],
        ], $rows);
    }
}
