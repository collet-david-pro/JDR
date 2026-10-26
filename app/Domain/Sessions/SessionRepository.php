<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Core\Response;

/**
 * SQL access to play_sessions, session_players, token_assignments and the session part of
 * processed_ops (projet.md 7.2). No right check here: see SessionAccess.
 */
final class SessionRepository
{
    private const COLUMNS = '`id`, `game_id`, `code`, `name`, `state`, `current_map_id`, `current_floor_id`, `camera`, '
        . '`pause_screen`, `created_by`, `created_at`, `started_at`, `ended_at`';

    public function __construct(private Db $db, private Clock $clock)
    {
    }

    public function db(): Db
    {
        return $this->db;
    }

    // ---- Sessions --------------------------------------------------------------------------

    public function find(int $id): ?Session
    {
        $row = $this->db->fetchOne('SELECT ' . self::COLUMNS . ' FROM ' . $this->db->t('play_sessions') . ' WHERE `id` = ?', [$id]);

        return $row === null ? null : Session::fromRow($row);
    }

    public function findForUpdate(int $id): ?Session
    {
        $row = $this->db->fetchOne(
            'SELECT ' . self::COLUMNS . ' FROM ' . $this->db->t('play_sessions') . ' WHERE `id` = ? FOR UPDATE',
            [$id],
        );

        return $row === null ? null : Session::fromRow($row);
    }

    public function findByCode(string $code): ?Session
    {
        $row = $this->db->fetchOne('SELECT ' . self::COLUMNS . ' FROM ' . $this->db->t('play_sessions') . ' WHERE `code` = ?', [$code]);

        return $row === null ? null : Session::fromRow($row);
    }

    public function codeExists(string $code): bool
    {
        return $this->db->fetchValue('SELECT 1 FROM ' . $this->db->t('play_sessions') . ' WHERE `code` = ?', [$code]) !== null;
    }

    /**
     * Session and game of $userId in one row: the game (GM, settings, trash), the membership
     * role and the player status; null when the session does not exist.
     *
     * @return array<string, mixed>|null
     */
    public function accessRow(int $sessionId, int $userId): ?array
    {
        return $this->db->fetchOne(
            'SELECT s.*, g.`gm_user_id`, g.`settings` AS `game_settings`, g.`deleted_at` AS `game_deleted_at`, '
            . 'm.`role` AS `member_role`, p.`status` AS `player_status` '
            . 'FROM ' . $this->db->t('play_sessions') . ' s '
            . 'JOIN ' . $this->db->t('games') . ' g ON g.`id` = s.`game_id` '
            . 'LEFT JOIN ' . $this->db->t('game_members') . ' m ON m.`game_id` = s.`game_id` AND m.`user_id` = ? '
            . 'LEFT JOIN ' . $this->db->t('session_players') . ' p ON p.`session_id` = s.`id` AND p.`user_id` = ? '
            . 'WHERE s.`id` = ?',
            [$userId, $userId, $sessionId],
        );
    }

    /**
     * Id of the open (not ended) session of a game, if any. Call under the game row lock.
     */
    public function openSessionId(int $gameId): ?int
    {
        $id = $this->db->fetchValue(
            'SELECT `id` FROM ' . $this->db->t('play_sessions') . " WHERE `game_id` = ? AND `state` <> 'ended' ORDER BY `id` LIMIT 1",
            [$gameId],
        );

        return $id === null ? null : (int) $id;
    }

    public function lockGame(int $gameId): void
    {
        $this->db->fetchValue('SELECT `id` FROM ' . $this->db->t('games') . ' WHERE `id` = ? FOR UPDATE', [$gameId]);
    }

    public function insert(int $gameId, string $code, ?string $name, ?int $mapId, ?int $floorId, int $createdBy): int
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('play_sessions') . ' (`game_id`, `code`, `name`, `state`, `current_map_id`, '
            . '`current_floor_id`, `created_by`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$gameId, $code, $name, Session::LOBBY, $mapId, $floorId, $createdBy, $this->clock->sql()],
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $fields among name, state, code, current_map_id, current_floor_id, camera,
     *                                     pause_screen, started_at, ended_at (camera / pause_screen as arrays)
     */
    public function update(int $id, array $fields): void
    {
        $allowed = array_intersect_key($fields, array_flip([
            'name', 'state', 'code', 'current_map_id', 'current_floor_id', 'camera', 'pause_screen', 'started_at', 'ended_at',
        ]));
        if ($allowed === []) {
            return;
        }
        $sets = [];
        $params = [];
        foreach ($allowed as $column => $value) {
            $sets[] = '`' . $column . '` = ?';
            $params[] = is_array($value) ? json_encode($value, Response::JSON_FLAGS) : $value;
        }
        $params[] = $id;
        $this->db->execute('UPDATE ' . $this->db->t('play_sessions') . ' SET ' . implode(', ', $sets) . ' WHERE `id` = ?', $params);
    }

