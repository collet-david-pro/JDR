<?php

declare(strict_types=1);

namespace JDR\Domain\Games;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;

/**
 * SQL access to games (the GM is games.gm_user_id, see Game). Every read is made for a viewer:
 * the viewer's role and the counts (tokens: all for the GM/co-GM, own tokens for a player)
 * come with the row.
 */
final class GameRepository
{
    public const STATES = ['active', 'archived', 'trash'];
    public const ROLES = ['gm', 'player'];

    public function __construct(private Db $db, private Clock $clock)
    {
    }

    public function find(int $gameId, int $viewerId): ?Game
    {
        [$sql, $params] = $this->select($viewerId);
        $row = $this->db->fetchOne($sql . ' WHERE g.`id` = ?', [...$params, $gameId]);

        return $row === null ? null : Game::fromRow($row, $viewerId);
    }

    /**
     * Games of $viewerId: role "gm" (games they run), "player" (player or co-GM), null (both);
     * state "active" | "archived" | "trash" (trash: only games the viewer runs).
     *
     * @return list<Game>
     */
    public function listFor(int $viewerId, ?string $role, string $state): array
    {
        [$sql, $params] = $this->select($viewerId);
        $where = [];
        if ($state === 'trash') {
            if ($role === 'player') {
                return [];
            }
            $where[] = 'g.`gm_user_id` = ?';
            $params[] = $viewerId;
            $where[] = 'g.`deleted_at` IS NOT NULL';
        } else {
            $where[] = match ($role) {
                'gm' => 'g.`gm_user_id` = ?',
                'player' => '(gm.`user_id` IS NOT NULL AND g.`gm_user_id` <> ?)',
                default => '(g.`gm_user_id` = ? OR gm.`user_id` IS NOT NULL)',
            };
            $params[] = $viewerId;
            $where[] = 'g.`deleted_at` IS NULL';
            $where[] = $state === 'archived' ? 'g.`archived_at` IS NOT NULL' : 'g.`archived_at` IS NULL';
        }
        $rows = $this->db->fetchAll(
            $sql . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY g.`updated_at` DESC, g.`id` DESC LIMIT 500',
            $params,
        );

        return array_map(static fn (array $r): Game => Game::fromRow($r, $viewerId), $rows);
    }

    public function insert(int $gmUserId, string $name, ?string $description, string $settingsJson): int
    {
        $now = $this->clock->sql();
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('games') . ' (`gm_user_id`, `name`, `description`, `settings`, `created_at`, `updated_at`) '
            . 'VALUES (?, ?, ?, ?, ?, ?)',
            [$gmUserId, $name, $description, $settingsJson, $now, $now],
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $fields among name, description, cover_asset_id, settings (JSON string)
     */
    public function update(int $id, array $fields): void
    {
        $allowed = array_intersect_key($fields, array_flip(['name', 'description', 'cover_asset_id', 'settings']));
        $sets = [];
        foreach (array_keys($allowed) as $column) {
            $sets[] = '`' . $column . '` = ?';
        }
        $sets[] = '`updated_at` = ?';
        $this->db->execute(
            'UPDATE ' . $this->db->t('games') . ' SET ' . implode(', ', $sets) . ' WHERE `id` = ?',
            [...array_values($allowed), $this->clock->sql(), $id],
        );
    }

    public function setArchived(int $id, bool $archived): void
    {
        $now = $this->clock->sql();
        $this->db->execute(
            'UPDATE ' . $this->db->t('games') . ' SET `archived_at` = ?, `updated_at` = ? WHERE `id` = ?',
            [$archived ? $now : null, $now, $id],
        );
    }

    /**
     * Soft delete (trash, purged after trash_days); false when already in the trash.
     */
    public function softDelete(int $id): bool
    {
        $now = $this->clock->sql();

        return $this->db->execute(
            'UPDATE ' . $this->db->t('games') . ' SET `deleted_at` = ?, `updated_at` = ? WHERE `id` = ? AND `deleted_at` IS NULL',
            [$now, $now, $id],
        ) === 1;
    }

    /**
     * Out of the trash and of the archives.
     */
    public function restore(int $id): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('games') . ' SET `deleted_at` = NULL, `archived_at` = NULL, `updated_at` = ? WHERE `id` = ?',
            [$this->clock->sql(), $id],
        );
    }

    public function setGm(int $id, int $gmUserId): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('games') . ' SET `gm_user_id` = ?, `updated_at` = ? WHERE `id` = ?',
            [$gmUserId, $this->clock->sql(), $id],
        );
    }

    /**
     * Ids of the games run by $userId (live ones only unless $withTrash).
     *
     * @return list<int>
     */
    public function idsRunBy(int $userId, bool $withTrash = false): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `id` FROM ' . $this->db->t('games') . ' WHERE `gm_user_id` = ?'
            . ($withTrash ? '' : ' AND `deleted_at` IS NULL') . ' ORDER BY `id`',
            [$userId],
        );

        return array_map(static fn (array $r): int => (int) $r['id'], $rows);
    }

    /**
     * Ids of the games in the trash for longer than the delay.
     *
     * @return list<int>
     */
    public function expiredTrash(string $before, int $limit): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `id` FROM ' . $this->db->t('games') . ' WHERE `deleted_at` IS NOT NULL AND `deleted_at` < ? ORDER BY `id` LIMIT ?',
            [$before, $limit],
        );

        return array_map(static fn (array $r): int => (int) $r['id'], $rows);
    }

    /**
     * Permanent deletion: members, tokens, encounters, maps, sessions... go with it (FK CASCADE).
     * The games <-> maps cycle (world_map_id) is cut first.
     */
    public function hardDelete(int $id): void
    {
        $this->db->transaction(function () use ($id): void {
            $this->db->execute('UPDATE ' . $this->db->t('games') . ' SET `world_map_id` = NULL WHERE `id` = ?', [$id]);
            $this->db->execute('DELETE FROM ' . $this->db->t('games') . ' WHERE `id` = ?', [$id]);
        });
    }

    /**
     * Base SELECT of a game for a viewer, with its parameters.
     *
     * @return array{0: string, 1: list<mixed>}
     */
    private function select(int $viewerId): array
    {
        $t = fn (string $name): string => $this->db->t($name);
        $sql = 'SELECT g.*, u.`username` AS gm_username, gm.`role` AS member_role, '
            . 'ca.`uuid` AS cover_uuid, ca.`deleted_at` AS cover_deleted_at, '
            . '(SELECT COUNT(*) FROM ' . $t('maps') . ' m WHERE m.`game_id` = g.`id` AND m.`deleted_at` IS NULL) AS count_maps, '
            . '(SELECT COUNT(*) FROM ' . $t('tokens') . ' tk WHERE tk.`game_id` = g.`id` AND tk.`deleted_at` IS NULL '
            . "AND (g.`gm_user_id` = ? OR gm.`role` = 'co_gm' OR tk.`default_owner_user_id` = ?)) AS count_tokens, "
            . '(SELECT COUNT(*) FROM ' . $t('game_members') . ' x WHERE x.`game_id` = g.`id`) + 1 AS count_members '
            . 'FROM ' . $t('games') . ' g '
            . 'INNER JOIN ' . $t('users') . ' u ON u.`id` = g.`gm_user_id` '
            . 'LEFT JOIN ' . $t('game_members') . ' gm ON gm.`game_id` = g.`id` AND gm.`user_id` = ? '
            . 'LEFT JOIN ' . $t('assets') . ' ca ON ca.`id` = g.`cover_asset_id`';

        return [$sql, [$viewerId, $viewerId, $viewerId]];
    }
}
