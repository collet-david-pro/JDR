<?php

declare(strict_types=1);

namespace JDR\Domain\Games;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;

/**
 * SQL access to game_members (roles "player" | "co_gm"; the GM has no row, see Game).
 */
final class GameMemberRepository
{
    public function __construct(private Db $db, private Clock $clock)
    {
    }

    /**
     * Members (GM excluded), oldest first.
     *
     * @return list<array{user_id: int, username: string, role: string, joined_at: string}>
     */
    public function list(int $gameId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT m.`user_id`, u.`username`, m.`role`, m.`joined_at` FROM ' . $this->db->t('game_members') . ' m '
            . 'INNER JOIN ' . $this->db->t('users') . ' u ON u.`id` = m.`user_id` '
            . 'WHERE m.`game_id` = ? ORDER BY m.`joined_at`, m.`user_id`',
            [$gameId],
        );

        return array_map(static fn (array $r): array => [
            'user_id' => (int) $r['user_id'],
            'username' => (string) $r['username'],
            'role' => (string) $r['role'],
            'joined_at' => (string) $r['joined_at'],
        ], $rows);
    }

    /**
     * @return array{user_id: int, username: string, role: string, joined_at: string}|null
     */
    public function find(int $gameId, int $userId): ?array
    {
        $r = $this->db->fetchOne(
            'SELECT m.`user_id`, u.`username`, m.`role`, m.`joined_at` FROM ' . $this->db->t('game_members') . ' m '
            . 'INNER JOIN ' . $this->db->t('users') . ' u ON u.`id` = m.`user_id` '
            . 'WHERE m.`game_id` = ? AND m.`user_id` = ?',
            [$gameId, $userId],
        );

        return $r === null ? null : [
            'user_id' => (int) $r['user_id'],
            'username' => (string) $r['username'],
            'role' => (string) $r['role'],
            'joined_at' => (string) $r['joined_at'],
        ];
    }

    public function add(int $gameId, int $userId, string $role): void
    {
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('game_members') . ' (`game_id`, `user_id`, `role`, `joined_at`) VALUES (?, ?, ?, ?)',
            [$gameId, $userId, $role, $this->clock->sql()],
        );
    }

    public function setRole(int $gameId, int $userId, string $role): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('game_members') . ' SET `role` = ? WHERE `game_id` = ? AND `user_id` = ?',
            [$role, $gameId, $userId],
        );
    }

    public function remove(int $gameId, int $userId): void
    {
        $this->db->execute(
            'DELETE FROM ' . $this->db->t('game_members') . ' WHERE `game_id` = ? AND `user_id` = ?',
            [$gameId, $userId],
        );
    }

    /**
     * The co-GM who joined first, among live accounts (account deletion: projet.md 11.1).
     */
    public function oldestCoGm(int $gameId): ?int
    {
        $id = $this->db->fetchValue(
            'SELECT m.`user_id` FROM ' . $this->db->t('game_members') . ' m INNER JOIN ' . $this->db->t('users') . ' u '
            . "ON u.`id` = m.`user_id` AND u.`deleted_at` IS NULL WHERE m.`game_id` = ? AND m.`role` = 'co_gm' "
            . 'ORDER BY m.`joined_at`, m.`user_id` LIMIT 1',
            [$gameId],
        );

        return $id === null || $id === false ? null : (int) $id;
    }

    /**
     * Every membership of a user (account deletion).
     */
    public function removeUser(int $userId): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('game_members') . ' WHERE `user_id` = ?', [$userId]);
    }

    /**
     * Memberships of a user (personal data export).
     *
     * @return list<array{game_id: int, name: string, role: string, joined_at: string}>
     */
    public function membershipsOf(int $userId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT g.`id`, g.`name`, m.`role`, m.`joined_at` FROM ' . $this->db->t('game_members') . ' m '
            . 'INNER JOIN ' . $this->db->t('games') . ' g ON g.`id` = m.`game_id` '
            . 'WHERE m.`user_id` = ? AND g.`deleted_at` IS NULL ORDER BY m.`joined_at`',
            [$userId],
        );

        return array_map(static fn (array $r): array => [
            'game_id' => (int) $r['id'],
            'name' => (string) $r['name'],
            'role' => (string) $r['role'],
            'joined_at' => (string) $r['joined_at'],
        ], $rows);
    }
}