    /**
     * Sessions of a game, most recent first. $playerId set => only those where this user is a
     * player who was not kicked.
     *
     * @return list<Session>
     */
    public function listForGame(int $gameId, ?int $playerId, ?int $before, int $limit): array
    {
        $sql = 'SELECT ' . self::COLUMNS . ' FROM ' . $this->db->t('play_sessions') . ' s WHERE s.`game_id` = ?';
        $params = [$gameId];
        if ($playerId !== null) {
            $sql .= ' AND EXISTS (SELECT 1 FROM ' . $this->db->t('session_players') . " p WHERE p.`session_id` = s.`id` AND p.`user_id` = ? AND p.`status` <> 'kicked')";
            $params[] = $playerId;
        }
        if ($before !== null) {
            $sql .= ' AND s.`id` < ?';
            $params[] = $before;
        }
        $rows = $this->db->fetchAll($sql . ' ORDER BY s.`id` DESC LIMIT ' . max(1, $limit), $params);

        return array_map(static fn (array $r): Session => Session::fromRow($r), $rows);
    }

    /**
     * Deletes the sessions ended before $before (players, assignments, displays by FK CASCADE).
     */
    public function purgeEnded(string $before, int $limit): int
    {
        return $this->db->execute(
            'DELETE FROM ' . $this->db->t('play_sessions') . " WHERE `state` = 'ended' AND `ended_at` IS NOT NULL AND `ended_at` < ? "
            . 'ORDER BY `id` LIMIT ' . max(1, $limit),
            [$before],
        );
    }

    // ---- Players ---------------------------------------------------------------------------

    /**
     * @param list<int> $sessionIds
     * @return array<int, list<array{user_id: int, username: string, status: string, ready: bool}>> by session
     */
    public function playersOf(array $sessionIds): array
    {
        $out = [];
        if ($sessionIds === []) {
            return $out;
        }
        $rows = $this->db->fetchAll(
            'SELECT p.`session_id`, p.`user_id`, u.`username`, p.`status`, p.`ready` FROM ' . $this->db->t('session_players') . ' p '
            . 'JOIN ' . $this->db->t('users') . ' u ON u.`id` = p.`user_id` WHERE p.`session_id` IN ('
            . implode(', ', array_fill(0, count($sessionIds), '?')) . ') ORDER BY p.`joined_at`, p.`user_id`',
            $sessionIds,
        );
        foreach ($rows as $r) {
            $out[(int) $r['session_id']][] = [
                'user_id' => (int) $r['user_id'],
                'username' => (string) $r['username'],
                'status' => (string) $r['status'],
                'ready' => (int) $r['ready'] === 1,
            ];
        }

        return $out;
    }

    /**
     * @return array{status: string, ready: bool, username: string}|null
     */
    public function player(int $sessionId, int $userId, bool $lock = false): ?array
    {
        $row = $this->db->fetchOne(
            'SELECT p.`status`, p.`ready`, u.`username` FROM ' . $this->db->t('session_players') . ' p '
            . 'JOIN ' . $this->db->t('users') . ' u ON u.`id` = p.`user_id` WHERE p.`session_id` = ? AND p.`user_id` = ?'
            . ($lock ? ' FOR UPDATE' : ''),
            [$sessionId, $userId],
        );

        return $row === null ? null : ['status' => (string) $row['status'], 'ready' => (int) $row['ready'] === 1, 'username' => (string) $row['username']];
    }

    public function insertPlayer(int $sessionId, int $userId): void
    {
        $now = $this->clock->sql();
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('session_players') . ' (`session_id`, `user_id`, `status`, `ready`, `joined_at`, `last_seen_at`) '
            . "VALUES (?, ?, 'connected', 0, ?, ?)",
            [$sessionId, $userId, $now, $now],
        );
    }

    public function setPlayerStatus(int $sessionId, int $userId, string $status, bool $seen = true): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('session_players') . ' SET `status` = ?, `ready` = IF(? = \'connected\', `ready`, 0)'
            . ($seen ? ', `last_seen_at` = ?' : '') . ' WHERE `session_id` = ? AND `user_id` = ?',
            $seen ? [$status, $status, $this->clock->sql(), $sessionId, $userId] : [$status, $status, $sessionId, $userId],
        );
    }

    public function setReady(int $sessionId, int $userId, bool $ready): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('session_players') . ' SET `ready` = ? WHERE `session_id` = ? AND `user_id` = ?',
            [$ready ? 1 : 0, $sessionId, $userId],
        );
    }

    public function resetReady(int $sessionId): void
    {
        $this->db->execute('UPDATE ' . $this->db->t('session_players') . ' SET `ready` = 0 WHERE `session_id` = ?', [$sessionId]);
    }

    public function isGameMember(int $gameId, int $userId): bool
    {
        return $this->db->fetchValue(
            'SELECT 1 FROM ' . $this->db->t('game_members') . ' WHERE `game_id` = ? AND `user_id` = ?',
            [$gameId, $userId],
        ) !== null;
    }

    // ---- Assignments -----------------------------------------------------------------------

    /**
     * @param list<int> $sessionIds
     * @return array<int, list<array{token_id: int, user_id: int}>> by session
     */
    public function assignmentsOf(array $sessionIds): array
    {
        $out = [];
        if ($sessionIds === []) {
            return $out;
        }
        $rows = $this->db->fetchAll(
            'SELECT `session_id`, `token_id`, `user_id` FROM ' . $this->db->t('token_assignments') . ' WHERE `session_id` IN ('
            . implode(', ', array_fill(0, count($sessionIds), '?')) . ') ORDER BY `token_id`',
            $sessionIds,
        );
        foreach ($rows as $r) {
            $out[(int) $r['session_id']][] = ['token_id' => (int) $r['token_id'], 'user_id' => (int) $r['user_id']];
        }

        return $out;
    }

    public function assignmentUser(int $sessionId, int $tokenId): ?int
    {
        $id = $this->db->fetchValue(
            'SELECT `user_id` FROM ' . $this->db->t('token_assignments') . ' WHERE `session_id` = ? AND `token_id` = ? FOR UPDATE',
            [$sessionId, $tokenId],
        );

        return $id === null ? null : (int) $id;
    }

    public function setAssignment(int $sessionId, int $tokenId, int $userId): void
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('token_assignments') . ' (`session_id`, `token_id`, `user_id`) VALUES (?, ?, ?) '
            . 'ON DUPLICATE KEY UPDATE `user_id` = VALUES(`user_id`)',
            [$sessionId, $tokenId, $userId],
        );
    }

    public function removeAssignment(int $sessionId, int $tokenId): void
    {
        $this->db->execute(
            'DELETE FROM ' . $this->db->t('token_assignments') . ' WHERE `session_id` = ? AND `token_id` = ?',
            [$sessionId, $tokenId],
        );
    }

    /**
     * Removes every assignment of a user and returns the freed token ids.
     *
     * @return list<int>
     */
    public function removeUserAssignments(int $sessionId, int $userId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `token_id` FROM ' . $this->db->t('token_assignments') . ' WHERE `session_id` = ? AND `user_id` = ? ORDER BY `token_id` FOR UPDATE',
            [$sessionId, $userId],
        );
        $this->db->execute(
            'DELETE FROM ' . $this->db->t('token_assignments') . ' WHERE `session_id` = ? AND `user_id` = ?',
            [$sessionId, $userId],
        );

        return array_map(static fn (array $r): int => (int) $r['token_id'], $rows);
    }

    /**
     * D7: tokens of the game with a default owner who is a player member of the game.
     *
     * @return list<array{token_id: int, user_id: int}>
     */
    public function defaultOwners(int $gameId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT t.`id`, t.`default_owner_user_id` FROM ' . $this->db->t('tokens') . ' t '
            . 'JOIN ' . $this->db->t('game_members') . " m ON m.`game_id` = t.`game_id` AND m.`user_id` = t.`default_owner_user_id` AND m.`role` = 'player' "
            . 'WHERE t.`game_id` = ? AND t.`deleted_at` IS NULL ORDER BY t.`id`',
            [$gameId],
        );

        return array_map(static fn (array $r): array => ['token_id' => (int) $r['id'], 'user_id' => (int) $r['default_owner_user_id']], $rows);
    }

    // ---- Idempotence (processed_ops) --------------------------------------------------------

    /**
     * @return array{user_id: int, response: mixed}|null
     */
    public function processed(string $clientOpId): ?array
    {
        $row = $this->db->fetchOne(
            'SELECT `user_id`, `response` FROM ' . $this->db->t('processed_ops') . ' WHERE `client_op_id` = ?',
            [$clientOpId],
        );

        return $row === null ? null : ['user_id' => (int) $row['user_id'], 'response' => json_decode((string) $row['response'], true)];
    }

    /**
     * @param array<string, mixed> $response
     */
    public function rememberProcessed(string $clientOpId, int $userId, array $response): void
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('processed_ops') . ' (`client_op_id`, `user_id`, `response`, `created_at`) VALUES (?, ?, ?, ?)',
            [$clientOpId, $userId, json_encode($response, Response::JSON_FLAGS), $this->clock->sql()],
        );
    }
}
